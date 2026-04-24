"""
PSA data layer — exposes three views:
- /pop:        official PSA population counts (from scraper, table psa_pop)
- /observed:   aggregated graded sales derived from our eBay sold_cards + auctions
- /sales:      individual graded sale records (combined psa_sales + sold_cards)
- /leaderboard: cross-driver rankings (total graded value, gem rate, volume)

Track A (/observed, /sales via sold_cards, /leaderboard) works today with only
the existing eBay-scraped data — no PSA scrape required.
"""
import os
from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_, case
from typing import Optional
from datetime import datetime, timedelta

from database import get_db, SoldCard, PsaPop, PsaSale, PsaPopSnapshot, Auction

router = APIRouter(prefix="/api/psa", tags=["psa"])


def _require_admin_or_cron(request: Request) -> None:
    """Gate admin-only PSA actions — matches /api/ebay/refresh auth pattern.
    Accepts ADMIN_TOKEN via ?token=, X-Admin-Token header, or vercel-cron UA."""
    admin_token = os.getenv("ADMIN_TOKEN", "")
    qtoken = request.query_params.get("token", "")
    header_token = request.headers.get("x-admin-token", "")
    ua = request.headers.get("user-agent", "").lower()
    if "vercel-cron" in ua:
        return
    if not admin_token or (qtoken != admin_token and header_token != admin_token):
        raise HTTPException(status_code=401, detail="unauthorized")


GRADE_ORDER = [
    "PSA 10", "PSA 9.5", "PSA 9", "PSA 8.5", "PSA 8", "PSA 7",
    "PSA 6", "PSA 5", "PSA 4", "PSA 3", "PSA 2", "PSA 1",
    "BGS 10", "BGS 9.5", "BGS 9", "BGS 8.5", "BGS 8",
    "SGC 10", "SGC 9.5", "SGC 9",
    "CGC 10", "CGC 9.5", "CGC 9",
]


def _grade_sort_key(g: str) -> int:
    try:
        return GRADE_ORDER.index(g)
    except ValueError:
        return 999


@router.get("/pop")
def pop_data(
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    set_year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Official PSA population data (from psa_pop table, populated by scraper)."""
    q = db.query(PsaPop)
    if driver:
        q = q.filter(PsaPop.driver_name.ilike(f"%{driver}%"))
    if parallel:
        q = q.filter(PsaPop.parallel == parallel)
    if set_year:
        q = q.filter(PsaPop.set_year == set_year)

    rows = q.order_by(PsaPop.driver_name, PsaPop.parallel, PsaPop.grade).all()
    by_driver: dict = {}
    for r in rows:
        key = r.driver_name or "Unknown"
        by_driver.setdefault(key, []).append({
            "set_year": r.set_year,
            "set_name": r.set_name,
            "card_num": r.card_num,
            "parallel": r.parallel,
            "grade": r.grade,
            "pop_count": r.pop_count,
            "pop_higher": r.pop_higher,
            "source_url": r.source_url,
            "last_scraped": r.last_scraped.isoformat() if r.last_scraped else None,
        })
    return {
        "total_rows": len(rows),
        "drivers": by_driver,
        "psa_indexed": len(rows) > 0,
    }


@router.get("/observed")
def observed_aggregates(
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Derived 'observed population' from our eBay sold_cards + active auctions.
    Honest label: this is what WE have seen in market data, not PSA's pop report.

    Returns per-grade aggregates + per-parallel-per-grade breakdown.
    """
    q = db.query(SoldCard).filter(SoldCard.grade.isnot(None), SoldCard.is_duplicate == False)  # noqa: E712
    if driver:
        q = q.filter(SoldCard.driver_name.ilike(f"%{driver}%"))
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    sold = q.all()

    # Active auction graded listings — observed as additional supply
    aq = db.query(Auction).filter(Auction.status == "active")
    if driver:
        # Auctions don't have driver_name directly; filter via title
        aq = aq.filter(Auction.title.ilike(f"%{driver}%"))
    auction_graded = []
    for a in aq.limit(500).all():
        t = (a.title or "").upper()
        # Fast grade extraction
        grade = None
        for g in ("PSA 10", "PSA 9.5", "PSA 9", "PSA 8.5", "PSA 8",
                  "BGS 9.5", "BGS 9", "SGC 10", "SGC 9.5"):
            if g in t:
                grade = g
                break
        if grade:
            auction_graded.append({"grade": grade, "price": a.current_price})

    # Per-grade stats (sold)
    per_grade: dict = {}
    for s in sold:
        g = s.grade or "Unknown"
        d = per_grade.setdefault(g, {
            "grade": g, "count": 0, "sum_price": 0.0,
            "min_price": None, "max_price": None,
            "most_recent_price": None, "most_recent_date": None,
        })
        d["count"] += 1
        if s.sale_price:
            d["sum_price"] += s.sale_price
            d["min_price"] = s.sale_price if d["min_price"] is None else min(d["min_price"], s.sale_price)
            d["max_price"] = s.sale_price if d["max_price"] is None else max(d["max_price"], s.sale_price)
            # Track most recent sale
            sd = s.sale_date
            if sd and (d["most_recent_date"] is None or sd > d["most_recent_date"]):
                d["most_recent_date"] = sd
                d["most_recent_price"] = s.sale_price

    per_grade_out = []
    for g, d in per_grade.items():
        avg = d["sum_price"] / d["count"] if d["count"] else 0
        per_grade_out.append({
            "grade": g,
            "count": d["count"],
            "avg_price": round(avg, 2),
            "min_price": round(d["min_price"], 2) if d["min_price"] else None,
            "max_price": round(d["max_price"], 2) if d["max_price"] else None,
            "most_recent_price": round(d["most_recent_price"], 2) if d["most_recent_price"] else None,
            "most_recent_date": d["most_recent_date"].isoformat() if d["most_recent_date"] else None,
        })
    per_grade_out.sort(key=lambda x: _grade_sort_key(x["grade"]))

    # Per-parallel per-grade breakdown
    breakdown: dict = {}
    for s in sold:
        par = s.parallel or "Unknown"
        g = s.grade or "Unknown"
        key = (par, g)
        d = breakdown.setdefault(key, {"parallel": par, "grade": g, "count": 0, "sum_price": 0.0})
        d["count"] += 1
        if s.sale_price:
            d["sum_price"] += s.sale_price
    breakdown_out = [
        {"parallel": k[0], "grade": k[1], "count": d["count"],
         "avg_price": round(d["sum_price"] / d["count"], 2) if d["count"] else 0}
        for k, d in breakdown.items()
    ]
    breakdown_out.sort(key=lambda x: (-x["count"], x["parallel"]))

    # Gem rate = PSA 10 count / total graded
    total_graded = len(sold)
    psa_10_count = sum(1 for s in sold if s.grade == "PSA 10")
    gem_rate = (psa_10_count / total_graded * 100) if total_graded else 0

    # Total $ moved
    total_graded_value = sum((s.sale_price or 0) for s in sold)

    # Raw comparison (non-graded sales of same driver/parallel)
    raw_q = db.query(SoldCard).filter(SoldCard.grade.is_(None), SoldCard.is_duplicate == False)  # noqa: E712
    if driver:
        raw_q = raw_q.filter(SoldCard.driver_name.ilike(f"%{driver}%"))
    if parallel:
        raw_q = raw_q.filter(SoldCard.parallel == parallel)
    raw_count = raw_q.count()
    raw_avg = raw_q.with_entities(func.avg(SoldCard.sale_price)).scalar()

    return {
        "driver": driver,
        "parallel": parallel,
        "source": "eBay observed sales (sold_cards)",
        "per_grade": per_grade_out,
        "breakdown": breakdown_out[:50],
        "total_graded_sales": total_graded,
        "total_graded_value": round(total_graded_value, 2),
        "gem_rate_pct": round(gem_rate, 2),
        "psa_10_count": psa_10_count,
        "raw_sales_count": raw_count,
        "raw_avg_price": round(float(raw_avg), 2) if raw_avg else None,
        "active_graded_auctions": len(auction_graded),
    }


@router.get("/sales")
def graded_sales(
    driver: Optional[str] = None,
    grade: Optional[str] = None,
    parallel: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Individual graded sale records, combined from PsaSale + sold_cards (where grade is set)."""
    results = []

    # From PsaSale (PSA APR / curated sources)
    pq = db.query(PsaSale)
    if driver:
        pq = pq.filter(PsaSale.driver_name.ilike(f"%{driver}%"))
    if grade:
        pq = pq.filter(PsaSale.grade == grade)
    if parallel:
        pq = pq.filter(PsaSale.parallel == parallel)
    for s in pq.order_by(desc(PsaSale.sale_date)).limit(limit * 2).all():
        results.append({
            "source": s.source or "PSA APR",
            "auction_house": s.auction_house,
            "driver_name": s.driver_name,
            "parallel": s.parallel,
            "grade": s.grade,
            "price": s.price,
            "sale_date": s.sale_date.isoformat() if s.sale_date else None,
            "title": s.title,
            "image_url": s.image_url,
            "listing_url": s.listing_url,
        })

    # From sold_cards (eBay observed graded)
    sq = db.query(SoldCard).filter(SoldCard.grade.isnot(None), SoldCard.is_duplicate == False)  # noqa: E712
    if driver:
        sq = sq.filter(SoldCard.driver_name.ilike(f"%{driver}%"))
    if grade:
        sq = sq.filter(SoldCard.grade == grade)
    if parallel:
        sq = sq.filter(SoldCard.parallel == parallel)
    for s in sq.order_by(desc(SoldCard.sale_date)).limit(limit * 2).all():
        results.append({
            "source": "eBay",
            "auction_house": None,
            "driver_name": s.driver_name,
            "parallel": s.parallel,
            "grade": s.grade,
            "price": s.sale_price,
            "sale_date": s.sale_date.isoformat() if s.sale_date else None,
            "title": s.title,
            "image_url": s.image_url,
            "listing_url": s.ebay_url,
        })

    # Sort combined by date desc and page
    results.sort(key=lambda x: x.get("sale_date") or "", reverse=True)
    paged = results[offset: offset + limit]
    return {"total": len(results), "sales": paged}


@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    """
    Cross-driver rankings from observed sold_cards data.
    - top_by_total_value: driver with most $ graded moved
    - top_by_gem_rate: driver with highest % PSA 10s (min 3 graded)
    - top_by_volume: driver with most graded sales
    - top_parallels: highest-value parallels across all drivers
    - kpis: total tracked value + counts
    """
    # Total graded value per driver
    drv_rows = db.query(
        SoldCard.driver_name,
        func.count(SoldCard.id).label("total_graded"),
        func.sum(SoldCard.sale_price).label("total_value"),
        func.sum(case((SoldCard.grade == "PSA 10", 1), else_=0)).label("psa_10"),
        func.avg(SoldCard.sale_price).label("avg_price"),
    ).filter(
        SoldCard.grade.isnot(None),
        SoldCard.driver_name.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.driver_name).all()

    top_value = sorted(drv_rows, key=lambda r: -(r.total_value or 0))[:15]
    top_volume = sorted(drv_rows, key=lambda r: -(r.total_graded or 0))[:15]
    gem_rate_candidates = [r for r in drv_rows if (r.total_graded or 0) >= 3]
    top_gem = sorted(
        gem_rate_candidates,
        key=lambda r: -((r.psa_10 or 0) / (r.total_graded or 1)),
    )[:15]

    # Top parallels
    par_rows = db.query(
        SoldCard.parallel,
        func.count(SoldCard.id).label("count"),
        func.sum(SoldCard.sale_price).label("total_value"),
        func.avg(SoldCard.sale_price).label("avg_price"),
    ).filter(
        SoldCard.grade.isnot(None),
        SoldCard.parallel.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.parallel).order_by(desc("total_value")).limit(20).all()

    # KPIs
    total_graded_sales = db.query(func.count(SoldCard.id)).filter(SoldCard.grade.isnot(None)).scalar() or 0
    total_graded_value = db.query(func.sum(SoldCard.sale_price)).filter(SoldCard.grade.isnot(None)).scalar() or 0
    drivers_with_psa10 = db.query(func.count(func.distinct(SoldCard.driver_name))).filter(
        SoldCard.grade == "PSA 10"
    ).scalar() or 0
    total_psa_pop_rows = db.query(func.count(PsaPop.id)).scalar() or 0
    total_psa_apr_rows = db.query(func.count(PsaSale.id)).scalar() or 0

    return {
        "kpis": {
            "total_graded_sales_tracked": total_graded_sales,
            "total_graded_value": round(float(total_graded_value), 2),
            "drivers_with_psa10": drivers_with_psa10,
            "psa_pop_rows": total_psa_pop_rows,
            "psa_apr_sales": total_psa_apr_rows,
        },
        "top_by_total_value": [
            {"driver": r.driver_name, "total_value": round(float(r.total_value or 0), 2),
             "total_graded": r.total_graded, "psa_10": int(r.psa_10 or 0)}
            for r in top_value
        ],
        "top_by_volume": [
            {"driver": r.driver_name, "total_graded": r.total_graded,
             "total_value": round(float(r.total_value or 0), 2),
             "avg_price": round(float(r.avg_price or 0), 2)}
            for r in top_volume
        ],
        "top_by_gem_rate": [
            {"driver": r.driver_name,
             "gem_rate_pct": round(((r.psa_10 or 0) / (r.total_graded or 1)) * 100, 2),
             "psa_10": int(r.psa_10 or 0),
             "total_graded": r.total_graded}
            for r in top_gem
        ],
        "top_parallels": [
            {"parallel": r.parallel, "count": r.count,
             "total_value": round(float(r.total_value or 0), 2),
             "avg_price": round(float(r.avg_price or 0), 2)}
            for r in par_rows
        ],
    }


# ---------------------------------------------------------------------------
# PSA Pop snapshots — weekly rollup + pop-delta reporting
# ---------------------------------------------------------------------------

def capture_pop_snapshot(db: Session) -> dict:
    """Insert a PsaPopSnapshot row per (driver, parallel, grade) from the
    current PsaPop table. Idempotent per UTC date — if a snapshot already
    exists for today, returns a skip result without re-inserting.
    """
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today_start + timedelta(days=1)

    existing_today = db.query(func.count(PsaPopSnapshot.id)).filter(
        PsaPopSnapshot.snapshot_date >= today_start,
        PsaPopSnapshot.snapshot_date < tomorrow,
    ).scalar() or 0
    if existing_today:
        return {"ok": True, "skipped": True, "reason": "snapshot_exists_today",
                "existing_rows": int(existing_today)}

    pop_rows = db.query(PsaPop).filter(PsaPop.driver_name.isnot(None)).all()
    now = datetime.utcnow()
    inserted = 0
    for r in pop_rows:
        db.add(PsaPopSnapshot(
            driver_name=r.driver_name,
            parallel=r.parallel,
            grade=r.grade,
            pop_count=int(r.pop_count or 0),
            snapshot_date=now,
        ))
        inserted += 1
    db.commit()
    return {"ok": True, "skipped": False, "inserted": inserted,
            "snapshot_date": now.isoformat()}


@router.api_route("/snapshot", methods=["GET", "POST"])
def snapshot_pop(request: Request, db: Session = Depends(get_db)):
    """Admin-gated — capture today's PSA pop snapshot. Run via Vercel cron
    (weekly Sunday 06:00 UTC, which hits via GET) or manually with ?token=<ADMIN_TOKEN>."""
    _require_admin_or_cron(request)
    try:
        return capture_pop_snapshot(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"snapshot_failed: {str(e)[:200]}")


@router.get("/deltas")
def pop_deltas(
    days: int = Query(7, ge=1, le=365),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Top pop-count changes over the last N days.

    For each (driver, parallel, grade), compute:
      delta = latest_snapshot.pop_count - earliest_snapshot_in_window.pop_count
    Rank by absolute delta, return top `limit`.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.query(
        PsaPopSnapshot.driver_name,
        PsaPopSnapshot.parallel,
        PsaPopSnapshot.grade,
        PsaPopSnapshot.pop_count,
        PsaPopSnapshot.snapshot_date,
    ).filter(PsaPopSnapshot.snapshot_date >= cutoff).order_by(
        PsaPopSnapshot.snapshot_date.asc()
    ).all()

    # Collapse to earliest+latest per (driver, parallel, grade)
    by_key: dict = {}
    for r in rows:
        key = (r.driver_name or "", r.parallel or "", r.grade or "")
        slot = by_key.setdefault(key, {"earliest": None, "latest": None})
        if slot["earliest"] is None or r.snapshot_date < slot["earliest"]["date"]:
            slot["earliest"] = {"pop": int(r.pop_count or 0), "date": r.snapshot_date}
        if slot["latest"] is None or r.snapshot_date > slot["latest"]["date"]:
            slot["latest"] = {"pop": int(r.pop_count or 0), "date": r.snapshot_date}

    deltas = []
    for (driver, parallel, grade), slot in by_key.items():
        if not slot["earliest"] or not slot["latest"]:
            continue
        earliest_pop = slot["earliest"]["pop"]
        latest_pop = slot["latest"]["pop"]
        delta = latest_pop - earliest_pop
        if delta == 0 and slot["earliest"]["date"] == slot["latest"]["date"]:
            # Single snapshot in window — no delta to report
            continue
        deltas.append({
            "driver_name": driver,
            "parallel": parallel or None,
            "grade": grade or None,
            "earliest_pop": earliest_pop,
            "latest_pop": latest_pop,
            "delta": delta,
            "earliest_date": slot["earliest"]["date"].isoformat() if slot["earliest"]["date"] else None,
            "latest_date": slot["latest"]["date"].isoformat() if slot["latest"]["date"] else None,
        })

    deltas.sort(key=lambda x: abs(x["delta"]), reverse=True)
    return {
        "days": days,
        "window_start": cutoff.isoformat(),
        "total_tracked": len(by_key),
        "with_change": sum(1 for d in deltas if d["delta"] != 0),
        "top": deltas[:limit],
    }
