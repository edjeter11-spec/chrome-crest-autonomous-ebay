from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Portfolio, Card
from datetime import datetime
from models import PortfolioCreate

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def item_to_dict(p: Portfolio) -> dict:
    return {
        "id": p.id,
        "card_id": p.card_id,
        "purchase_price": p.purchase_price,
        "purchase_date": p.purchase_date.isoformat() if p.purchase_date else None,
        "current_value": p.current_value,
        "quantity": p.quantity,
        "notes": p.notes,
        "card": {
            "driver_name": p.card.driver_name,
            "parallel": p.card.parallel,
            "grade": p.card.grade,
            "team": p.card.team,
            "team_color": p.card.team_color,
        } if p.card else None,
    }


@router.get("")
def list_portfolio(db: Session = Depends(get_db)):
    items = db.query(Portfolio).all()
    return {"items": [item_to_dict(i) for i in items]}


@router.post("")
def add_to_portfolio(data: PortfolioCreate, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == data.card_id).first()
    if not card:
        raise HTTPException(404, "Card not found")
    item = Portfolio(
        card_id=data.card_id,
        purchase_price=data.purchase_price,
        purchase_date=datetime.utcnow(),
        current_value=card.base_value,
        quantity=data.quantity,
        notes=data.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item_to_dict(item)


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
    return item_to_dict(item)


@router.delete("/{item_id}")
def remove_from_portfolio(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Portfolio).filter(Portfolio.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
