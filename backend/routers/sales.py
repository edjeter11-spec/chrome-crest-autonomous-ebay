"""
Sales Database — queries against the SoldCard table.
"""
from fastapi import APIRouter, Depends, Query, Response, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from typing import Optional
import csv
import io

from database import get_db, SoldCard

router = APIRouter(prefix="/api/sales", tags=["sales"])


def _total_cost(s: SoldCard) -> float:
    return float((s.sale_price or 0) + (s.shipping_cost or 0))


def _sold_to_dict(s: SoldCard) -> dict:
    try:
        from lib.parallels import scarcity_for, is_rookie
        sc = scarcity_for(s.parallel)
        rookie = is_rookie(s.driver_name)
    except Exception:
        sc = {"tier": "-", "count": None, "rank": 99}
        rookie = False
    return {
        "id": s.id,
        "ebay_item_id": s.ebay_item_id,
        "title": s.title,
        "driver_name": s.driver_name,
        "parallel": s.parallel,
        "grade": s.grade,
        "condition": s.condition,
        "sale_price": s.sale_price,
        "shipping_cost": s.shipping_cost,
        "total_cost": round(_total_cost(s), 2),
        "sale_date": s.sale_date.isoformat() if s.sale_date else None,
        "image_url": s.image_url,
        "ebay_url": s.ebay_url,
        "is_auction": bool(s.is_auction),
        "is_duplicate": bool(getattr(s, "is_duplicate", False)),
        "series": s.series or "F1",
        "source": getattr(s, "source", None) or "eBay",
        "scarcity_tier": sc["tier"],
        "scarcity_count": sc["count"],
        "scarcity_rank": sc["rank"],
        "is_rookie": rookie,
        "scraped_at": s.scraped_at.isoformat() if s.scraped_at else None,
    }


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    v = sorted(values)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def _apply_filters(q, driver, parallel, grade, min_price, max_price,
                   date_from, date_to, is_auction, include_duplicates=False,
                   year=None, exclude_source=None, source=None):
    if not include_duplicates:
        q = q.filter(SoldCard.is_duplicate == False)  # noqa: E712
    if driver:
        q = q.filter(SoldCard.driver_name.ilike(f"%{driver}%"))
    if parallel:
        parts = [p.strip() for p in parallel.split(",") if p.strip()]
        if parts:
            q = q.filter(SoldCard.parallel.in_(parts))
    if grade:
        if grade.lower() == "graded":
            q = q.filter(SoldCard.grade.isnot(None))
        elif grade.lower() == "raw":
            q = q.filter(SoldCard.grade.is_(None))
        else:
            q = q.filter(SoldCard.grade == grade)
    if min_price is not None:
        q = q.filter(SoldCard.sale_price >= min_price)
    if max_price is not None:
        q = q.filter(SoldCard.sale_price <= max_price)
    if date_from:
        try:
            q = q.filter(SoldCard.sale_date >= datetime.fromisoformat(date_from))
        except Exception:
            pass
    if date_to:
        try:
            q = q.filter(SoldCard.sale_date <= datetime.fromisoformat(date_to))
        except Exception:
            pass
    if is_auction is not None:
        q = q.filter(SoldCard.is_auction == is_auction)
    if year:
        # Match a year token (e.g. "2025") in the title — cheap and works for
        # Topps Chrome F1 sets where the year is always in the title.
        q = q.filter(SoldCard.title.ilike(f"%{year}%"))
    if exclude_source and str(exclude_source).lower() != "none":
        q = q.filter((SoldCard.source != exclude_source) | (SoldCard.source.is_(None)))
    if source:
        q = q.filter(SoldCard.source == source)
    return q


@router.get("")
def list_sales(
    response: Response,
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    is_auction: Optional[bool] = None,
    include_duplicates: bool = False,
    year: Optional[str] = "2025",
    exclude_source: Optional[str] = "SportsCardsPro",
    source: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    # Default: 2025-only, exclude SCP synthetic benchmark rows (they're price-guide
    # entries, not real sales — and emit 3 rows per card which floods the feed).
    q = db.query(SoldCard)
    q = _apply_filters(q, driver, parallel, grade, min_price, max_price,
                       date_from, date_to, is_auction, include_duplicates,
                       year=year, exclude_source=exclude_source, source=source)
    sales = q.order_by(desc(SoldCard.sale_date)).offset(offset).limit(limit).all()
    # Vercel CDN cache: 5min fresh + 30min SWR. Sales only land via the
    # 2-3h scrape crons, so 30s freshness bought nothing — it just meant
    # the keepalive-warmed copy died long before the next */15 warm and
    # dashboard tiles (ticker / 7d sales) cold-started for real users.
    response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=1800"
    return {
        "total": None,  # was an expensive COUNT(*) — frontend doesn't use it
        "include_duplicates": include_duplicates,
        "sales": [_sold_to_dict(s) for s in sales],
    }


@router.post("/lookup-batch")
def lookup_sales_batch(
    body: dict,
    response: Response,
    db: Session = Depends(get_db),
):
    """Batched per-card recent-sales lookup. Body:
        {"queries": [{driver, parallel, grade?}, ...]}

    For each query tuple returns the latest 5 matching sales (id, sale_date,
    sale_price, total_cost). Result is keyed by the input index as a string,
    so the frontend can fan results back into per-card UI without a join key.

    Eliminates the N+1 fetch where Portfolio's scanned-card section calls
    `/api/sales?driver=...&parallel=...` once per card.
    """
    queries = body.get("queries") or []
    if not isinstance(queries, list):
        raise HTTPException(400, "queries must be a list")
    # Hard cap to keep one request bounded.
    queries = queries[:200]

    out: dict[str, list] = {}
    for i, q in enumerate(queries):
        if not isinstance(q, dict):
            out[str(i)] = []
            continue
        driver = q.get("driver") or q.get("driver_name")
        parallel = q.get("parallel")
        grade = q.get("grade")
        if not driver:
            out[str(i)] = []
            continue

        sub = db.query(SoldCard).filter(
            SoldCard.is_duplicate == False,  # noqa: E712
            SoldCard.driver_name.ilike(f"%{driver}%"),
        )
        if parallel:
            sub = sub.filter(SoldCard.parallel == parallel)
        if grade:
            if str(grade).lower() == "raw":
                sub = sub.filter(SoldCard.grade.is_(None))
            elif str(grade).lower() == "graded":
                sub = sub.filter(SoldCard.grade.isnot(None))
            else:
                sub = sub.filter(SoldCard.grade == grade)
        rows = sub.order_by(desc(SoldCard.sale_date)).limit(5).all()
        out[str(i)] = [
            {
                "id": r.id,
                "sale_date": r.sale_date.isoformat() if r.sale_date else None,
                "sale_price": float(r.sale_price) if r.sale_price is not None else None,
                "total": round(_total_cost(r), 2),
            }
            for r in rows
        ]

    # Edge cache 60s — sale data only updates on cron, fine to share across users.
    response.headers["Cache-Control"] = "public, s-maxage=60, stale-while-revalidate=300"
    return out


@router.get("/stats")
def sales_stats(
    response: Response,
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_duplicates: bool = False,
    db: Session = Depends(get_db),
):
    # 5min fresh + 30min SWR — matches the */15 keepalive warm cadence so
    # the Total Sales tile never cold-starts (stats move on cron cadence).
    response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=1800"
    q = db.query(SoldCard)
    q = _apply_filters(q, driver, parallel, grade, None, None,
                       date_from, date_to, None, include_duplicates)

    total_count = q.count()
    total_value = db.query(func.coalesce(func.sum(SoldCard.sale_price), 0)).filter(
        SoldCard.is_duplicate == False  # noqa: E712
    ).scalar() or 0

    cutoff = datetime.utcnow() - timedelta(days=7)
    week_count = db.query(func.count(SoldCard.id)).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.is_duplicate == False,  # noqa: E712
    ).scalar() or 0

    # Per-parallel: count, avg, median, max — median needed so PSA-10 outliers
    # don't drag the "typical" parallel price into the stratosphere.
    par_q = db.query(
        SoldCard.parallel, SoldCard.sale_price, SoldCard.shipping_cost
    ).filter(SoldCard.is_duplicate == False, SoldCard.parallel.isnot(None))  # noqa: E712
    par_bucket: dict[str, list[float]] = {}
    for pr, price, ship in par_q.all():
        if price is None or price <= 0:
            continue
        par_bucket.setdefault(pr, []).append(float(price) + float(ship or 0))
    parallel_rows = []
    for pr, vals in par_bucket.items():
        med = _median(vals)
        # P95 trim — single outlier $8,999 listing shouldn't define the "max"
        svals = sorted(vals)
        p95_idx = min(len(svals) - 1, int(len(svals) * 0.95))
        p95 = svals[p95_idx]
        parallel_rows.append({
            "parallel": pr,
            "count": len(vals),
            "avg_price": round(sum(vals) / len(vals), 2),
            "median_price": round(med, 2) if med is not None else None,
            "max_price": round(p95, 2),
            "low_confidence": len(vals) < 3,
        })
    parallel_rows.sort(key=lambda r: -r["count"])
    parallel_rows = parallel_rows[:20]

    # Top drivers by volume + median total for context.
    drv_q = db.query(
        SoldCard.driver_name, SoldCard.sale_price, SoldCard.shipping_cost
    ).filter(SoldCard.is_duplicate == False, SoldCard.driver_name.isnot(None))  # noqa: E712
    drv_bucket: dict[str, list[float]] = {}
    for dn, price, ship in drv_q.all():
        if price is None or price <= 0:
            continue
        drv_bucket.setdefault(dn, []).append(float(price) + float(ship or 0))
    driver_rows = []
    for dn, vals in drv_bucket.items():
        med = _median(vals)
        driver_rows.append({
            "driver": dn,
            "count": len(vals),
            "total_value": round(sum(vals), 2),
            "avg_price": round(sum(vals) / len(vals), 2),
            "median_price": round(med, 2) if med is not None else None,
            "low_confidence": len(vals) < 3,
        })
    driver_rows.sort(key=lambda r: -r["count"])
    driver_rows = driver_rows[:15]

    # Grade distribution
    grade_rows = db.query(
        func.coalesce(SoldCard.grade, "Raw").label("grade"),
        func.count(SoldCard.id).label("count"),
        func.avg(SoldCard.sale_price).label("avg_price"),
    ).filter(SoldCard.is_duplicate == False).group_by("grade").order_by(desc("count")).all()  # noqa: E712

    return {
        "total_count": total_count,
        "total_value": round(float(total_value), 2),
        "week_count": week_count,
        "by_parallel": parallel_rows,
        "top_drivers": driver_rows,
        "by_grade": [
            {"grade": r[0], "count": r[1],
             "avg_price": round(float(r[2] or 0), 2)}
            for r in grade_rows
        ],
    }


@router.get("/median")
def median_for(
    driver: str = Query(...),
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    days: int = 90,
    db: Session = Depends(get_db),
):
    """
    Median total_cost (sale_price + shipping) for a driver+parallel[+grade]
    slice over the last `days`. Used by AuctionCard tooltips and the Sales
    Database "Median for this parallel" column.

    `low_confidence: true` when n < 3.
    """
    from scraper import _FOREIGN_PRODUCTS
    cutoff = datetime.utcnow() - timedelta(days=days)
    q = db.query(SoldCard).filter(
        SoldCard.driver_name == driver,
        SoldCard.sale_date >= cutoff,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
        # Non-Chrome products have no business in a Chrome comp pool — a
        # $100k Eccellenza 1/1 was skewing per-driver medians here.
        *[~SoldCard.title.ilike(f"%{p}%") for p in _FOREIGN_PRODUCTS],
    )
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if grade:
        q = q.filter(SoldCard.grade == grade)
    else:
        q = q.filter(SoldCard.grade.is_(None))

    totals = [
        (s.sale_price or 0) + (s.shipping_cost or 0) for s in q.all()
    ]
    totals = [t for t in totals if t > 0]
    med = _median(totals)
    avg = (sum(totals) / len(totals)) if totals else None
    return {
        "driver": driver,
        "parallel": parallel,
        "grade": grade,
        "days": days,
        "n": len(totals),
        "median_total": round(med, 2) if med is not None else None,
        "avg_total": round(avg, 2) if avg is not None else None,
        "min_total": round(min(totals), 2) if totals else None,
        "max_total": round(max(totals), 2) if totals else None,
        "low_confidence": len(totals) < 3,
    }


@router.get("/rookie-premium")
def rookie_premium(days: int = 90, db: Session = Depends(get_db)):
    """
    Compare median sale price of 2025 rookies vs comparable non-rookies
    (same set, last `days` days). Reports premium as a % delta.
    """
    from lib.parallels import ROOKIES_2025
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.query(SoldCard).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
        SoldCard.driver_name.isnot(None),
    ).all()

    rookie_vals: list[float] = []
    rookie_counts: dict[str, int] = {}
    nonrookie_vals: list[float] = []
    for r in rows:
        total = float(r.sale_price or 0) + float(r.shipping_cost or 0)
        if total <= 0:
            continue
        if r.driver_name in ROOKIES_2025:
            rookie_vals.append(total)
            rookie_counts[r.driver_name] = rookie_counts.get(r.driver_name, 0) + 1
        else:
            nonrookie_vals.append(total)

    rookie_median = _median(rookie_vals)
    non_median = _median(nonrookie_vals)
    premium_pct = None
    if rookie_median and non_median and non_median > 0:
        premium_pct = round((rookie_median - non_median) / non_median * 100, 1)

    return {
        "days": days,
        "rookies": sorted(list(ROOKIES_2025)),
        "rookie_sample_count": len(rookie_vals),
        "nonrookie_sample_count": len(nonrookie_vals),
        "rookie_median_total": round(rookie_median, 2) if rookie_median else None,
        "nonrookie_median_total": round(non_median, 2) if non_median else None,
        "premium_pct": premium_pct,
        "rookie_counts_by_driver": rookie_counts,
        "low_confidence": len(rookie_vals) < 5 or len(nonrookie_vals) < 5,
    }


@router.get("/momentum")
def driver_momentum(
    driver: Optional[str] = None,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """
    Price trend: median last-7d vs prior-14d.
    Returns per-driver rows (or a single row if driver= given).
    """
    if response is not None:
        # 7-day window aggregates — 5min fresh / 30min stale is plenty.
        response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=1800"
    now = datetime.utcnow()
    recent_cut = now - timedelta(days=7)
    prior_cut = now - timedelta(days=21)

    q = db.query(SoldCard).filter(
        SoldCard.sale_date >= prior_cut,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
        SoldCard.driver_name.isnot(None),
    )
    if driver:
        q = q.filter(SoldCard.driver_name == driver)
    rows = q.all()

    buckets: dict[str, dict] = {}
    for r in rows:
        total = float(r.sale_price or 0) + float(r.shipping_cost or 0)
        if total <= 0:
            continue
        d = r.driver_name
        b = buckets.setdefault(d, {"recent": [], "prior": []})
        if r.sale_date >= recent_cut:
            b["recent"].append(total)
        else:
            b["prior"].append(total)

    out = []
    for d, b in buckets.items():
        r_med = _median(b["recent"])
        p_med = _median(b["prior"])
        delta_pct = None
        if r_med and p_med and p_med > 0:
            delta_pct = round((r_med - p_med) / p_med * 100, 1)
        out.append({
            "driver": d,
            "recent_n": len(b["recent"]),
            "prior_n": len(b["prior"]),
            "recent_median": round(r_med, 2) if r_med else None,
            "prior_median": round(p_med, 2) if p_med else None,
            "delta_pct": delta_pct,
            "low_confidence": len(b["recent"]) < 2 or len(b["prior"]) < 2,
        })
    out.sort(key=lambda x: (x["delta_pct"] or 0), reverse=True)
    if driver:
        match = next((r for r in out if r["driver"] == driver), None)
        return {"driver": driver, "momentum": match}
    return {"total_drivers": len(out), "rows": out}


@router.get("/export.csv")
def export_csv(
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    is_auction: Optional[bool] = None,
    include_duplicates: bool = False,
    limit: int = 10000,
    db: Session = Depends(get_db),
):
    """Export sold-card rows as CSV.

    `limit` controls the max number of rows returned. Default is 10000;
    values above the hard cap of 50000 are clamped down. This protects
    the public endpoint from unbounded scans that would balloon memory
    and response time on large date ranges.
    """
    # Clamp limit to [1, 50000] — public endpoint, can't trust the caller.
    if limit is None or limit < 1:
        limit = 10000
    if limit > 50000:
        limit = 50000

    q = db.query(SoldCard)
    q = _apply_filters(q, driver, parallel, grade, min_price, max_price,
                       date_from, date_to, is_auction, include_duplicates)
    sales = q.order_by(desc(SoldCard.sale_date)).limit(limit).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "sale_date", "driver", "parallel", "grade", "condition",
        "sale_price", "shipping_cost", "total_cost", "is_auction", "title",
        "ebay_item_id", "ebay_url", "image_url",
    ])
    for s in sales:
        writer.writerow([
            s.sale_date.isoformat() if s.sale_date else "",
            s.driver_name or "",
            s.parallel or "",
            s.grade or "",
            s.condition or "",
            f"{s.sale_price:.2f}" if s.sale_price else "",
            f"{s.shipping_cost:.2f}" if s.shipping_cost else "",
            f"{_total_cost(s):.2f}",
            "auction" if s.is_auction else "bin",
            s.title or "",
            s.ebay_item_id or "",
            s.ebay_url or "",
            s.image_url or "",
        ])

    filename = f"chrome_crest_sales_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/heatmap")
def sales_heatmap(
    days: int = 30,
    top_drivers: int = 15,
    top_parallels: int = 8,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """
    Driver x Parallel 30-day sale count grid for the Dashboard heatmap.
    """
    if response is not None:
        # 30-day rolling aggregate — 10min fresh / 1hr stale fits.
        response.headers["Cache-Control"] = "public, s-maxage=600, stale-while-revalidate=3600"
    cutoff = datetime.utcnow() - timedelta(days=days)
    base = db.query(SoldCard).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.driver_name.isnot(None),
        SoldCard.parallel.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    )

    driver_rows = db.query(
        SoldCard.driver_name,
        func.count(SoldCard.id).label("cnt"),
    ).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.driver_name.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.driver_name)\
     .order_by(desc("cnt")).limit(top_drivers).all()
    drivers = [r[0] for r in driver_rows]

    parallel_rows = db.query(
        SoldCard.parallel,
        func.count(SoldCard.id).label("cnt"),
    ).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.parallel.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.parallel)\
     .order_by(desc("cnt")).limit(top_parallels).all()
    parallels = [r[0] for r in parallel_rows]

    if not drivers or not parallels:
        return {"drivers": drivers, "parallels": parallels, "cells": [], "days": days}

    cell_rows = db.query(
        SoldCard.driver_name,
        SoldCard.parallel,
        func.count(SoldCard.id).label("cnt"),
        func.avg(SoldCard.sale_price).label("avg_price"),
    ).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.driver_name.in_(drivers),
        SoldCard.parallel.in_(parallels),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.driver_name, SoldCard.parallel).all()

    cells = [
        {
            "driver": r[0],
            "parallel": r[1],
            "count": int(r[2] or 0),
            "avg_price": round(float(r[3] or 0), 2),
        }
        for r in cell_rows
    ]

    return {
        "drivers": drivers,
        "parallels": parallels,
        "cells": cells,
        "days": days,
    }


@router.get("/volatility-heatmap")
def sales_volatility_heatmap(
    days: int = 60,
    top_drivers: int = 15,
    top_parallels: int = 8,
    min_count: int = 4,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """
    Driver x Parallel volatility + momentum grid. For each cell with enough sales
    we return:
      count, median, volatility_pct (stddev/mean as %), momentum_pct (recent half
      median vs prior half median, %), and a simple signal: BUY, HOLD, AVOID.
    Timing tip: AVOID when volatility is huge and momentum negative — wait for
    the market to settle; BUY when volatility is low and momentum is positive.
    """
    if response is not None:
        # 60-day rolling — 10min fresh / 1h stale.
        response.headers["Cache-Control"] = "public, s-maxage=600, stale-while-revalidate=3600"
    cutoff = datetime.utcnow() - timedelta(days=days)
    midpoint = datetime.utcnow() - timedelta(days=days // 2)

    driver_rows = db.query(
        SoldCard.driver_name, func.count(SoldCard.id).label("cnt"),
    ).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.driver_name.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.driver_name)\
     .order_by(desc("cnt")).limit(top_drivers).all()
    drivers = [r[0] for r in driver_rows]

    parallel_rows = db.query(
        SoldCard.parallel, func.count(SoldCard.id).label("cnt"),
    ).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.parallel.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.parallel)\
     .order_by(desc("cnt")).limit(top_parallels).all()
    parallels = [r[0] for r in parallel_rows]

    if not drivers or not parallels:
        return {"drivers": drivers, "parallels": parallels, "cells": [], "days": days}

    raw = db.query(
        SoldCard.driver_name, SoldCard.parallel, SoldCard.sale_price, SoldCard.sale_date,
    ).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.driver_name.in_(drivers),
        SoldCard.parallel.in_(parallels),
        SoldCard.is_duplicate == False,  # noqa: E712
        SoldCard.sale_price.isnot(None),
    ).all()

    # Group sales per cell
    buckets: dict = {}
    for r in raw:
        key = (r.driver_name, r.parallel)
        buckets.setdefault(key, []).append((r.sale_date, float(r.sale_price)))

    def _median(vals):
        if not vals:
            return 0.0
        s = sorted(vals)
        n = len(s)
        return (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2)

    def _stddev(vals, mean):
        if len(vals) < 2:
            return 0.0
        return (sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)) ** 0.5

    cells = []
    for (driver, parallel), rows in buckets.items():
        if len(rows) < min_count:
            continue
        prices = [p for _, p in rows]
        mean = sum(prices) / len(prices)
        med = _median(prices)
        sd = _stddev(prices, mean)
        vol_pct = round((sd / mean) * 100, 1) if mean > 0 else 0.0

        recent = [p for d, p in rows if d >= midpoint]
        prior = [p for d, p in rows if d < midpoint]
        momentum_pct = 0.0
        if recent and prior:
            rm, pm = _median(recent), _median(prior)
            if pm > 0:
                momentum_pct = round(((rm - pm) / pm) * 100, 1)

        # Signal: low vol + positive momentum = BUY; high vol + negative momentum = AVOID
        if vol_pct < 35 and momentum_pct > 3:
            signal = "BUY"
        elif vol_pct > 70 or momentum_pct < -10:
            signal = "AVOID"
        else:
            signal = "HOLD"

        cells.append({
            "driver": driver,
            "parallel": parallel,
            "count": len(rows),
            "median": round(med, 2),
            "volatility_pct": vol_pct,
            "momentum_pct": momentum_pct,
            "signal": signal,
        })

    return {
        "drivers": drivers,
        "parallels": parallels,
        "cells": cells,
        "days": days,
        "min_count": min_count,
    }


@router.post("/backfill-from-price-history")
def backfill_from_price_history(db: Session = Depends(get_db)):
    """
    One-time bootstrap: promote existing price_history rows into the new
    SoldCard table so users see real data immediately.
    """
    from database import PriceHistory, Card
    from sqlalchemy import and_

    rows = db.query(PriceHistory, Card).join(
        Card, PriceHistory.card_id == Card.id
    ).filter(
        PriceHistory.ebay_item_id.isnot(None),
    ).all()

    existing_ids = {r[0] for r in db.query(SoldCard.ebay_item_id).all()}

    added = 0
    skipped_base = 0
    skipped_dupe = 0
    for ph, card in rows:
        if not ph.ebay_item_id:
            continue
        if ph.ebay_item_id in existing_ids:
            skipped_dupe += 1
            continue
        parallel = card.parallel or ""
        if parallel.lower().strip() == "base":
            skipped_base += 1
            continue

        cond = (ph.condition or "")
        grade = None
        upper = cond.upper()
        if upper.startswith(("PSA", "BGS", "SGC", "CGC")):
            grade = cond

        ebay_url = f"https://www.ebay.com/itm/{ph.ebay_item_id.split('|')[1] if '|' in ph.ebay_item_id else ph.ebay_item_id}"

        db.add(SoldCard(
            ebay_item_id=ph.ebay_item_id,
            title=f"2025 Topps Chrome F1 {card.driver_name} {parallel}".strip(),
            driver_name=card.driver_name,
            parallel=parallel,
            grade=grade,
            condition=ph.condition,
            sale_price=ph.price,
            sale_date=ph.sale_date or datetime.utcnow(),
            image_url=card.ebay_image_url or card.image_url,
            ebay_url=ebay_url,
            shipping_cost=None,
            is_auction=False,
            series=getattr(card, "series", "F1") or "F1",
            scraped_at=datetime.utcnow(),
        ))
        existing_ids.add(ph.ebay_item_id)
        added += 1

    if added:
        db.commit()
    return {
        "added": added,
        "skipped_base": skipped_base,
        "skipped_dupe": skipped_dupe,
        "total_processed": len(rows),
    }


@router.get("/market-makers/{driver_name}")
def market_makers(
    driver_name: str,
    min_price: float = 200,
    days: int = 90,
    limit: int = 10,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """Return the recent $200+ sold cards for a driver — the 'market makers'
    that shape what their cards are really worth. Sorted by sale_date desc.
    """
    if response is not None:
        # 5min fresh / 30min stale — sale data only updates on cron.
        response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=1800"

    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(SoldCard)
        .filter(
            SoldCard.driver_name.ilike(driver_name),
            SoldCard.sale_price >= min_price,
            SoldCard.sale_date >= cutoff,
            SoldCard.is_duplicate == False,  # noqa: E712
        )
        .order_by(SoldCard.sale_date.desc())
        .limit(limit)
        .all()
    )

    # Aggregate stats for the header strip
    total_count = (
        db.query(func.count(SoldCard.id))
        .filter(
            SoldCard.driver_name.ilike(driver_name),
            SoldCard.sale_price >= min_price,
            SoldCard.sale_date >= cutoff,
            SoldCard.is_duplicate == False,  # noqa: E712
        )
        .scalar() or 0
    )
    max_sale = (
        db.query(func.max(SoldCard.sale_price))
        .filter(
            SoldCard.driver_name.ilike(driver_name),
            SoldCard.sale_price >= min_price,
            SoldCard.sale_date >= cutoff,
            SoldCard.is_duplicate == False,  # noqa: E712
        )
        .scalar() or 0
    )

    return {
        "driver": driver_name,
        "min_price": min_price,
        "days": days,
        "stats": {
            "count": total_count,
            "peak_price": float(max_sale),
        },
        "sales": [
            {
                "id": r.id,
                "title": r.title or "",
                "parallel": r.parallel,
                "grade": r.grade,
                "sale_price": float(r.sale_price or 0),
                "shipping_cost": float(r.shipping_cost or 0) if r.shipping_cost else 0,
                "sale_date": r.sale_date.isoformat() if r.sale_date else None,
                "image_url": r.image_url,
                "ebay_listing_id": r.ebay_item_id,
            }
            for r in rows
        ],
    }


@router.get("/driver-index/{driver_name}")
def driver_index(
    driver_name: str,
    days: int = 180,
    top_n: int = 10,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """Compute an equal-weighted price index for a driver's top-N most-valuable
    parallel/grade combos over the last N days. Returns a daily series
    starting at index 100. Like S&P 500 tracking N constituents.
    """
    from collections import defaultdict

    if response is not None:
        # Heavy aggregation, but data only updates on cron — cache hard.
        response.headers["Cache-Control"] = "public, s-maxage=900, stale-while-revalidate=3600"

    cutoff = datetime.utcnow() - timedelta(days=days)

    # 1. Find this driver's top-N parallel/grade combos by lifetime median
    #    sale price. Need at least 3 sales to qualify (avoid one-off outliers).
    combos = (
        db.query(
            SoldCard.parallel,
            SoldCard.grade,
            func.count(SoldCard.id).label("cnt"),
            func.avg(SoldCard.sale_price).label("avg_price"),
        )
        .filter(
            SoldCard.driver_name.ilike(driver_name),
            SoldCard.parallel.isnot(None),
            SoldCard.is_duplicate == False,  # noqa: E712
            SoldCard.sale_price > 0,
        )
        .group_by(SoldCard.parallel, SoldCard.grade)
        .having(func.count(SoldCard.id) >= 3)
        .order_by(func.avg(SoldCard.sale_price).desc())
        .limit(top_n)
        .all()
    )
    if not combos:
        return {"driver": driver_name, "constituents": [], "series": []}

    constituents = [
        {
            "parallel": c.parallel,
            "grade": c.grade,
            "lifetime_avg": round(float(c.avg_price), 2),
            "n_sales": int(c.cnt),
        }
        for c in combos
    ]

    # 2. Pull all sales for these combos in the chart window.
    sales_q = (
        db.query(SoldCard.parallel, SoldCard.grade, SoldCard.sale_date, SoldCard.sale_price)
        .filter(
            SoldCard.driver_name.ilike(driver_name),
            SoldCard.sale_date >= cutoff,
            SoldCard.is_duplicate == False,  # noqa: E712
            SoldCard.sale_price > 0,
        )
    )

    # Filter to only our top-N combos
    target = {(c.parallel, c.grade) for c in combos}
    rows = [r for r in sales_q.all() if (r.parallel, r.grade) in target]

    if not rows:
        return {"driver": driver_name, "constituents": constituents, "series": []}

    # 3. Group sales by combo + day, compute daily avg per combo
    by_combo_day = defaultdict(lambda: defaultdict(list))
    for r in rows:
        day = r.sale_date.date()
        by_combo_day[(r.parallel, r.grade)][day].append(float(r.sale_price))

    # 4. Build daily series for each combo with forward-fill (last known
    #    price if no sale that day). Start price = first sale within window.
    today = datetime.utcnow().date()
    start = (datetime.utcnow() - timedelta(days=days)).date()

    combo_series = {}
    for combo in target:
        days_data = by_combo_day.get(combo, {})
        if not days_data:
            continue
        sorted_days = sorted(days_data.keys())
        first_day = sorted_days[0]
        first_price = sum(days_data[first_day]) / len(days_data[first_day])
        last_price = first_price
        per_day = {}
        d = start
        while d <= today:
            if d in days_data:
                last_price = sum(days_data[d]) / len(days_data[d])
            per_day[d] = last_price / first_price * 100  # normalized to 100
            d = d + timedelta(days=1)
        combo_series[combo] = per_day

    # 5. Equal-weight average across combos for each day
    if not combo_series:
        return {"driver": driver_name, "constituents": constituents, "series": []}

    series = []
    d = start
    while d <= today:
        vals = [s.get(d) for s in combo_series.values() if s.get(d) is not None]
        if vals:
            series.append({
                "date": d.isoformat(),
                "value": round(sum(vals) / len(vals), 2),
            })
        d = d + timedelta(days=1)

    return {
        "driver": driver_name,
        "days": days,
        "top_n": top_n,
        "constituents": constituents,
        "series": series,
    }
