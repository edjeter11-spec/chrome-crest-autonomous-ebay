from fastapi import APIRouter, Depends, Query, HTTPException, Response, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from database import get_db, Auction, Card
from datetime import datetime
from typing import Optional
import asyncio
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auctions", tags=["auctions"])


def auction_to_dict(a: Auction) -> dict:
    now = datetime.utcnow()
    time_left = max(0, int((a.end_time - now).total_seconds())) if a.end_time else 0
    # Scarcity tier — derived from card.parallel (fallback: title-based later)
    try:
        from lib.parallels import scarcity_for, is_rookie
        parallel_label = a.card.parallel if a.card else None
        sc = scarcity_for(parallel_label)
        rookie = is_rookie(a.card.driver_name if a.card else None)
    except Exception:
        sc = {"tier": "-", "count": None, "rank": 99}
        rookie = False
    # Safeguard: re-extract grade from title to avoid stale/bogus card.grade
    try:
        from scraper import _extract_grade_from_title
        safe_grade = _extract_grade_from_title(a.title or "")
    except Exception:
        safe_grade = None
    # Seller placeholder scrub
    seller_val = a.seller
    if seller_val in ("ebay_seller", "", None):
        seller_val = None
    # Title-derived driver — covers two cases the FE relies on:
    #   1. card_id is NULL (e.g. F1 Legends inserts not in our seed table)
    #   2. card_id points to the WRONG card from a pre-fix scraper run
    # Always derive from the title; UI prefers card.driver_name when it agrees,
    # otherwise falls back to this title-derived name.
    try:
        from ebay_api import extract_driver_from_title as _xd
        title_driver = _xd(a.title or "") or None
    except Exception:
        title_driver = None
    return {
        "id": a.id,
        "card_id": a.card_id,
        "ebay_listing_id": a.ebay_listing_id,
        "title": a.title,
        "title_driver": title_driver,
        "current_price": a.current_price,
        "buy_now_price": a.buy_now_price,
        "bid_count": a.bid_count,
        "end_time": a.end_time.isoformat() if a.end_time else None,
        "time_left": time_left,
        "last_updated": a.last_updated.isoformat() if getattr(a, "last_updated", None) else None,
        "seller": seller_val,
        "seller_feedback": a.seller_feedback,
        "condition": a.condition,
        "snipe_eligible": a.snipe_eligible,
        "snipe_score": a.snipe_score,
        "status": a.status,
        "ebay_url": a.ebay_url,
        "image_url": a.image_url,
        "shipping_cost": a.shipping_cost,
        "is_real_ebay": a.is_real_ebay,
        "buying_options": json.loads(a.buying_options) if a.buying_options else [],
        "extra_images": json.loads(a.extra_images) if getattr(a, 'extra_images', None) else [],
        "scarcity_tier": sc["tier"],
        "scarcity_count": sc["count"],
        "scarcity_rank": sc["rank"],
        "is_rookie": rookie,
        "card": {
            "driver_name": a.card.driver_name,
            "parallel": a.card.parallel,
            # Trust the fresh title-derived grade as authoritative. If the
            # title has no grade keyword, show None rather than a stale/bogus
            # card.grade (eg. "/15" previously misparsed as "15").
            "grade": safe_grade,
            "team_color": a.card.team_color,
            "investment_score": a.card.investment_score,
            "image_url": a.card.image_url,
            "series": getattr(a.card, "series", "F1") or "F1",
            "is_rookie": getattr(a.card, "is_rookie", False) or False,
        } if a.card else None,
    }


@router.get("")
def list_auctions(
    status: Optional[str] = "active",
    driver: Optional[str] = None,
    snipe_only: bool = False,
    # buying: "auction" → only listings with AUCTION option, "bin" → only
    # non-auction listings. Default returns both so existing clients are
    # unaffected.
    buying: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    response: Response = None,
    db: Session = Depends(get_db),
):
    q = db.query(Auction).options(joinedload(Auction.card))
    if status:
        q = q.filter(Auction.status == status)
    # Drop expired-but-not-yet-marked-ended rows for active queries. The
    # mark-stale job lags behind the cron schedule, so without this guard
    # past rows occupy the first slots of the ending-soonest sort.
    if status == "active":
        q = q.filter(Auction.end_time > datetime.utcnow())
    if driver:
        q = q.join(Card).filter(Card.driver_name.ilike(f"%{driver}%"))
    if snipe_only:
        q = q.filter(Auction.snipe_eligible == True)
    if buying == "auction":
        q = q.filter(Auction.buying_options.like('%AUCTION%'))
    elif buying == "bin":
        q = q.filter((Auction.buying_options == None) | (~Auction.buying_options.like('%AUCTION%')))
    total = q.count()
    # Sort ending-soonest first so auction listings (which expire today) always
    # appear before BIN listings (which may expire in 30+ days).
    auctions = q.order_by(Auction.end_time.asc()).offset(offset).limit(limit).all()
    # Vercel Edge cache: fresh 60s, serve stale up to 59s more while revalidating.
    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=60, stale-while-revalidate=59"
    return {"total": total, "auctions": [auction_to_dict(a) for a in auctions]}


# Module-level median cache with TTL. Keyed by (driver, parallel, grade) →
# (median, n_comps, expires_at). SoldCard data only changes when the sold_ingest
# cron runs, so a 5-minute TTL is safe and makes `with-verdicts` ~50x faster.
_MEDIAN_CACHE: dict = {}
_MEDIAN_TTL_SEC = 300
# Persistent precomputed-median table is fresh enough to trust for 48h.
# Refresh cron at /api/cron/refresh-comp-medians runs daily at 04:15 UTC.
_COMP_MEDIAN_MAX_AGE_SEC = 48 * 3600

def _cached_median(db, driver, parallel, grade):
    """Return (median_total, n_comps) for this (driver, parallel, grade).

    Lookup order (fastest → slowest):
      1. In-process TTL cache (5 min) — hot path for repeated calls in
         the same lambda instance.
      2. Persistent `comp_medians` table — populated nightly by
         /api/cron/refresh-comp-medians. Trusted if computed_at < 48h ago.
      3. Live `median_comp_price()` against `sold_cards` — fallback when
         the precompute is missing or stale. Result is written back to
         `comp_medians` so the next call within 48h hits step 2.
    """
    from scraper import median_comp_price
    from database import CompMedian
    now_dt = datetime.utcnow()
    now = now_dt.timestamp()
    k = (driver, parallel, grade)
    hit = _MEDIAN_CACHE.get(k)
    if hit and hit[2] > now:
        return (hit[0], hit[1])

    # Step 2: persistent precomputed table.
    med = None
    n = 0
    try:
        row = (
            db.query(CompMedian)
            .filter(
                CompMedian.driver_name == driver,
                CompMedian.parallel == parallel,
                CompMedian.grade == grade,
                CompMedian.days == 90,
            )
            .first()
        )
        if row and row.computed_at and (now_dt - row.computed_at).total_seconds() < _COMP_MEDIAN_MAX_AGE_SEC:
            med, n = float(row.median_total), int(row.n_comps)
            _MEDIAN_CACHE[k] = (med, n, now + _MEDIAN_TTL_SEC)
            return (med, n)
    except Exception as _cm_err:
        import logging
        logging.getLogger("auctions").debug(f"comp_medians lookup failed: {_cm_err}")

    # Step 3: fallback to live computation, then backfill comp_medians so the
    # next caller hits the persistent layer.
    med, n = median_comp_price(db, driver, parallel, grade)
    _MEDIAN_CACHE[k] = (med, n, now + _MEDIAN_TTL_SEC)
    if med is not None and n > 0:
        try:
            _upsert_comp_median(db, driver, parallel, grade, med, n, 90, now_dt)
        except Exception as _wb_err:
            import logging
            logging.getLogger("auctions").debug(f"comp_medians backfill skipped: {_wb_err}")
    # Bound the cache so it can't grow without bound.
    if len(_MEDIAN_CACHE) > 5000:
        # Drop expired entries first, then half of the rest if still oversized.
        expired = [kk for kk, vv in _MEDIAN_CACHE.items() if vv[2] <= now]
        for kk in expired:
            _MEDIAN_CACHE.pop(kk, None)
        if len(_MEDIAN_CACHE) > 5000:
            for kk in list(_MEDIAN_CACHE.keys())[:2500]:
                _MEDIAN_CACHE.pop(kk, None)
    return (med, n)


def _upsert_comp_median(db, driver, parallel, grade, median_total, n_comps, days, computed_at):
    """Insert or update one row in `comp_medians`. Postgres uses ON CONFLICT;
    SQLite falls back to a SELECT-then-INSERT/UPDATE so local dev still works."""
    from sqlalchemy import text
    from database import CompMedian, engine as _engine
    is_pg = "postgresql" in str(_engine.url)
    if is_pg:
        db.execute(
            text(
                "INSERT INTO comp_medians (driver_name, parallel, grade, median_total, n_comps, days, computed_at) "
                "VALUES (:dn, :par, :gr, :med, :n, :days, :ts) "
                "ON CONFLICT ON CONSTRAINT uq_comp_med_combo DO UPDATE SET "
                "median_total = EXCLUDED.median_total, "
                "n_comps = EXCLUDED.n_comps, "
                "computed_at = EXCLUDED.computed_at"
            ),
            {"dn": driver, "par": parallel, "gr": grade,
             "med": float(median_total), "n": int(n_comps),
             "days": int(days), "ts": computed_at},
        )
        db.commit()
    else:
        existing = (
            db.query(CompMedian)
            .filter(
                CompMedian.driver_name == driver,
                CompMedian.parallel == parallel,
                CompMedian.grade == grade,
                CompMedian.days == days,
            )
            .first()
        )
        if existing:
            existing.median_total = float(median_total)
            existing.n_comps = int(n_comps)
            existing.computed_at = computed_at
        else:
            db.add(CompMedian(
                driver_name=driver, parallel=parallel, grade=grade,
                median_total=float(median_total), n_comps=int(n_comps),
                days=int(days), computed_at=computed_at,
            ))
        db.commit()


@router.get("/with-verdicts")
def list_with_verdicts(
    status: Optional[str] = "active",
    buying: Optional[str] = None,
    snipe_only: bool = False,
    driver: Optional[str] = None,
    limit: int = Query(500, le=1000),
    offset: int = 0,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """
    Same shape as GET /api/auctions, but each auction row also carries a
    `verdict_comp` block (median, n, low_confidence) and a `verdict` string
    (STRONG_BUY / GOOD_BUY / FAIR / OVERPRICED / PASS / null) computed
    server-side. Lets the frontend filter by verdict without N round-trips
    to /api/sales/median.

    Median lookup is keyed by (driver, parallel, grade-extracted-from-title)
    and cached in-process for the duration of the request — so a page of
    500 listings only does ~30-50 DB queries, not 500.
    """
    from scraper import _extract_grade_from_title

    q = db.query(Auction).options(joinedload(Auction.card))
    if status:
        q = q.filter(Auction.status == status)
    # When asking for active rows, drop anything whose end_time has already
    # passed. The 'mark stale auctions as ended' job runs once per Playwright
    # cycle and can lag — without this guard, expired rows occupy the first
    # 500 slots of the ending-soonest sort and the dashboard never reaches
    # actual-live data buried further down.
    if status == "active":
        q = q.filter(Auction.end_time > datetime.utcnow())
    if driver:
        q = q.join(Card).filter(Card.driver_name.ilike(f"%{driver}%"))
    if snipe_only:
        q = q.filter(Auction.snipe_eligible == True)
    if buying == "auction":
        q = q.filter(Auction.buying_options.like('%AUCTION%'))
    elif buying == "bin":
        q = q.filter((Auction.buying_options == None) | (~Auction.buying_options.like('%AUCTION%')))
    total = q.count()
    rows = q.order_by(Auction.end_time.asc()).offset(offset).limit(limit).all()

    out = []
    strong_buy = good_buy = 0
    for a in rows:
        try:
            d = auction_to_dict(a)
        except Exception as _row_err:
            import logging
            logging.getLogger("auctions").warning(f"row serialize fail id={a.id}: {_row_err}")
            continue
        driver_name = a.card.driver_name if a.card else None
        parallel = a.card.parallel if a.card else None
        grade = _extract_grade_from_title(a.title or "")
        verdict_key = None
        comp_block = None
        if driver_name:
            try:
                median, n_comps = _cached_median(db, driver_name, parallel, grade)
            except Exception as _comp_err:
                # Verdict comp fetch shouldn't break the whole feed —
                # surface the listing without a verdict and move on.
                import logging
                logging.getLogger("auctions").warning(f"comp fetch fail {driver_name}/{parallel}: {_comp_err}")
                median, n_comps = None, 0
            if median and n_comps >= 3:
                cur_total = (a.current_price or 0) + (a.shipping_cost or 0)
                ratio = cur_total / median if median > 0 else 0
                # SANITY BOUND — listing is wildly above the comp median.
                # In practice this means the listing's parallel was MISPARSED
                # (e.g. a SuperFractor Auto detected as plain "Refractor"
                # because both words appear in the title). The median is
                # then misleading and any verdict would be unsafe. Surface
                # the raw price with no verdict and no comp block — honest
                # silence beats a wrong STRONG_BUY. (See Antonelli Refractor
                # $3,150 vs $35 median trust-killer incident.)
                if cur_total >= median * 5 and median > 0:
                    verdict_key = None
                    comp_block = None
                # Tighter confidence: STRONG_BUY requires n_comps >= 10 AND
                # a non-trivial listing price ($5+) to avoid math-volatility
                # on penny auctions. With only 3-9 comps a "<=0.6 of median"
                # ratio is too noisy to endorse as STRONG_BUY — demote to
                # GOOD_BUY's range.
                elif ratio <= 0.6 and n_comps >= 10 and cur_total >= 5:
                    verdict_key = "STRONG_BUY"; strong_buy += 1
                    comp_block = {
                        "median_total": round(median, 2),
                        "n": n_comps,
                        "low_confidence": n_comps < 10,
                    }
                else:
                    if ratio <= 0.8:
                        verdict_key = "GOOD_BUY"; good_buy += 1
                    elif ratio <= 1.05:
                        verdict_key = "FAIR"
                    elif ratio <= 1.25:
                        verdict_key = "OVERPRICED"
                    else:
                        verdict_key = "PASS"
                    comp_block = {
                        "median_total": round(median, 2),
                        "n": n_comps,
                        "low_confidence": n_comps < 10,
                    }
            elif median:
                comp_block = {
                    "median_total": round(median, 2),
                    "n": n_comps,
                    "low_confidence": True,
                }
        d["verdict"] = verdict_key
        d["verdict_comp"] = comp_block
        out.append(d)

    if response is not None:
        # 5min fresh + 30min stale-while-revalidate. Cold-start of this
        # endpoint is ~15s; long cache means visitors after the first only
        # hit the warm CDN copy. The /api/cron/keepalive cron pre-warms
        # before the cache window expires so visitors never see cold.
        response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=1800"
    return {
        "total": total,
        "auctions": out,
        "verdict_counts": {
            "STRONG_BUY": strong_buy,
            "GOOD_BUY": good_buy,
            "with_comps": sum(1 for x in out if x["verdict_comp"]),
        },
    }


# Per-IP rate limit for the public refresh-stale trigger. Keyed by client IP →
# last-successful-trigger UNIX seconds. 5-minute minimum gap to protect eBay
# quota from accidental button-mash / many-tab scenarios.
_REFRESH_STALE_TS: dict = {}
_REFRESH_STALE_MIN_GAP_SEC = 300


@router.post("/refresh-stale")
async def refresh_stale_listings(request: Request, db: Session = Depends(get_db)):
    """
    Public, IP-rate-limited trigger for a fresh eBay pull.

    Frontend hits this when the visible auctions list looks stale (>10 min
    since any row updated). Fires `sync_real_ebay_listings(db)` which
    refreshes active listings in place. NOT admin-gated — this is
    considered a read-side cache warm, not a write — but clamped to once
    per 5 min per IP to prevent abuse.
    """
    from scraper import sync_real_ebay_listings
    now_ts = datetime.utcnow().timestamp()
    # Resolve client IP (trusts X-Forwarded-For when behind a proxy / Vercel).
    try:
        xff = request.headers.get("x-forwarded-for") if request else None
        ip = (xff.split(",")[0].strip() if xff else None) or (request.client.host if request and request.client else "unknown")
    except Exception:
        ip = "unknown"
    last = _REFRESH_STALE_TS.get(ip, 0)
    if now_ts - last < _REFRESH_STALE_MIN_GAP_SEC:
        return {
            "status": "throttled",
            "retry_in": int(_REFRESH_STALE_MIN_GAP_SEC - (now_ts - last)),
            "added": 0,
        }
    # Mark up front so concurrent calls from the same IP don't double-fire.
    _REFRESH_STALE_TS[ip] = now_ts
    # Opportunistic cleanup so the dict can't grow forever.
    if len(_REFRESH_STALE_TS) > 5000:
        cutoff = now_ts - _REFRESH_STALE_MIN_GAP_SEC * 4
        for k, v in list(_REFRESH_STALE_TS.items()):
            if v < cutoff:
                _REFRESH_STALE_TS.pop(k, None)
    try:
        added = await sync_real_ebay_listings(db)
        db.commit()
        return {"status": "ok", "added": int(added or 0)}
    except Exception as e:
        logger.warning(f"refresh-stale failed: {e}")
        return {"status": "error", "error": str(e)[:200], "added": 0}


# --------------------------------------------------------------------------
# SECURITY TODO (bid-auth gap)
# --------------------------------------------------------------------------
# No `execute-snipe` / `place-bid` endpoint currently exists on the backend.
# The frontend uses Supabase auth; if/when a live-bidding endpoint is added
# here (e.g. POST /api/auctions/{id}/execute-snipe or /place-bid), it MUST:
#   1. Parse `Authorization: Bearer <token>` from the request.
#   2. Verify the Supabase JWT (`python-jose` is NOT currently in
#      requirements.txt — either add it, or until then have the endpoint
#      return HTTP 503 "manual auth pending implementation" so it cannot
#      be exploited anonymously).
#   3. Sanity-check the decoded token has a non-empty `sub` claim before
#      performing any spend-money / place-bid action.
#   4. Enforce per-user ownership — the bid must belong to the JWT's `sub`,
#      never be acted on behalf of another user.
# Do NOT ship a live bid endpoint without these checks.
# --------------------------------------------------------------------------


@router.get("/snipe/targets")
def snipe_targets(response: Response = None, db: Session = Depends(get_db)):
    from datetime import timedelta
    now = datetime.utcnow()
    # Try snipe_eligible first (best signal). If <5 results, fall back to top
    # active auctions by snipe_score — prevents dashboard showing "0 snipes"
    # when the scorer hasn't run or flagged few rows.
    eligible = db.query(Auction).filter(
        Auction.status == "active",
        Auction.snipe_eligible == True,
        Auction.end_time > now,
    ).order_by(Auction.snipe_score.desc()).limit(20).all()
    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=120, stale-while-revalidate=600"
    if len(eligible) >= 5:
        return {"targets": [auction_to_dict(a) for a in eligible]}
    # Fallback: top active auctions ending within 48h, any score.
    fallback = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time > now,
        Auction.end_time <= now + timedelta(hours=48),
    ).order_by(Auction.snipe_score.desc().nullslast(), Auction.end_time.asc()).limit(20).all()
    return {"targets": [auction_to_dict(a) for a in fallback]}


@router.get("/watchlist/all")
def get_watchlist(db: Session = Depends(get_db)):
    """Return all watchlisted auctions."""
    auctions = (
        db.query(Auction)
        .filter(Auction.status == "watchlist")
        .order_by(Auction.snipe_score.desc())
        .all()
    )
    return {"auctions": [auction_to_dict(a) for a in auctions], "total": len(auctions)}


@router.get("/{auction_id}")
def get_auction(auction_id: int, db: Session = Depends(get_db)):
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        from fastapi import HTTPException
        raise HTTPException(404, "Auction not found")
    return auction_to_dict(a)


@router.post("/{auction_id}/watchlist")
def toggle_watchlist(auction_id: int, db: Session = Depends(get_db)):
    """Toggle an auction between active and watchlist status."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")
    if a.status == "watchlist":
        a.status = "active"
        watching = False
    else:
        a.status = "watchlist"
        watching = True
    db.commit()
    return {"watching": watching, "status": a.status, "id": a.id}


@router.get("/{auction_id}/details")
async def get_auction_details(auction_id: int, db: Session = Depends(get_db)):
    """Fetch full eBay item details including additional images and item specifics."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    base = auction_to_dict(a)

    # Only fetch live eBay details if we haven't already cached them on this row.
    # Saves hundreds of Browse API calls per day when users open modals for items
    # we've already enriched once.
    already_cached = bool(getattr(a, 'extra_images', None))
    ebay_details = None
    if a.is_real_ebay and a.ebay_listing_id and not already_cached:
        try:
            from ebay_api import get_item_details
            ebay_details = await get_item_details(a.ebay_listing_id)
        except Exception:
            pass

    if ebay_details:
        imgs = ebay_details.get("images", [base.get("image_url", "")])
        base["extra_images"] = imgs
        base["item_specifics"] = ebay_details.get("item_specifics", {})
        base["description"] = ebay_details.get("description", "")
        base["condition_description"] = ebay_details.get("condition_description", "")
        base["seller_feedback_pct"] = ebay_details.get("seller_feedback_pct")
        base["returns_accepted"] = ebay_details.get("returns_accepted", False)
        base["item_location"] = ebay_details.get("item_location", "US")
        base["quantity_sold"] = ebay_details.get("quantity_sold", 0)
        # Cache images back to DB so they display without re-fetching
        if imgs and not getattr(a, 'extra_images', None):
            a.extra_images = json.dumps(imgs)
            db.commit()
    else:
        # Return what we have stored
        stored_imgs = json.loads(a.extra_images) if getattr(a, 'extra_images', None) else []
        base["extra_images"] = stored_imgs if stored_imgs else ([a.image_url] if a.image_url else [])
        base["item_specifics"] = {}
        base["description"] = ""
        base["condition_description"] = ""
        base["seller_feedback_pct"] = None
        base["returns_accepted"] = False
        base["item_location"] = "US"
        base["quantity_sold"] = 0

    return base


@router.get("/{auction_id}/seller")
async def get_seller_info(auction_id: int, db: Session = Depends(get_db)):
    """Return seller profile data for an auction."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    # Compute seller tier based on feedback score
    fb = a.seller_feedback or 0
    if fb >= 10000:
        tier = "Top Rated Plus"
        tier_color = "gold"
    elif fb >= 1000:
        tier = "Top Rated"
        tier_color = "green"
    elif fb >= 100:
        tier = "Established"
        tier_color = "blue"
    elif fb >= 10:
        tier = "Developing"
        tier_color = "gray"
    else:
        tier = "New"
        tier_color = "gray"

    return {
        "seller": a.seller,
        "feedback_score": fb,
        "tier": tier,
        "tier_color": tier_color,
        "ebay_seller_url": f"https://www.ebay.com/usr/{a.seller}" if a.seller else None,
        "auctions_from_seller": db.query(Auction).filter(
            Auction.seller == a.seller,
            Auction.status.in_(["active", "watchlist"]),
        ).count(),
    }


@router.get("/{auction_id}/refresh")
async def refresh_listing_status(
    auction_id: int,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Fetch fresh listing status from eBay. Browse API quota saver:
      1. If the auction was last_updated < 5 min ago, return DB row WITHOUT
         hitting eBay (BiggestSnipes' auto-refresh fires every 10min for ~12
         visible cards; without this gate every dashboard view burns 12+
         Browse API calls).
      2. CDN cache the response 60s with stale-while-revalidate=300 so even
         multiple users viewing the same dashboard share one upstream call.
    """
    from datetime import timedelta
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    # Quota guard: skip eBay if the row is fresh enough.
    fresh_skip = False
    if a.last_updated and (datetime.utcnow() - a.last_updated) < timedelta(minutes=5):
        fresh_skip = True

    if not fresh_skip and a.is_real_ebay and a.ebay_listing_id:
        try:
            from ebay_api import get_item_details
            item = await get_item_details(a.ebay_listing_id)
            if item:
                a.current_price = item.get("current_price", a.current_price)
                a.bid_count = item.get("bid_count", a.bid_count)
                a.buying_options = json.dumps(item.get("buying_options", []))
                fresh_seller = (item.get("seller") or "").strip()
                if fresh_seller and fresh_seller.lower() not in ("ebay_seller", "unknown", "unknown_seller"):
                    a.seller = fresh_seller
                fresh_fb = item.get("seller_feedback_score")
                if isinstance(fresh_fb, int) and fresh_fb > 0:
                    a.seller_feedback = fresh_fb
                a.last_updated = datetime.utcnow()
                db.commit()
        except Exception:
            pass

    # Vercel CDN cache: 60s fresh, 5min stale-while-revalidate. Repeated hits
    # within the same minute share one origin response.
    response.headers["Cache-Control"] = "public, s-maxage=60, stale-while-revalidate=300"

    data = auction_to_dict(a)
    now = datetime.utcnow()
    data["is_expired"] = (a.end_time is not None) and (a.end_time <= now)
    data["freshly_fetched"] = True
    return data


@router.get("/{auction_id}/bid-history")
def get_bid_history(auction_id: int, db: Session = Depends(get_db)):
    """Return synthetic bid history derived from stored auction data."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    # eBay Browse API doesn't expose raw bid history without user OAuth.
    # Return a synthetic activity summary from what's stored.
    bids = a.bid_count or 0
    now = datetime.utcnow()
    created = a.created_at or now

    # Reconstruct estimated bid timeline
    history = []
    if bids > 0 and a.end_time:
        total_seconds = (a.end_time - created).total_seconds()
        for i in range(min(bids, 10)):  # Show up to 10 estimated bid events
            frac = (i + 1) / bids
            est_time = created.timestamp() + total_seconds * frac * 0.9
            from datetime import timezone
            history.append({
                "bid_number": i + 1,
                "estimated_at": datetime.utcfromtimestamp(est_time).isoformat(),
                "note": "Bid placed" if i < bids - 1 else "Current high bid",
            })

    return {
        "auction_id": auction_id,
        "ebay_listing_id": a.ebay_listing_id,
        "total_bids": bids,
        "current_price": a.current_price,
        "bid_history": history,
        "is_real_ebay": a.is_real_ebay,
        "note": "Live bid-by-bid history requires eBay user OAuth. Showing estimated timeline.",
        "ebay_bid_url": f"{a.ebay_url}#bidHistory" if a.ebay_url else None,
    }


@router.get("/api/status/usage")
def get_api_usage_status():
    """Return eBay API usage stats and rate-limit status."""
    try:
        from scheduler import get_api_usage_status
        return get_api_usage_status()
    except Exception as e:
        logger.warning(f"Failed to fetch API usage status: {e}")
        return {
            "api_calls_today": 0,
            "daily_limit": 5000,
            "usage_percent": 0,
            "warning": False,
            "rate_limited": False,
            "cooldown_until": None,
            "time_to_reset_seconds": 0,
            "next_reset_at": None,
        }
