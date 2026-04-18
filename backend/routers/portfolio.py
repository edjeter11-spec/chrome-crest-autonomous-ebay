from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db, Portfolio, Card, SoldCard
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _latest_avg_value(db: Session, driver: str | None, parallel: str | None, grade: str | None) -> float | None:
    """Latest avg sold price for the given driver+parallel+grade combo (90-day window)."""
    if not driver:
        return None
    since = datetime.utcnow() - timedelta(days=90)
    q = db.query(func.avg(SoldCard.sale_price)).filter(
        SoldCard.driver_name == driver,
        SoldCard.sale_price > 0,
        SoldCard.sale_date >= since,
    )
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if grade and grade != "Raw":
        q = q.filter(SoldCard.grade.ilike(f"{grade}%"))
    val = q.scalar()
    if val is None and parallel:
        # Loosen: drop parallel filter
        q2 = db.query(func.avg(SoldCard.sale_price)).filter(
            SoldCard.driver_name == driver,
            SoldCard.sale_price > 0,
            SoldCard.sale_date >= since,
        )
        val = q2.scalar()
    return float(val) if val is not None else None


def item_to_dict(p: Portfolio, db: Session) -> dict:
    card = p.card
    live_val = None
    if card:
        live_val = _latest_avg_value(db, card.driver_name, card.parallel, card.grade)
    if live_val is None:
        live_val = p.current_value or (card.base_value if card else 0) or 0
    qty = p.quantity or 1
    cost = (p.purchase_price or 0) * qty
    value = (live_val or 0) * qty
    pnl = value - cost
    pnl_pct = (pnl / cost * 100) if cost > 0 else 0
    return {
        "id": p.id,
        "card_id": p.card_id,
        "purchase_price": p.purchase_price,
        "purchase_date": p.purchase_date.isoformat() if p.purchase_date else None,
        "current_value": round(live_val or 0, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
        "has_valuation": live_val is not None and live_val > 0,
        "quantity": qty,
        "notes": p.notes,
        "ebay_listing_id": p.ebay_listing_id,
        "card": {
            "id": card.id,
            "driver_name": card.driver_name,
            "parallel": card.parallel,
            "grade": card.grade,
            "team": card.team,
            "team_color": card.team_color,
            "image_url": card.image_url,
        } if card else None,
    }


@router.get("")
def list_portfolio(db: Session = Depends(get_db)):
    items = db.query(Portfolio).all()
    rows = [item_to_dict(i, db) for i in items]
    rows.sort(key=lambda r: r["pnl_pct"], reverse=True)
    return {"items": rows}


@router.post("")
async def add_to_portfolio(body: dict, db: Session = Depends(get_db)):
    """
    Accepts either:
      - {card_id, purchase_price, quantity, notes}
      - {title, driver, parallel, grade, purchase_price, purchase_date, quantity, notes, ebay_item_id?}
    If card_id not provided, matches an existing Card by driver+parallel+grade — else creates one.
    """
    card_id = body.get("card_id")
    if not card_id:
        driver = (body.get("driver") or "").strip()
        parallel = (body.get("parallel") or "").strip() or None
        grade = (body.get("grade") or "Raw").strip()
        if not driver:
            raise HTTPException(400, "driver or card_id required")
        card = db.query(Card).filter(
            Card.driver_name == driver,
            Card.parallel == parallel,
            Card.grade == grade,
        ).first()
        if not card:
            card = Card(
                driver_name=driver,
                parallel=parallel,
                grade=grade,
                year=2025,
                set_name="Topps Chrome F1",
                base_value=float(body.get("purchase_price") or 0),
            )
            db.add(card)
            db.commit()
            db.refresh(card)
        card_id = card.id
    else:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            raise HTTPException(404, "Card not found")

    purchase_date = body.get("purchase_date")
    try:
        pdate = datetime.fromisoformat(purchase_date) if purchase_date else datetime.utcnow()
    except Exception:
        pdate = datetime.utcnow()

    item = Portfolio(
        card_id=card_id,
        purchase_price=float(body.get("purchase_price") or 0),
        purchase_date=pdate,
        current_value=_latest_avg_value(db, card.driver_name, card.parallel, card.grade) or card.base_value or 0,
        quantity=int(body.get("quantity") or 1),
        notes=body.get("notes"),
        ebay_listing_id=body.get("ebay_item_id"),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item_to_dict(item, db)


@router.patch("/{item_id}")
def update_portfolio_item(item_id: int, body: dict, db: Session = Depends(get_db)):
    item = db.query(Portfolio).filter(Portfolio.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    allowed = {"quantity", "purchase_price", "notes", "current_value"}
    for k, v in body.items():
        if k in allowed:
            setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item_to_dict(item, db)


@router.delete("/{item_id}")
def remove_from_portfolio(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Portfolio).filter(Portfolio.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
