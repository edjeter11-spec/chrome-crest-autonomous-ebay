"""
Sold — lightweight feeds against the SoldCard table for marketing surfaces
like the dashboard "Just Sold" ticker. Kept separate from `sales.py` so the
main analytics router stays focused on filtering / stats / CSV export.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from database import get_db, SoldCard

router = APIRouter(prefix="/api/sold", tags=["sold"])


@router.get("/recent")
def recent_sold(
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Most recent non-base sold cards with a known driver. Powers the
    Dashboard "Just Sold" marquee ticker — light payload, no joins.
    """
    rows = (
        db.query(
            SoldCard.id,
            SoldCard.driver_name,
            SoldCard.parallel,
            SoldCard.sale_price,
            SoldCard.sale_date,
            SoldCard.ebay_url,
            SoldCard.image_url,
            SoldCard.grade,
        )
        .filter(
            SoldCard.driver_name.isnot(None),
            SoldCard.parallel != "Base",
            SoldCard.is_duplicate == False,  # noqa: E712
            SoldCard.sale_price.isnot(None),
            SoldCard.sale_price > 0,
        )
        .order_by(desc(SoldCard.sale_date))
        .limit(limit)
        .all()
    )

    return {
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "driver_name": r.driver_name,
                "parallel": r.parallel,
                "sale_price": float(r.sale_price) if r.sale_price is not None else None,
                "sale_date": r.sale_date.isoformat() if r.sale_date else None,
                "ebay_url": r.ebay_url,
                "image_url": r.image_url,
                "grade": r.grade,
            }
            for r in rows
        ],
    }
