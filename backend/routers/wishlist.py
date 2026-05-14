from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Wishlist, Card
from models import WishlistCreate
from typing import Optional
from lib.auth import get_user_id, require_user_id

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
def list_wishlist(
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    q = db.query(Wishlist)
    if user_id:
        q = q.filter(Wishlist.user_id == user_id)
    else:
        q = q.filter(Wishlist.user_id.is_(None))
    items = q.order_by(Wishlist.priority.desc()).all()
    return {"items": [item_to_dict(i) for i in items]}


@router.post("")
def add_to_wishlist(
    body: dict,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Accepts either {card_id, ...} OR {driver_name, parallel, grade?, ...}.
    The driver-name path looks up an existing matching Card, or creates a
    placeholder Card so the wishlist row has something to FK to."""
    card_id = body.get("card_id")
    if card_id:
        card = db.query(Card).filter(Card.id == card_id).first()
    else:
        driver = body.get("driver_name") or ""
        parallel = body.get("parallel") or "Refractor"
        grade = body.get("grade") or "Raw"
        # Try exact match first, then driver+parallel, then driver only
        card = (
            db.query(Card).filter(
                Card.driver_name == driver,
                Card.parallel == parallel,
                Card.grade == grade,
            ).first()
            or db.query(Card).filter(
                Card.driver_name == driver, Card.parallel == parallel
            ).first()
            or db.query(Card).filter(Card.driver_name == driver).first()
        )
        if not card:
            # Create a placeholder so the wishlist row has a card to point at
            card = Card(
                driver_name=driver, year=2025, set_name="Topps Chrome F1",
                parallel=parallel, grade=grade, base_value=0.0,
                investment_score=0.0,
            )
            db.add(card); db.commit(); db.refresh(card)
    if not card:
        raise HTTPException(400, "Driver name or card_id required")
    existing_q = db.query(Wishlist).filter(Wishlist.card_id == card.id)
    if user_id:
        existing_q = existing_q.filter(Wishlist.user_id == user_id)
    else:
        existing_q = existing_q.filter(Wishlist.user_id.is_(None))
    existing = existing_q.first()
    if existing:
        return item_to_dict(existing)
    item = Wishlist(
        card_id=card.id,
        max_price=body.get("max_price"),
        priority=body.get("priority", 3),
        notes=body.get("notes"),
        auto_snipe=body.get("auto_snipe", False),
        user_id=user_id,
    )
    db.add(item); db.commit(); db.refresh(item)
    return item_to_dict(item)


# --- Bulk endpoints ----------------------------------------------------------
# These MUST be registered before the `/{item_id}` routes below or FastAPI
# treats "bulk" as an item_id and 422s on path parsing.

@router.delete("/bulk")
def bulk_delete_wishlist(
    body: dict,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Delete many wishlist rows in one call. Body: {"ids": [1,2,3,...]}.
    Only rows owned by the caller are touched (user_id == JWT.sub).
    """
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "ids must be a non-empty list")
    # Cap to avoid pathological deletes
    ids = [int(i) for i in ids if isinstance(i, (int, str)) and str(i).isdigit()][:1000]
    if not ids:
        return {"deleted": 0}
    deleted = (
        db.query(Wishlist)
        .filter(Wishlist.id.in_(ids), Wishlist.user_id == user_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": int(deleted or 0)}


@router.patch("/bulk")
def bulk_update_wishlist(
    body: dict,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Apply a single patch to many wishlist rows in one call.
    Body: {"ids": [...], "patch": {"max_price": 50, "priority": 4, ...}}.
    Only the caller's rows are touched. Whitelisted fields only.
    """
    ids = body.get("ids") or []
    patch = body.get("patch") or {}
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "ids must be a non-empty list")
    if not isinstance(patch, dict) or not patch:
        raise HTTPException(400, "patch must be a non-empty object")
    ids = [int(i) for i in ids if isinstance(i, (int, str)) and str(i).isdigit()][:1000]
    # Only allow patching mutable user-controlled columns; never user_id/card_id.
    ALLOWED = {"max_price", "priority", "notes", "auto_snipe"}
    clean = {k: v for k, v in patch.items() if k in ALLOWED}
    if not clean:
        raise HTTPException(400, "no patchable fields in patch")
    if not ids:
        return {"updated": 0}
    updated = (
        db.query(Wishlist)
        .filter(Wishlist.id.in_(ids), Wishlist.user_id == user_id)
        .update(clean, synchronize_session=False)
    )
    db.commit()
    return {"updated": int(updated or 0)}


@router.patch("/{item_id}")
def update_wishlist_item(
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    item = db.query(Wishlist).filter(Wishlist.id == item_id).first()
    if not item:
        raise HTTPException(404, "Not found")
    # Caller must own the row; orphan rows (user_id=None) are not mutable.
    if item.user_id != user_id:
        raise HTTPException(403, "forbidden")
    # Don't let callers overwrite user_id via body
    for k, v in body.items():
        if k == "user_id":
            continue
        if hasattr(item, k):
            setattr(item, k, v)
    db.commit()
    return item_to_dict(item)


@router.delete("/{item_id}")
def delete_wishlist_item(
    item_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    item = db.query(Wishlist).filter(Wishlist.id == item_id).first()
    if not item:
        raise HTTPException(404, "Not found")
    if item.user_id != user_id:
        raise HTTPException(403, "forbidden")
    db.delete(item)
    db.commit()
    return {"ok": True}
