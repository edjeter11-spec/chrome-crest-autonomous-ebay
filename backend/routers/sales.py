"""
Sales Database — queries against the SoldCard table.
"""
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from typing import Optional
import csv
import io

from database import get_db, SoldCard

router = APIRouter(prefix="/api/sales", tags=["sales"])


def _sold_to_dict(s: SoldCard) -> dict:
    return {
        "id": s.id,
        "ebay_item_id": s.ebay_item_id,
        "title": s.title,
        "driver_name": s.driver_name,
        "parallel": s.parallel,
        "grade": s.grade,
        "condition": s.condition,
        "sale_price": s.sale_price,
        "sale_date": s.sale_date.isoformat() if s.sale_date else None,
        "image_url": s.image_url,
        "ebay_url": s.ebay_url,
        "shipping_cost": s.shipping_cost,
        "is_auction": bool(s.is_auction),
        "series": s.series or "F1",
        "scraped_at": s.scraped_at.isoformat() if s.scraped_at else None,
    }


def _apply_filters(q, driver, parallel, grade, min_price, max_price,
                   date_from, date_to, is_auction):
    if driver:
        q = q.filter(SoldCard.driver_name.ilike(f"%{driver}%"))
    if parallel:
        # Allow comma-separated multi-select
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
    return q


@router.get("")
def list_sales(
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    is_auction: Optional[bool] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(SoldCard)
    q = _apply_filters(q, driver, parallel, grade, min_price, max_price,
                       date_from, date_to, is_auction)
    total = q.count()
    sales = q.order_by(desc(SoldCard.sale_date)).offset(offset).limit(limit).all()
    return {"total": total, "sales": [_sold_to_dict(s) for s in sales]}


@router.get("/stats")
def sales_stats(
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(SoldCard)
    q = _apply_filters(q, driver, parallel, grade, None, None,
                       date_from, date_to, None)

    total_count = q.count()
    total_value = db.query(func.coalesce(func.sum(SoldCard.sale_price), 0)).scalar() or 0

    # This-week count (last 7 days)
    cutoff = datetime.utcnow() - timedelta(days=7)
    week_count = db.query(func.count(SoldCard.id)).filter(
        SoldCard.sale_date >= cutoff
    ).scalar() or 0

    # Avg price per parallel
    parallel_rows = db.query(
        SoldCard.parallel,
        func.count(SoldCard.id).label("count"),
        func.avg(SoldCard.sale_price).label("avg_price"),
        func.max(SoldCard.sale_price).label("max_price"),
    ).group_by(SoldCard.parallel).order_by(desc("count")).limit(20).all()

    # Top drivers by volume
    driver_rows = db.query(
        SoldCard.driver_name,
        func.count(SoldCard.id).label("count"),
        func.sum(SoldCard.sale_price).label("total_value"),
    ).filter(SoldCard.driver_name.isnot(None))\
     .group_by(SoldCard.driver_name)\
     .order_by(desc("count")).limit(15).all()

    # Grade distribution
    grade_rows = db.query(
        func.coalesce(SoldCard.grade, "Raw").label("grade"),
        func.count(SoldCard.id).label("count"),
        func.avg(SoldCard.sale_price).label("avg_price"),
    ).group_by("grade").order_by(desc("count")).all()

    return {
        "total_count": total_count,
        "total_value": round(float(total_value), 2),
        "week_count": week_count,
        "by_parallel": [
            {"parallel": r[0], "count": r[1],
             "avg_price": round(float(r[2] or 0), 2),
             "max_price": round(float(r[3] or 0), 2)}
            for r in parallel_rows
        ],
        "top_drivers": [
            {"driver": r[0], "count": r[1],
             "total_value": round(float(r[2] or 0), 2)}
            for r in driver_rows
        ],
        "by_grade": [
            {"grade": r[0], "count": r[1],
             "avg_price": round(float(r[2] or 0), 2)}
            for r in grade_rows
        ],
    }


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
    db: Session = Depends(get_db),
):
    q = db.query(SoldCard)
    q = _apply_filters(q, driver, parallel, grade, min_price, max_price,
                       date_from, date_to, is_auction)
    sales = q.order_by(desc(SoldCard.sale_date)).limit(50000).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "sale_date", "driver", "parallel", "grade", "condition",
        "sale_price", "shipping_cost", "is_auction", "title",
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


@router.post("/backfill-from-price-history")
def backfill_from_price_history(db: Session = Depends(get_db)):
    """
    One-time bootstrap: promote existing price_history rows into the new
    SoldCard table so users see real data immediately. Only includes rows with
    an ebay_item_id (dedupeable) and a matched Card. Skips base-parallel rows
    and duplicates by ebay_item_id.
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

        # Grade detection from stored condition field
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
