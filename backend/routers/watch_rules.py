"""Smart watch rules — auto-watch any matching auction."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime
from database import get_db, Base, Auction, Card
from datetime import datetime

router = APIRouter(prefix="/api/watch-rules", tags=["watch_rules"])


class WatchRule(Base):
    __tablename__ = "watch_rules"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    driver_filter = Column(String, nullable=True)
    parallel_filter = Column(String, nullable=True)
    grade_filter = Column(String, nullable=True)
    max_price = Column(Float, nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def _to_dict(r: WatchRule) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "driver_filter": r.driver_filter,
        "parallel_filter": r.parallel_filter,
        "grade_filter": r.grade_filter,
        "max_price": r.max_price,
        "active": r.active,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _rule_label(r: WatchRule) -> str:
    bits = []
    if r.driver_filter:
        bits.append(r.driver_filter)
    if r.parallel_filter:
        bits.append(r.parallel_filter)
    if r.grade_filter and r.grade_filter != "Raw":
        bits.append(r.grade_filter)
    return f"Watch every {' '.join(bits) or 'F1 card'} under ${r.max_price:.0f}"


@router.get("")
def list_rules(db: Session = Depends(get_db)):
    rules = db.query(WatchRule).order_by(WatchRule.created_at.desc()).all()
    return {"rules": [{**_to_dict(r), "label": _rule_label(r)} for r in rules]}


@router.post("")
def create_rule(body: dict, db: Session = Depends(get_db)):
    max_price = float(body.get("max_price") or 0)
    if max_price <= 0:
        raise HTTPException(400, "max_price must be > 0")
    r = WatchRule(
        name=body.get("name") or None,
        driver_filter=body.get("driver_filter") or None,
        parallel_filter=body.get("parallel_filter") or None,
        grade_filter=body.get("grade_filter") or None,
        max_price=max_price,
        active=bool(body.get("active", True)),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return {**_to_dict(r), "label": _rule_label(r)}


@router.patch("/{rule_id}")
def update_rule(rule_id: int, body: dict, db: Session = Depends(get_db)):
    r = db.query(WatchRule).filter(WatchRule.id == rule_id).first()
    if not r:
        raise HTTPException(404, "Not found")
    allowed = {"name", "driver_filter", "parallel_filter", "grade_filter", "max_price", "active"}
    for k, v in body.items():
        if k in allowed:
            setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return {**_to_dict(r), "label": _rule_label(r)}


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    r = db.query(WatchRule).filter(WatchRule.id == rule_id).first()
    if not r:
        raise HTTPException(404, "Not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


def auction_matches_rule(auction: Auction, rule: WatchRule, card: Card | None) -> bool:
    """Apply a rule against an auction. driver/parallel/grade are case-insensitive
    substring matches against either the linked card fields OR the raw title."""
    if not rule.active:
        return False
    total = (auction.current_price or 0) + (auction.shipping_cost or 0)
    if total > rule.max_price:
        return False
    title = (auction.title or "").lower()
    if rule.driver_filter:
        drv = rule.driver_filter.lower()
        card_drv = (card.driver_name or "").lower() if card else ""
        if drv not in card_drv and drv not in title:
            return False
    if rule.parallel_filter:
        par = rule.parallel_filter.lower()
        card_par = (card.parallel or "").lower() if card else ""
        if par not in card_par and par not in title:
            return False
    if rule.grade_filter:
        grd = rule.grade_filter.lower()
        card_grd = (card.grade or "").lower() if card else ""
        if grd not in card_grd and grd not in title:
            return False
    return True


def apply_rules_to_auctions(db: Session) -> int:
    """Walk active auctions, auto-set status='watchlist' for any that match an
    active rule. Returns count of auctions newly auto-watched."""
    rules = db.query(WatchRule).filter(WatchRule.active == True).all()
    if not rules:
        return 0
    # Only touch auctions that aren't already watched
    cands = db.query(Auction).filter(Auction.status == "active").all()
    auto = 0
    for a in cands:
        card = db.query(Card).filter(Card.id == a.card_id).first() if a.card_id else None
        if any(auction_matches_rule(a, r, card) for r in rules):
            a.status = "watchlist"
            auto += 1
    if auto:
        db.commit()
    return auto
