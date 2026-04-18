"""Public shared watchlist links. Snapshot-based — no live mutation after share."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, DateTime, Text
from database import get_db, Base, engine, Auction, Wishlist, Card
from datetime import datetime
import secrets
import json

router = APIRouter(prefix="/api/watchlist", tags=["shared_watchlists"])


class SharedWatchlist(Base):
    __tablename__ = "shared_watchlists"
    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    items_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    view_count = Column(Integer, default=0)


def _generate_token() -> str:
    return secrets.token_urlsafe(6)  # ~8 chars


@router.post("/share")
def create_share(body: dict = None, db: Session = Depends(get_db)):
    """Snapshot current watchlist (live auction watches + wishlist items) and return a token."""
    body = body or {}
    # Capture live-watched auctions
    watched = db.query(Auction).filter(Auction.status == "watchlist").all()
    # Capture wishlist items
    wishes = db.query(Wishlist).all()

    items = []
    for a in watched:
        card = a.card
        items.append({
            "kind": "auction",
            "title": a.title,
            "price": a.current_price,
            "shipping": a.shipping_cost or 0,
            "image_url": a.image_url,
            "ebay_url": a.ebay_url,
            "driver": card.driver_name if card else None,
            "parallel": card.parallel if card else None,
            "grade": card.grade if card else None,
            "team_color": card.team_color if card else None,
            "end_time": a.end_time.isoformat() if a.end_time else None,
        })
    for w in wishes:
        card = w.card
        items.append({
            "kind": "wish",
            "driver": card.driver_name if card else None,
            "parallel": card.parallel if card else None,
            "grade": card.grade if card else None,
            "team_color": card.team_color if card else None,
            "max_price": w.max_price,
            "notes": w.notes,
            "priority": w.priority,
        })

    token = _generate_token()
    # Collision retry (very unlikely with token_urlsafe(6))
    while db.query(SharedWatchlist).filter(SharedWatchlist.token == token).first():
        token = _generate_token()

    row = SharedWatchlist(
        token=token,
        name=body.get("name") or "My F1 Card Watchlist",
        items_json=json.dumps(items),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "token": token,
        "count": len(items),
        "created_at": row.created_at.isoformat(),
    }


@router.get("/shared/{token}")
def get_share(token: str, db: Session = Depends(get_db)):
    row = db.query(SharedWatchlist).filter(SharedWatchlist.token == token).first()
    if not row:
        raise HTTPException(404, "Shared watchlist not found")
    row.view_count = (row.view_count or 0) + 1
    db.commit()
    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []
    return {
        "token": token,
        "name": row.name,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "view_count": row.view_count,
        "items": items,
    }
