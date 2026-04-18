"""
Snipe scoring engine + eBay live sync. No simulation.
All auction data comes exclusively from the real eBay Browse API.
"""
import asyncio
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import Card, Auction, PriceHistory, Alert
from ebay_api import fetch_all_f1_listings, extract_driver_from_title
import logging

logger = logging.getLogger(__name__)


def calculate_snipe_score(auction, card) -> float:
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
    # Use actual avg sold price from price_history if available
    from database import PriceHistory
    from sqlalchemy.orm import Session as _Session
    avg_sold = None
    try:
        from database import SessionLocal as _SL
        _db = _SL()
        from sqlalchemy import func as _func
        row = _db.query(_func.avg(PriceHistory.price)).filter(
            PriceHistory.card_id == card.id,
            PriceHistory.source.in_(["eBay Sold", "eBay Live"]),
        ).scalar()
        if row and row > 0:
            avg_sold = float(row)
        _db.close()
    except Exception:
        pass
    ref_price = avg_sold or card.base_value or 0
    if ref_price > 0:
        ratio = auction.current_price / ref_price
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

    return round(
        time_score * 0.35
        + price_score * 0.40
        + feedback_score * 0.10
        + bid_score * 0.15,
        1,
    )


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
            # Try to match driver + parallel exactly
            card = db.query(Card).filter(
                Card.driver_name == driver, Card.parallel == parallel
            ).first()
            # Fall back to driver + Refractor, then any card for driver
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
            # BIN listings without an itemEndDate: use a far-future sentinel
            # (1 year) so the UI treats them as "not ending soon" and the
            # auction-ended purge never fires on them. True auctions without
            # an end_time are skipped.
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
            existing.snipe_score = calculate_snipe_score(existing, card)
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
            a.snipe_score = calculate_snipe_score(a, card)
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
            # True auction listings only — BIN listings have 30-day synthetic end_times
            # but would still match the above filter if end_time was miscomputed.
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
    Expanded snipe alert generator. Creates Alert rows for auctions matching
    any of three criteria (dedupes by auction_id+alert_type so existing rows
    are never duplicated).
      1. Auction ending in <1h with bid_count<3 and current_price < DB median
         sold price for that driver+parallel.
      2. Any auction with snipe_score >= 85.
      3. Any auction with snipe_eligible=True AND current_price < 0.60 * avg
         sold price (driver+parallel) — i.e. 40%+ below market.
    """
    from database import SoldCard
    from sqlalchemy import func as _func

    now = datetime.utcnow()
    alerts_created: list = []

    # Existing alert keys so we don't re-alert the same auction
    existing_keys = set(
        (aid,) for (aid,) in db.query(Alert.auction_id).filter(
            Alert.alert_type == "snipe_opportunity",
            Alert.auction_id.isnot(None),
        ).all()
    )

    # Candidate pool: every active auction (filtered in-python to stay cheap)
    candidates = db.query(Auction).filter(Auction.status == "active").all()

    # Per-(driver,parallel) median + avg cache — one DB trip per pair
    stat_cache: dict = {}

    def get_stats(driver: str, parallel: str):
        key = (driver, parallel)
        if key in stat_cache:
            return stat_cache[key]
        q = db.query(SoldCard.sale_price).filter(
            SoldCard.driver_name == driver,
            SoldCard.parallel == parallel,
            SoldCard.sale_price > 0,
        )
        prices = sorted(p[0] for p in q.all() if p[0] is not None)
        if not prices:
            stat_cache[key] = (None, None, 0)
            return stat_cache[key]
        n = len(prices)
        median = prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2
        avg = sum(prices) / n
        stat_cache[key] = (median, avg, n)
        return stat_cache[key]

    for auction in candidates:
        if (auction.id,) in existing_keys:
            continue

        card = db.query(Card).filter(Card.id == auction.card_id).first()
        if not card or not card.driver_name:
            continue

        driver = card.driver_name
        parallel = card.parallel or ""
        cur_price = auction.current_price or 0
        end_time = auction.end_time
        mins_left = (end_time - now).total_seconds() / 60 if end_time else 9999

        median, avg, n_sold = get_stats(driver, parallel)

        reason = None
        urgency = "high"

        # Criterion 1: ending <1h, low bids, below median
        if (
            end_time and 0 < mins_left < 60
            and (auction.bid_count or 0) < 3
            and median and cur_price > 0 and cur_price < median
        ):
            reason = f"Ending {int(mins_left)}m, {auction.bid_count or 0} bids, ${cur_price:.0f} < median ${median:.0f}"
            urgency = "critical" if mins_left < 15 else "high"

        # Criterion 2: very high snipe score
        elif (auction.snipe_score or 0) >= 85:
            reason = f"Snipe score {auction.snipe_score:.0f} · ${cur_price:.0f}"
            urgency = "critical" if (auction.snipe_score or 0) >= 92 else "high"

        # Criterion 3: 40%+ below avg and snipe_eligible
        elif (
            auction.snipe_eligible and avg and cur_price > 0
            and cur_price < avg * 0.60
        ):
            pct = int((1 - cur_price / avg) * 100)
            reason = f"{pct}% below avg (${cur_price:.0f} vs ${avg:.0f}, n={n_sold})"
            urgency = "high"

        if not reason:
            continue

        msg = f"SNIPE: {driver} {parallel} — {reason}"
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
