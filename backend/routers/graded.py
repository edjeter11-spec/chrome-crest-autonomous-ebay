"""
Graded Tracker endpoints — surfaces real graded sales from multiple sources
(eBay, Goldin, PWCC, MySlabs) and computes an observed pop estimate.

PSA has not indexed the 2025 Topps Chrome F1 set yet + their Cloudflare
blocks scraping, so we pivot: aggregate actual graded sales we observe
across marketplaces and present those as the source of truth.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, case, or_
from typing import Optional
from datetime import datetime, timedelta
import re

from database import get_db, SoldCard, Auction

router = APIRouter(prefix="/api/graded", tags=["graded"])


GRADE_RE = re.compile(r"\b(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7|6)\b", re.I)


def _title_has_grade(title: str) -> bool:
    return bool(GRADE_RE.search(title or ""))


@router.get("/source-counts")
def source_counts(db: Session = Depends(get_db)):
    """Counts of graded sales per source — dynamic GROUP BY on sold_cards.source.
    Also returns active-listing counts for marketplaces that only have live inventory
    (MySlabs, HEROES, Fanatics Collect)."""
    rows = db.query(
        SoldCard.source,
        func.count(SoldCard.id).label("c"),
    ).filter(
        SoldCard.grade.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.source).all()

    # Seed the four legacy sources so the UI always shows them (as 0 if empty)
    out = {"eBay": 0, "Goldin": 0, "PWCC": 0, "MySlabs": 0}
    for r in rows:
        key = (r.source or "eBay")
        out[key] = out.get(key, 0) + int(r.c)

    # Active listings from the auctions table, grouped by seller
    active_rows = db.query(
        Auction.seller,
        func.count(Auction.id).label("c"),
    ).filter(Auction.status == "active").group_by(Auction.seller).all()
    active_by_seller = {(r.seller or "Unknown"): int(r.c) for r in active_rows}

    return {
        "sources": out,
        "myslabs_active_listings": active_by_seller.get("MySlabs", 0),
        "active_by_seller": active_by_seller,
    }


@router.get("/active-auctions")
def active_graded_auctions(
    limit: int = Query(5, le=50),
    db: Session = Depends(get_db),
):
    """Top ending-soonest graded active auctions."""
    now = datetime.utcnow()
    q = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time > now,
    ).order_by(Auction.end_time.asc()).limit(500).all()

    graded = []
    for a in q:
        if _title_has_grade(a.title or ""):
            graded.append({
                "id": a.id,
                "title": a.title,
                "current_price": a.current_price,
                "end_time": a.end_time.isoformat() if a.end_time else None,
                "ebay_url": a.ebay_url,
                "image_url": a.image_url,
                "seller": a.seller,
            })
        if len(graded) >= limit:
            break
    return {"auctions": graded, "total": len(graded)}


@router.get("/sales")
def graded_sales_feed(
    limit: int = Query(50, le=200),
    offset: int = 0,
    driver: Optional[str] = None,
    grade: Optional[str] = None,
    parallel: Optional[str] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Paginated graded-sale feed across all sources."""
    q = db.query(SoldCard).filter(SoldCard.grade.isnot(None), SoldCard.is_duplicate == False)  # noqa: E712
    if driver:
        q = q.filter(SoldCard.driver_name.ilike(f"%{driver}%"))
    if grade:
        q = q.filter(SoldCard.grade == grade)
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if source:
        q = q.filter(SoldCard.source == source)
    total = q.count()
    rows = q.order_by(desc(SoldCard.sale_date)).offset(offset).limit(limit).all()
    sales = [{
        "id": r.id,
        "title": r.title,
        "driver_name": r.driver_name,
        "parallel": r.parallel,
        "grade": r.grade,
        "sale_price": r.sale_price,
        "sale_date": r.sale_date.isoformat() if r.sale_date else None,
        "image_url": r.image_url,
        "ebay_url": r.ebay_url,
        "source": r.source or "eBay",
    } for r in rows]
    return {"total": total, "offset": offset, "limit": limit, "sales": sales}


@router.get("/leaderboard")
def graded_leaderboard(
    sort: str = Query("total_graded", regex="^(total_graded|psa_10|avg_psa_10|max_price|gem_rate|total_value)$"),
    order: str = Query("desc", regex="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    """Per-driver aggregates for the leaderboard table."""
    drv_rows = db.query(
        SoldCard.driver_name,
        func.count(SoldCard.id).label("total_graded"),
        func.sum(SoldCard.sale_price).label("total_value"),
        func.sum(case((SoldCard.grade == "PSA 10", 1), else_=0)).label("psa_10"),
        func.sum(case((SoldCard.grade == "PSA 10", SoldCard.sale_price), else_=0)).label("psa_10_sum"),
        func.max(SoldCard.sale_price).label("max_price"),
    ).filter(
        SoldCard.grade.isnot(None),
        SoldCard.driver_name.isnot(None),
        SoldCard.is_duplicate == False,  # noqa: E712
    ).group_by(SoldCard.driver_name).all()

    out = []
    for r in drv_rows:
        tg = int(r.total_graded or 0)
        p10 = int(r.psa_10 or 0)
        avg_psa_10 = round(float(r.psa_10_sum or 0) / p10, 2) if p10 else 0.0
        gem_rate = round((p10 / tg * 100.0), 2) if tg else 0.0
        out.append({
            "driver": r.driver_name,
            "total_graded": tg,
            "total_value": round(float(r.total_value or 0), 2),
            "psa_10": p10,
            "avg_psa_10": avg_psa_10,
            "max_price": round(float(r.max_price or 0), 2),
            "gem_rate_pct": gem_rate,
        })

    key_map = {
        "total_graded": lambda x: x["total_graded"],
        "total_value": lambda x: x["total_value"],
        "psa_10": lambda x: x["psa_10"],
        "avg_psa_10": lambda x: x["avg_psa_10"],
        "max_price": lambda x: x["max_price"],
        "gem_rate": lambda x: x["gem_rate_pct"],
    }
    out.sort(key=key_map[sort], reverse=(order == "desc"))

    # KPIs + misc
    total_graded_sales = db.query(func.count(SoldCard.id)).filter(
        SoldCard.grade.isnot(None), SoldCard.is_duplicate == False  # noqa: E712
    ).scalar() or 0
    total_graded_value = db.query(func.sum(SoldCard.sale_price)).filter(
        SoldCard.grade.isnot(None), SoldCard.is_duplicate == False  # noqa: E712
    ).scalar() or 0
    drivers_with_psa10 = db.query(func.count(func.distinct(SoldCard.driver_name))).filter(
        SoldCard.grade == "PSA 10", SoldCard.is_duplicate == False  # noqa: E712
    ).scalar() or 0
    highest_row = db.query(SoldCard).filter(
        SoldCard.grade.isnot(None), SoldCard.is_duplicate == False  # noqa: E712
    ).order_by(desc(SoldCard.sale_price)).first()
    most_graded_driver = out[0]["driver"] if out else None

    # Count active graded auctions (title-regex match in Python layer — fast enough on <5k rows)
    now = datetime.utcnow()
    active_auctions = db.query(Auction).filter(
        Auction.status == "active", Auction.end_time > now,
    ).limit(2000).all()
    active_graded_count = sum(1 for a in active_auctions if _title_has_grade(a.title or ""))

    return {
        "rows": out,
        "kpis": {
            "total_graded_sales": int(total_graded_sales),
            "total_graded_value": round(float(total_graded_value), 2),
            "drivers_with_psa10": int(drivers_with_psa10),
            "most_graded_driver": most_graded_driver,
            "highest_sale": {
                "price": round(float(highest_row.sale_price), 2) if highest_row else 0,
                "driver": highest_row.driver_name if highest_row else None,
                "title": highest_row.title if highest_row else None,
                "url": highest_row.ebay_url if highest_row else None,
            },
            "active_graded_auctions": active_graded_count,
        },
    }


@router.get("/driver-detail")
def graded_driver_detail(
    driver: str = Query(...),
    db: Session = Depends(get_db),
):
    """Per-driver: parallel × grade breakdown + top 10 sales + 90d trend."""
    sold = db.query(SoldCard).filter(
        SoldCard.grade.isnot(None),
        SoldCard.driver_name == driver,
        SoldCard.is_duplicate == False,  # noqa: E712
    ).all()

    # Per-parallel × grade — median + min + max + count (not just avg)
    def _median_local(vs: list[float]):
        if not vs: return None
        vs = sorted(vs); n = len(vs)
        return vs[n // 2] if n % 2 else (vs[n // 2 - 1] + vs[n // 2]) / 2

    breakdown: dict = {}
    for s in sold:
        par = s.parallel or "Unknown"
        g = s.grade or "Unknown"
        key = (par, g)
        total = float(s.sale_price or 0) + float(s.shipping_cost or 0)
        d = breakdown.setdefault(key, {"parallel": par, "grade": g, "vals": []})
        d["vals"].append(total)
    bk = []
    for k, d in breakdown.items():
        vals = d["vals"]
        cnt = len(vals)
        avg = sum(vals) / cnt if cnt else 0
        med = _median_local(vals)
        bk.append({
            "parallel": k[0], "grade": k[1], "count": cnt,
            "avg_price": round(avg, 2),
            "median_price": round(med, 2) if med is not None else None,
            "min_price": round(min(vals), 2) if vals else None,
            "max_price": round(max(vals), 2) if vals else None,
            "low_confidence": cnt < 3,
        })
    bk.sort(key=lambda x: (-x["count"], x["parallel"]))

    # Top 10 sales
    top = sorted(sold, key=lambda s: -(s.sale_price or 0))[:10]
    top_sales = [{
        "title": s.title,
        "parallel": s.parallel,
        "grade": s.grade,
        "sale_price": s.sale_price,
        "sale_date": s.sale_date.isoformat() if s.sale_date else None,
        "source": s.source or "eBay",
        "ebay_url": s.ebay_url,
        "image_url": s.image_url,
    } for s in top]

    # 90d weekly trend by grade
    since = datetime.utcnow() - timedelta(days=90)
    buckets: dict = {}
    for s in sold:
        if not s.sale_date or s.sale_date < since:
            continue
        g = (s.grade or "").strip().upper()
        if g.startswith("PSA 10"): grade = "PSA 10"
        elif g.startswith("PSA 9"): grade = "PSA 9"
        elif g.startswith("PSA 8"): grade = "PSA 8"
        elif g.startswith("BGS"): grade = "BGS"
        else: grade = "Other"
        week_start = (s.sale_date - timedelta(days=s.sale_date.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        key = (week_start.isoformat()[:10], grade)
        b = buckets.setdefault(key, {"sum": 0.0, "count": 0})
        b["sum"] += float(s.sale_price or 0)
        b["count"] += 1
    trend = [
        {"week": k[0], "grade": k[1], "count": b["count"],
         "avg_price": round(b["sum"] / b["count"], 2) if b["count"] else 0}
        for k, b in buckets.items()
    ]
    trend.sort(key=lambda x: (x["week"], x["grade"]))

    return {
        "driver": driver,
        "total_sales": len(sold),
        "breakdown": bk,
        "top_sales": top_sales,
        "trend_90d": trend,
    }
