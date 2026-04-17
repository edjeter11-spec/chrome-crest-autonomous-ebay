from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Wishlist, Card
from models import WishlistCreate

router = APIRouter(prefix="/api/wishlist", tags=["wishlist"])


def item_to_dict(w: Wishlist) -> dict:
    return {
        "id": w.id,
        "card_id": w.card_id,
        "max_price": w.max_price,
        "priority": w.priority,
        "notes": w.notes,
        "auto_snipe": w.auto_snipe,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "card": {
            "driver_name": w.card.driver_name,
            "parallel": w.card.parallel,
            "grade": w.card.grade,
            "team": w.card.team,
            "team_color": w.card.team_color,
            "base_value": w.card.base_value,
        } if w.card else None,
    }


@router.get("")
def list_wishlist(db: Session = Depends(get_db)):
    items = db.query(Wishlist).order_by(Wishlist.priority.desc()).all()
    return {"items": [item_to_dict(i) for i in items]}


@router.post("")
def add_to_wishlist(data: WishlistCreate, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == data.card_id).first()
    if not card:
        raise HTTPException(404, "Card not found")
    existing = db.query(Wishlist).filter(Wishlist.card_id == data.card_id).first()
    if existing:
        return item_to_dict(existing)
    item = Wishlist(
        card_id=data.card_id, max_price=data.max_price,
        priority=data.priority, notes=data.notes, auto_snipe=data.auto_snipe,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item_to_dict(item)


@router.patch("/{item_id}")
def update_wishlist_item(item_id: int, body: dict, db: Session = Depends(get_db)):
    item = db.query(Wishlist).filter(Wishlist.id == item_id).first()
    if not item:
        raise HTTPException(404, "Not found")
    for k, v in body.items():
        if hasattr(item, k):
            setattr(item, k, v)
    db.commit()
    return item_to_dict(item)


@router.delete("/{item_id}")
def delete_wishlist_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Wishlist).filter(Wishlist.id == item_id).first()
    if not item:
        raise HTTPException(404, "Not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
