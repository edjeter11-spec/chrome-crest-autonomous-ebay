"""
Snipe scoring engine + eBay live sync. No simulation.
All auction data comes exclusively from the real eBay Browse API.
"""
import asyncio
import re
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from database import Card, Auction, PriceHistory, Alert
from ebay_api import fetch_all_f1_listings, extract_driver_from_title
import logging

logger = logging.getLogger(__name__)


# Grade extractor for auction titles (matches PSA/BGS/SGC/CGC + numeric grade).
_GRADE_RE = re.compile(r"\b(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7|6)\b", re.I)


def _extract_grade_from_title(title: str) -> str | None:
    if not title:
        return None
    m = _GRADE_RE.search(title)
    if not m:
        return None
    return f"{m.group(1).upper()} {m.group(2)}"


def median_comp_price(
    db: Session,
    driver: str | None,
    parallel: str | None,
    grade: str | None = None,
    days: int = 90,
) -> tuple[float | None, int]:
    """
    Median SoldCard total-cost (sale_price + shipping) for this driver+parallel
    (and grade, when specified) in the last `days` days, excluding soft dupes.

    Returns (median_total, n_comps). `None` median when no comps.

    Strategy: try the fully-scoped query first. If it returns <3 rows, fall back
    to driver-only (ignoring parallel) so we at least get *something* to compare
    against. Caller can tell it was a fallback because the driver+parallel combo
    returned 0 rows.
    """
    from database import SoldCard
    if not driver:
        return (None, 0)

    cutoff = datetime.utcnow() - timedelta(days=days)

    def _run(filters) -> tuple[float | None, int]:
        # total_cost = sale_price + COALESCE(shipping_cost, 0). Use Postgres
        # PERCENTILE_CONT when available; fall back to Python median for SQLite.
        q = db.query(
            (SoldCard.sale_price + func.coalesce(SoldCard.shipping_cost, 0)).label("total"),
        ).filter(
            SoldCard.sale_date >= cutoff,
            SoldCard.sale_price > 0,
            SoldCard.is_duplicate == False,  # noqa: E712
            *filters,
        )
        rows = [float(r.total) for r in q.all() if r.total is not None]
        if not rows:
            return (None, 0)
        rows.sort()
        n = len(rows)
        med = rows[n // 2] if n % 2 else (rows[n // 2 - 1] + rows[n // 2]) / 2
        return (float(med), n)

    filters = [SoldCard.driver_name == driver]
    if parallel:
        filters.append(SoldCard.parallel == parallel)
    if grade:
        filters.append(SoldCard.grade == grade)
    else:
        # When auction is raw, only compare against raw comps — grading
        # premium would otherwise blow up the median.
        filters.append(SoldCard.grade.is_(None))
    med, n = _run(filters)
    if n >= 3:
        return (med, n)

    # Fallback: driver-only (no parallel scope), still grade-matched.
    filters = [SoldCard.driver_name == driver]
    if grade:
        filters.append(SoldCard.grade == grade)
    else:
        filters.append(SoldCard.grade.is_(None))
    med2, n2 = _run(filters)
    if n2 >= 3:
        return (med2, n2)

    # Last resort: whatever we got at the scoped level (even if <3).
    return (med, n)


def calculate_snipe_score(auction, card, db: Session | None = None) -> float:
    """Score 0–100. Higher = better snipe opportunity."""
    if not card:
        return 0.0

    now = datetime.utcnow()
    hours_left = max(0, (auction.end_time - now).total_seconds() / 3600)

    if hours_left <= 0.25:
        time_score = 95
    elif hours_left <= 0.5:
        time_score = 100
    elif hours_left <= 1:
        time_score = 90
    elif hours_left <= 2:
        time_score = 80
    elif hours_left <= 6:
        time_score = 55
    elif hours_left <= 24:
        time_score = 25
    else:
        time_score = 8

    price_score = 50
    # Use median (not avg) scoped to driver+parallel+grade when available.
    owns_db = db is None
    if owns_db:
        from database import SessionLocal as _SL
        db = _SL()
    try:
        auction_grade = _extract_grade_from_title(auction.title or "")
        med, n = median_comp_price(db, card.driver_name, card.parallel, auction_grade)
        ref_price = med if (med and n >= 3) else (card.base_value or 0)
    finally:
        if owns_db:
            db.close()

    # Compare against total cost (price + shipping) so "free shipping $20" vs
    # "$15 + $8 shipping" are apples-to-apples.
    cur_total = (auction.current_price or 0) + (getattr(auction, "shipping_cost", 0) or 0)
    if ref_price and ref_price > 0 and cur_total > 0:
        ratio = cur_total / ref_price
        if ratio <= 0.5:
            price_score = 100
        elif ratio <= 0.65:
            price_score = 90
        elif ratio <= 0.75:
            price_score = 80
        elif ratio <= 0.85:
            price_score = 70
        elif ratio <= 0.95:
            price_score = 58
        elif ratio <= 1.0:
            price_score = 45
        elif ratio <= 1.15:
            price_score = 30
        else:
            price_score = max(0, 30 - (ratio - 1.15) * 60)

    fb = getattr(auction, "seller_feedback", 0) or 0
    if fb >= 5000:
        feedback_score = 100
    elif fb >= 1000:
        feedback_score = 85
    elif fb >= 500:
        feedback_score = 70
    elif fb >= 100:
        feedback_score = 55
    elif fb >= 10:
        feedback_score = 35
    else:
        feedback_score = 15

    bids = auction.bid_count or 0
    if bids == 0:
        bid_score = 100
    elif bids <= 2:
        bid_score = 80
    elif bids <= 5:
        bid_score = 55
    elif bids <= 10:
        bid_score = 30
    else:
        bid_score = 10

    score = round(
        time_score * 0.35
        + price_score * 0.40
        + feedback_score * 0.10
        + bid_score * 0.15,
        1,
    )
    # Hard cap: anything listed >10% over median is NEVER a good snipe,
    # regardless of how little time is left. Prevents "ends in 5 min at $2,300"
    # scoring high on obvious overprices.
    if ref_price and ref_price > 0 and cur_total > 0:
        if cur_total > ref_price * 1.1:
            score = min(score, 40)
        if cur_total > ref_price * 1.5:
            score = min(score, 15)
    return score


def _parallel_from_title(title: str) -> str:
    t = title.lower()
    # Insert sets (check before generic refractor/auto)
    if "vegas at night" in t: return "Vegas at Night"
    if "neon nations" in t: return "Neon Nations"
    if "floor it" in t and "auto" not in t: return "Floor It"
    if "floor it" in t: return "Floor It Auto"
    if "speed wheels" in t and "auto" not in t: return "Speed Wheels"
    if "speed wheels" in t: return "Speed Wheels Auto"
    if "top speed" in t: return "Top Speed"
    if "four & more" in t or "four and more" in t or "4 & more" in t: return "Four & More"
    if "diamond 75" in t or "d75-" in t or "#d75" in t: return "Diamond 75th"
    if "helix" in t: return "Helix"
    if "ultrasonic" in t: return "Ultrasonic"
    if "the grail" in t or "#tg-" in t: return "The Grail"
    if "futuro" in t or "#fut-" in t: return "Futuro"
    if "the chain" in t or "#ch-" in t: return "The Chain"
    if "the grid" in t: return "The Grid"
    if "helmet collection" in t or "#hc-" in t: return "Helmet Collection"
    if "speed demons" in t or "#sd-" in t: return "Speed Demons"
    if "ace of trades" in t or "#sca-" in t or "#aca-" in t: return "Ace of Trades"
    if "checker flag" in t: return "Checker Flag"
    if "b&w ray wave" in t or "raywave" in t or "ray wave" in t or "black & white ray" in t: return "B&W Ray Wave"
    if "b&w lazer" in t or "black & white lazer" in t or "lazer" in t: return "B&W Lazer"
    if "grand prix winner" in t: return "Grand Prix Winner"
    # Autograph detection
    if "autograph" in t or " auto " in t or t.endswith(" auto") or "#cac-" in t or "chrome auto" in t:
        # Numbered auto parallels
        if " /5 " in t or t.endswith("/5"): return "Auto Red /5"
        if "/10" in t and "black" in t: return "Auto Black /10"
        if "/25" in t: return "Auto Orange /25"
        if "/50" in t: return "Auto Gold /50"
        if "/99" in t: return "Auto Green /99"
        if "/150" in t: return "Auto Blue /150"
        return "Autograph"
    # Numbered base parallels
    if (" /5 " in t or t.endswith(" /5")) and "red" in t: return "Red /5"
    if "/10" in t and "black" in t: return "Black /10"
    if "/25" in t: return "Orange /25"
    if "/50" in t: return "Gold /50"
    if "/75" in t: return "F1 75th /75"
    if "/99" in t: return "Green /99"
    if "/150" in t: return "Blue /150"
    if "/199" in t or "aqua" in t: return "Aqua /199"
    if "/250" in t and "pink" in t: return "Pink /250"
    if "/299" in t or "teal" in t: return "Teal /299"
    if "superfractor" in t or "1/1" in t: return "SuperFractor"
    if "prism refractor" in t or "prizm" in t: return "Prism Refractor"
    if "refractor" in t or "sapphire" in t or "hyper" in t or "xfractor" in t \
            or "speckle" in t or "logofractor" in t or "portrait" in t:
        return "Refractor"
    return "Base"


def _is_2025_f1_title(title: str) -> bool:
    """Only keep 2025 Topps Chrome F1 — no other years, no F2/F3."""
    t = title.lower()
    if "2025" not in t:
        return False
    bad = [" f2 ", " f3 ", "formula 2", "formula 3", "indy", "nascar",
           "wrc", "motogp", "soccer", "basketball", "baseball", "football"]
    return not any(b in t for b in bad)


async def sync_real_ebay_listings(db: Session) -> int:
    """Fetch live eBay listings and upsert into database. Returns count of new listings added."""
    # Purge all non-2025 or ended auctions first
    stale = db.query(Auction).filter(Auction.status == "active").all()
    purged = 0
    for a in stale:
        if not _is_2025_f1_title(a.title or ""):
            db.delete(a)
            purged += 1
    if purged:
        db.commit()
        logger.info(f"Purged {purged} non-2025 listings from DB")

    listings = await fetch_all_f1_listings(limit_per_query=100)
    added = 0
    updated = 0

    for listing in listings:
        ebay_id = listing.get("ebay_item_id", "")
        if not ebay_id:
            continue

        title = listing.get("title", "")
        current_price = listing.get("current_price", 0) or 0
        if current_price <= 0:
            continue

        driver = extract_driver_from_title(title)
        parallel = _parallel_from_title(title)
        card = None
        if driver:
            card = db.query(Card).filter(
                Card.driver_name == driver, Card.parallel == parallel
            ).first()
            if not card and parallel != "Base":
                card = db.query(Card).filter(
                    Card.driver_name == driver, Card.parallel == "Refractor"
                ).first()
            if not card:
                card = db.query(Card).filter(Card.driver_name == driver).first()
        if not card:
            card = db.query(Card).filter(Card.parallel == parallel).first()
        if not card:
            card = db.query(Card).first()
        if not card:
            continue

        end_time = listing.get("end_time")
        buying_opts_list = listing.get("buying_options", []) or []
        is_true_auction = "AUCTION" in buying_opts_list
        if end_time is None:
            if is_true_auction:
                continue
            end_time = datetime.utcnow() + timedelta(days=365)
        elif hasattr(end_time, "tzinfo") and end_time.tzinfo is not None:
            from datetime import timezone
            end_time = end_time.astimezone(timezone.utc).replace(tzinfo=None)

        existing = db.query(Auction).filter(Auction.ebay_listing_id == ebay_id).first()

        buying_opts = listing.get("buying_options", [])
        buying_opts_json = __import__("json").dumps(buying_opts) if buying_opts else None

        if existing:
            existing.current_price = current_price
            existing.bid_count = listing.get("bid_count", existing.bid_count)
            existing.last_updated = datetime.utcnow()
            if listing.get("shipping_cost") is not None:
                existing.shipping_cost = listing.get("shipping_cost")
            existing.snipe_score = calculate_snipe_score(existing, card, db)
            existing.snipe_eligible = existing.snipe_score >= 50
            if listing.get("image_url") and not existing.image_url:
                existing.image_url = listing["image_url"]
            if buying_opts_json:
                existing.buying_options = buying_opts_json
            updated += 1
        else:
            a = Auction(
                card_id=card.id,
                ebay_listing_id=ebay_id,
                title=title[:255],
                current_price=current_price,
                buy_now_price=listing.get("buy_now_price"),
                bid_count=listing.get("bid_count", 0),
                end_time=end_time,
                seller=listing.get("seller", "unknown"),
                seller_feedback=listing.get("seller_feedback", 0),
                condition=listing.get("condition", "Used"),
                ebay_url=listing.get("ebay_url", ""),
                image_url=listing.get("image_url", ""),
                shipping_cost=listing.get("shipping_cost", 0),
                buying_options=buying_opts_json,
                is_real_ebay=True,
                status="active",
            )
            a.snipe_score = calculate_snipe_score(a, card, db)
            a.snipe_eligible = a.snipe_score >= 50
            db.add(a)
            added += 1

    now = datetime.utcnow()
    for auction in db.query(Auction).filter(Auction.status == "active", Auction.end_time < now).all():
        auction.status = "ended"
        card = db.query(Card).filter(Card.id == auction.card_id).first()
        if card:
            db.add(PriceHistory(
                card_id=card.id,
                price=auction.current_price,
                sale_date=now,
                source="eBay Live",
                condition=auction.condition,
            ))

    db.commit()
    logger.info(f"eBay sync: +{added} new, {updated} updated")
    return added


def run_strong_buy_alerts(db: Session) -> list:
    """
    Detect NEW listings that qualify as STRONG BUY (ratio <= 0.6 vs median, n>=5).

    Mirrors the frontend `verdictFor` logic so backend + UI agree on what's a
    STRONG BUY. Only fires once per auction (deduped on (auction_id, alert_type)).
    Also auto-adds matching wishlist hits to the watchlist (Feature 4).
    """
    from database import SoldCard, Wishlist, Card as _Card
    now = datetime.utcnow()
    alerts_created: list = []

    # Existing auctions we've already alerted on — skip them.
    existing = set(
        (aid,) for (aid,) in db.query(Alert.auction_id).filter(
            Alert.alert_type == "strong_buy",
            Alert.auction_id.isnot(None),
        ).all()
    )

    candidates = db.query(Auction).filter(
        Auction.status.in_(["active", "watchlist"]),
    ).all()

    med_cache: dict = {}
    wishlist_alerts: list = []
    auto_added = 0

    for auction in candidates:
        if (auction.id,) in existing:
            continue
        card = db.query(Card).filter(Card.id == auction.card_id).first()
        if not card or not card.driver_name:
            continue
        cur_price = auction.current_price or 0
        shipping = auction.shipping_cost or 0
        cur_total = cur_price + shipping
        if cur_total <= 0:
            continue

        driver = card.driver_name
        parallel = card.parallel or ""
        grade = _extract_grade_from_title(auction.title or "")
        ck = (driver, parallel, grade)
        if ck not in med_cache:
            med_cache[ck] = median_comp_price(db, driver, parallel, grade)
        median, n_comps = med_cache[ck]

        # STRONG BUY threshold (matches frontend verdict.js): ratio <= 0.6,
        # require >=5 comps so we don't fire on noise.
        if not median or n_comps < 5:
            continue
        ratio = cur_total / median
        if ratio > 0.6:
            continue

        pct_under = round((1 - ratio) * 100)
        par_frag = f" {parallel}" if parallel else ""
        grade_frag = f" {grade}" if grade else ""
        msg = (
            f"STRONG BUY: {driver}{par_frag}{grade_frag} — "
            f"${cur_total:.0f} vs ${median:.0f} median ({pct_under}% under, n={n_comps} comps)"
        )

        alert = Alert(
            card_id=auction.card_id,
            alert_type="strong_buy",
            threshold_price=cur_price,
            triggered=True,
            triggered_at=now,
            auction_id=auction.id,
            urgency="high",
            message=msg,
        )
        db.add(alert)
        alerts_created.append(alert)
        existing.add((auction.id,))

        # ---- Feature 4: wishlist auto-add ----
        # Pull every active wishlist row that matches driver+parallel and has
        # max_price >= cur_total. Fire ONCE per (auction, wishlist) pair.
        wishlist_hits = db.query(Wishlist).filter(
            Wishlist.card_id.isnot(None),
        ).all()
        for wi in wishlist_hits:
            wcard = db.query(_Card).filter(_Card.id == wi.card_id).first()
            if not wcard or wcard.driver_name != driver:
                continue
            # Match parallel when set on wishlist (treat empty as wildcard).
            if wcard.parallel and parallel and wcard.parallel != parallel:
                continue
            if not wi.max_price or wi.max_price <= 0:
                continue
            if cur_total > wi.max_price:
                continue
            # Conservative: high-confidence comps only.
            if n_comps < 5:
                continue
            # Auto-add to watchlist if not already there
            if auction.status != "watchlist":
                auction.status = "watchlist"
                auto_added += 1
            # Wishlist match alert (deduped via separate flag below)
            wm_existing = db.query(Alert).filter(
                Alert.alert_type == "wishlist_match",
                Alert.auction_id == auction.id,
                Alert.card_id == wcard.id,
            ).first()
            if wm_existing:
                continue
            wm_msg = (
                f"WISHLIST MATCH: {driver}{par_frag}{grade_frag} — "
                f"${cur_total:.0f} ≤ your max ${wi.max_price:.0f}. "
                f"Added to watchlist."
            )
            wm_alert = Alert(
                card_id=wcard.id,
                alert_type="wishlist_match",
                threshold_price=cur_price,
                triggered=True,
                triggered_at=now,
                auction_id=auction.id,
                urgency="high",
                message=wm_msg,
            )
            db.add(wm_alert)
            wishlist_alerts.append(wm_alert)

    if alerts_created or wishlist_alerts:
        db.commit()
    return {
        "strong_buy_alerts": alerts_created,
        "wishlist_alerts": wishlist_alerts,
        "auto_added_to_watchlist": auto_added,
    }


def run_snipe_alerts(db: Session) -> list:
    """Create snipe opportunity alerts for high-score auctions ending soon."""
    now = datetime.utcnow()
    candidates = (
        db.query(Auction)
        .filter(
            Auction.status == "active",
            Auction.snipe_score >= 65,
            Auction.end_time > now,
            Auction.end_time < now + timedelta(hours=3),
            Auction.buying_options.like('%AUCTION%'),
        )
        .all()
    )

    alerts_created = []
    for auction in candidates:
        existing = db.query(Alert).filter(
            Alert.auction_id == auction.id,
            Alert.alert_type == "snipe_opportunity",
        ).first()
        if existing:
            continue

        card = db.query(Card).filter(Card.id == auction.card_id).first()
        mins = (auction.end_time - now).total_seconds() / 60
        urgency = "critical" if mins < 15 else ("high" if mins < 60 else "normal")
        driver_name = card.driver_name if card else "F1"

        alert = Alert(
            card_id=auction.card_id,
            alert_type="snipe_opportunity",
            threshold_price=auction.current_price,
            triggered=True,
            triggered_at=now,
            auction_id=auction.id,
            urgency=urgency,
            message=(
                f"SNIPE: {driver_name} — ${auction.current_price:.2f} | "
                f"Score: {auction.snipe_score:.0f} | {int(mins)}m left"
            ),
        )
        db.add(alert)
        alerts_created.append(alert)

    if alerts_created:
        db.commit()
    return alerts_created


def run_enhanced_snipe_alerts(db: Session) -> list:
    """
    High-conviction snipe alerts only.

    Fires ONLY if ALL of the following hold for an active auction:
      - >=3 valid comps in last 90 days (driver+parallel+grade) — otherwise no
        median to compare against
      - current price (incl. shipping) <= 0.7 * median for 'high' tier
      - current price (incl. shipping) <= 0.5 * median for 'critical' tier
      - time left < 2h for 'high', < 30 min for 'critical'
      - bid count < 3 (market hasn't reacted yet)
      - seller feedback >= 50 (filter scammers)
      - no active non-triggered alert already exists for this auction

    Alert message is fully self-explanatory:
      "SNIPE: Lewis Hamilton Refractor PSA 10 — $185 (incl ship) vs $410 median
       (n=8 comps last 90d). 47 min left, 0 bids. Seller 14k feedback."

    The median + comp count are embedded in the message string so downstream
    consumers don't need an extra DB lookup.
    """
    from database import SoldCard

    now = datetime.utcnow()
    alerts_created: list = []

    # ---- Expiry pass: mark resolved alerts whose auction no longer qualifies ----
    open_alerts = db.query(Alert).filter(
        Alert.alert_type == "snipe_opportunity",
        Alert.triggered == False,  # noqa: E712
        Alert.auction_id.isnot(None),
    ).all()
    for al in open_alerts:
        au = db.query(Auction).filter(Auction.id == al.auction_id).first()
        if not au:
            al.triggered = True
            al.triggered_at = now
            continue
        ended = (au.status == "ended") or (au.end_time and au.end_time < now)
        bid_too_high = al.threshold_price and au.current_price and au.current_price > (al.threshold_price * 1.25)
        if ended or bid_too_high:
            al.triggered = True
            al.triggered_at = now
    db.commit()

    existing_keys = set(
        (aid,) for (aid,) in db.query(Alert.auction_id).filter(
            Alert.alert_type == "snipe_opportunity",
            Alert.triggered == False,  # noqa: E712
            Alert.auction_id.isnot(None),
        ).all()
    )

    # Only look at auctions ending within 24h — nothing further out can possibly
    # be high-conviction under the new criteria (high tier caps at 2h).
    candidates = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time > now,
        Auction.end_time < now + timedelta(hours=24),
    ).all()

    # Median cache: (driver, parallel, grade) -> (median, n)
    med_cache: dict = {}

    for auction in candidates:
        if (auction.id,) in existing_keys:
            continue

        card = db.query(Card).filter(Card.id == auction.card_id).first()
        if not card or not card.driver_name:
            continue

        driver = card.driver_name
        parallel = card.parallel or ""
        cur_price = auction.current_price or 0
        shipping = auction.shipping_cost or 0
        cur_total = cur_price + shipping
        end_time = auction.end_time
        mins_left = (end_time - now).total_seconds() / 60 if end_time else 9999
        bid_count = auction.bid_count or 0
        # `seller_feedback` is often 0/None because the HTML scraper doesn't
        # extract it — treat that as "unknown" rather than "low reputation".
        # Only reject when we have a positive but genuinely low count.
        raw_fb = auction.seller_feedback
        seller_fb = raw_fb if raw_fb is not None else 0
        seller_unknown = raw_fb is None or raw_fb == 0

        # Hard gates — bail fast on anything that can't qualify.
        if cur_price <= 0 or mins_left <= 0 or mins_left >= 120:
            continue
        if bid_count >= 3:
            continue
        # Only reject real low-rep sellers (1 <= fb < 50). Unknown passes.
        if not seller_unknown and 1 <= seller_fb < 50:
            continue

        # Grade-aware median lookup.
        grade = _extract_grade_from_title(auction.title or "")
        cache_key = (driver, parallel, grade)
        if cache_key not in med_cache:
            med_cache[cache_key] = median_comp_price(db, driver, parallel, grade)
        median, n_comps = med_cache[cache_key]

        if not median or n_comps < 3:
            continue

        # Tier thresholds on total-cost / median.
        ratio = cur_total / median
        if mins_left < 30 and ratio <= 0.5 and n_comps >= 5:
            urgency = "critical"
        elif mins_left < 120 and ratio <= 0.7 and n_comps >= 3:
            urgency = "high"
        else:
            continue

        # Human-readable message with the full context baked in.
        ship_frag = f" (incl ship)" if shipping > 0 else ""
        if seller_unknown:
            fb_frag = "unknown"
        elif seller_fb >= 1000:
            fb_frag = f"{seller_fb // 1000}k"
        else:
            fb_frag = f"{seller_fb}"
        grade_frag = f" {grade}" if grade else ""
        par_frag = f" {parallel}" if parallel else ""
        msg = (
            f"SNIPE: {driver}{par_frag}{grade_frag} — ${cur_total:.0f}{ship_frag} vs "
            f"${median:.0f} median (n={n_comps} comps last 90d). "
            f"{int(mins_left)} min left, {bid_count} bids. Seller {fb_frag} feedback."
        )

        alert = Alert(
            card_id=auction.card_id,
            alert_type="snipe_opportunity",
            threshold_price=cur_price,
            triggered=False,
            auction_id=auction.id,
            urgency=urgency,
            message=msg,
        )
        db.add(alert)
        alerts_created.append(alert)
        existing_keys.add((auction.id,))

    if alerts_created:
        db.commit()
    return alerts_created
