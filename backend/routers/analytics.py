from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db, Card, Auction, Portfolio, Alert

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    total_cards = db.query(func.count(Card.id)).scalar()
    active_auctions = db.query(func.count(Auction.id)).filter(Auction.status == "active").scalar()
    snipe_targets = db.query(func.count(Auction.id)).filter(
        Auction.status == "active", Auction.snipe_eligible == True
    ).scalar()
    avg_price = db.query(func.avg(Auction.current_price)).filter(Auction.status == "active").scalar()
    active_alerts = db.query(func.count(Alert.id)).filter(Alert.triggered == True).scalar()

    return {
        "total_cards": total_cards,
        "active_auctions": active_auctions,
        "snipe_targets": snipe_targets,
        "avg_price": float(avg_price) if avg_price else 0,
        "active_alerts": active_alerts,
    }


@router.get("/full")
def full_analytics(db: Session = Depends(get_db)):
    base = summary(db)

    # By driver
    driver_counts = db.query(
        Card.driver_name.label("driver"),
        func.count(Auction.id).label("count"),
    ).join(Auction, Auction.card_id == Card.id).filter(
        Auction.status == "active"
    ).group_by(Card.driver_name).order_by(func.count(Auction.id).desc()).all()

    # By parallel
    parallel_counts = db.query(
        Card.parallel.label("parallel"),
        func.count(Auction.id).label("count"),
    ).join(Auction, Auction.card_id == Card.id).filter(
        Auction.status == "active"
    ).group_by(Card.parallel).order_by(func.count(Auction.id).desc()).all()

    # Portfolio summary
    portfolio_items = db.query(Portfolio).all()
    total_cost = sum(p.purchase_price * (p.quantity or 1) for p in portfolio_items)
    total_value = sum((p.current_value or 0) * (p.quantity or 1) for p in portfolio_items)

    return {
        **base,
        "by_driver": [{"driver": r.driver, "count": r.count} for r in driver_counts],
        "by_parallel": [{"parallel": r.parallel, "count": r.count} for r in parallel_counts],
        "portfolio_cost": total_cost,
        "portfolio_value": total_value,
        "portfolio_pnl": total_value - total_cost,
    }
