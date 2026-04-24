"""
F1CV25 Card Indices — equal-weighted basket indices for themed groups of cards.

Exposes:
  GET /api/indices              - list all baskets with current value + 7d/30d change
  GET /api/indices/{slug}/history?days=90 - daily history points for one basket
"""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

from database import get_db, SoldCard

router = APIRouter(prefix="/api/indices", tags=["indices"])

# Define the baskets — equal-weighted card sets per theme
BASKETS = {
    "f1cv25_top10": {
        "name": "F1CV25 Top 10 Drivers",
        "description": "Equal-weighted index of top 10 grid drivers, base parallel only",
        "drivers": ["Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
                    "Carlos Sainz", "George Russell", "Oscar Piastri", "Sergio Perez",
                    "Fernando Alonso", "Pierre Gasly"],
        "parallel": None,  # all parallels
    },
    "f1cv25_rookies": {
        "name": "F1CV25 Rookies Index",
        "description": "Equal-weighted basket of 2025 rookie cards",
        "drivers": ["Andrea Kimi Antonelli", "Gabriel Bortoleto", "Oliver Bearman",
                    "Isack Hadjar", "Jack Doohan", "Liam Lawson"],
        "parallel": None,
    },
    "f1cv25_autos": {
        "name": "F1CV25 Autograph Index",
        "description": "All autographed F1 cards, equal-weighted",
        "drivers": None,  # all
        "parallel": "Autograph",
    },
    "f1cv25_gold50": {
        "name": "F1CV25 Gold /50 Index",
        "description": "Gold /50 parallels for top 10 drivers",
        "drivers": ["Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris", "Oscar Piastri"],
        "parallel": "Gold /50",
    },
    "f1cv25_chrome_base": {
        "name": "F1CV25 Chrome Base Index",
        "description": "Plain Chrome base cards, all drivers",
        "drivers": None,
        "parallel": "Base",
    },
}


def _basket_value(db: Session, basket: dict, on_date: datetime):
    """Median of all sales matching the basket within +/-7d window of on_date."""
    window_start = on_date - timedelta(days=7)
    window_end = on_date + timedelta(days=7)
    q = db.query(SoldCard).filter(
        SoldCard.sale_date >= window_start,
        SoldCard.sale_date <= window_end,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712 (SQLA needs ==)
    )
    if basket["drivers"]:
        q = q.filter(SoldCard.driver_name.in_(basket["drivers"]))
    if basket["parallel"]:
        q = q.filter(SoldCard.parallel == basket["parallel"])
    prices = [(r.sale_price or 0) + (r.shipping_cost or 0) for r in q.all() if r.sale_price]
    if len(prices) < 3:
        return None
    prices.sort()
    return prices[len(prices) // 2]


@router.get("")
def list_indices(response: Response, db: Session = Depends(get_db)):
    """List all baskets with current value + 7d / 30d change."""
    now = datetime.utcnow()
    out = []
    for slug, basket in BASKETS.items():
        current = _basket_value(db, basket, now)
        week_ago = _basket_value(db, basket, now - timedelta(days=7))
        month_ago = _basket_value(db, basket, now - timedelta(days=30))
        wk_pct = round(((current - week_ago) / week_ago * 100), 1) if (current and week_ago) else None
        mo_pct = round(((current - month_ago) / month_ago * 100), 1) if (current and month_ago) else None
        out.append({
            "slug": slug,
            "name": basket["name"],
            "description": basket["description"],
            "value": current,
            "week_change_pct": wk_pct,
            "month_change_pct": mo_pct,
        })
    response.headers["Cache-Control"] = "public, s-maxage=600"
    return {"indices": out, "as_of": now.isoformat() + "Z"}


@router.get("/{slug}/history")
def index_history(slug: str, days: int = 90, db: Session = Depends(get_db), response: Response = None):
    """Daily history for one basket."""
    if slug not in BASKETS:
        return {"error": "unknown basket"}
    basket = BASKETS[slug]
    points = []
    now = datetime.utcnow()
    for d in range(days, -1, -3):  # every 3 days, 30 points for 90 day chart
        on_date = now - timedelta(days=d)
        val = _basket_value(db, basket, on_date)
        points.append({"date": on_date.strftime("%Y-%m-%d"), "value": val})
    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=600"
    return {"slug": slug, "name": basket["name"], "points": points}
