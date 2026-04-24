from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db, Card, Auction
from typing import Optional

router = APIRouter(prefix="/api/cards", tags=["cards"])


def card_to_dict(c: Card) -> dict:
    return {
        "id": c.id,
        "driver_name": c.driver_name,
        "year": c.year,
        "set_name": c.set_name,
        "card_number": c.card_number,
        "parallel": c.parallel,
        "grade": c.grade,
        "image_url": c.image_url,
        "base_value": c.base_value,
        "investment_score": c.investment_score,
        "team": c.team,
        "team_color": c.team_color,
        "nationality": c.nationality,
        "career_wins": c.career_wins,
        "championships": c.championships,
        "series": getattr(c, "series", "F1") or "F1",
        "is_rookie": getattr(c, "is_rookie", False) or False,
    }


@router.get("")
def list_cards(
    driver: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Card)
    if driver:
        q = q.filter(Card.driver_name.ilike(f"%{driver}%"))
    if parallel:
        q = q.filter(Card.parallel == parallel)
    if grade:
        q = q.filter(Card.grade == grade)
    total = q.count()
    cards = q.offset(offset).limit(limit).all()
    return {"total": total, "cards": [card_to_dict(c) for c in cards]}


@router.get("/drivers-summary")
def drivers_summary(db: Session = Depends(get_db)):
    # Single query: base cards (Raw/Base) for driver metadata
    drivers_raw = db.query(
        Card.driver_name,
        Card.team,
        Card.team_color,
        Card.nationality,
        Card.career_wins,
        Card.championships,
        Card.card_number,
        Card.image_url,
        Card.base_value,
        func.max(Card.investment_score).label("investment_score"),
    ).filter(Card.grade == "Raw", Card.parallel == "Base").group_by(
        Card.driver_name, Card.team, Card.team_color, Card.nationality,
        Card.career_wins, Card.championships, Card.card_number,
        Card.image_url, Card.base_value,
    ).all()

    if not drivers_raw:
        return []

    driver_names = [d.driver_name for d in drivers_raw]

    # Bulk auction counts — 2 queries total instead of 2×N
    active_counts_raw = db.query(
        Card.driver_name, func.count(Auction.id).label("cnt")
    ).join(Auction, Auction.card_id == Card.id).filter(
        Card.driver_name.in_(driver_names), Auction.status == "active"
    ).group_by(Card.driver_name).all()
    active_map = {r.driver_name: r.cnt for r in active_counts_raw}

    snipe_counts_raw = db.query(
        Card.driver_name, func.count(Auction.id).label("cnt")
    ).join(Auction, Auction.card_id == Card.id).filter(
        Card.driver_name.in_(driver_names), Auction.status == "active",
        Auction.snipe_eligible == True
    ).group_by(Card.driver_name).all()
    snipe_map = {r.driver_name: r.cnt for r in snipe_counts_raw}

    # Bulk parallels — 1 query for all drivers
    parallels_raw = db.query(
        Card.driver_name, Card.parallel, Card.grade, Card.base_value, Card.investment_score,
    ).filter(Card.driver_name.in_(driver_names)).all()

    par_by_driver: dict = {}
    for p in parallels_raw:
        pd = par_by_driver.setdefault(p.driver_name, {})
        key = p.parallel
        if key not in pd:
            pd[key] = {"parallel": key, "raw_value": None, "psa10_value": None, "investment_score": p.investment_score}
        if p.grade == "Raw":
            pd[key]["raw_value"] = p.base_value
        elif p.grade == "PSA 10":
            pd[key]["psa10_value"] = p.base_value

    result = []
    for d in drivers_raw:
        par_dict = par_by_driver.get(d.driver_name, {})
        result.append({
            "driver_name": d.driver_name,
            "team": d.team,
            "team_color": d.team_color,
            "nationality": d.nationality,
            "career_wins": d.career_wins,
            "championships": d.championships,
            "series": getattr(d, "series", "F1") or "F1",
            "is_rookie": getattr(d, "is_rookie", False) or False,
            "card_number": d.card_number,
            "investment_score": d.investment_score,
            "active_auctions": active_map.get(d.driver_name, 0),
            "snipe_count": snipe_map.get(d.driver_name, 0),
            "base_value": d.base_value,
            "image_url": d.image_url,
            "parallels": sorted(par_dict.values(), key=lambda x: x.get("raw_value") or 0, reverse=True),
        })

    return sorted(result, key=lambda x: x["investment_score"] or 0, reverse=True)


@router.get("/fmv")
def card_fmv(
    driver: str,
    parallel: str | None = None,
    grade: str | None = None,
    days: int = 90,
    db: Session = Depends(get_db),
):
    from lib.fmv import compute_fmv
    return compute_fmv(db, driver, parallel, grade, days)


@router.get("/{card_id}")
def get_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(404, "Card not found")
    return card_to_dict(card)


@router.get("/{card_id}/price-history")
def price_history(card_id: int, db: Session = Depends(get_db)):
    from sqlalchemy import text
    from database import PriceHistory, engine
    # Ensure column exists (idempotent — Vercel lambdas may skip startup event)
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE price_history ADD COLUMN ebay_item_id VARCHAR(64)"))
            conn.commit()
    except Exception:
        pass
    history = db.query(PriceHistory).filter(
        PriceHistory.card_id == card_id
    ).order_by(PriceHistory.sale_date.asc()).all()
    return {"history": [
        {
            "price": h.price,
            "sale_date": h.sale_date.isoformat(),
            "source": h.source,
            "condition": h.condition,
        }
        for h in history
    ]}
