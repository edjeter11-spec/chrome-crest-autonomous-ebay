"""
F1CV25 Card Indices — equal-weighted basket indices for themed groups of cards.

Exposes:
  GET /api/indices              - list all baskets with current value + 7d/30d change
  GET /api/indices/{slug}/history?days=90 - daily history points for one basket
  GET /api/indices/history?slugs=a,b,c&days=90 - batch history for many baskets
"""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from sqlalchemy import text as _sql_text
from datetime import datetime, timedelta
from typing import Optional

from database import get_db, SoldCard, BasketDailyValue, engine as _engine

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


def _upsert_basket_value(db: Session, slug: str, on_date: datetime, value):
    """UPSERT a single (slug, date) → value row into basket_daily_value.
    Idempotent. Used by the cold-path fallback in the history endpoints."""
    if value is None:
        return
    is_pg = "postgresql" in str(_engine.url)
    # Normalize date to midnight UTC for stable uniqueness
    day = datetime(on_date.year, on_date.month, on_date.day)
    now = datetime.utcnow()
    try:
        if is_pg:
            db.execute(_sql_text(
                "INSERT INTO basket_daily_value (slug, date, value, computed_at) "
                "VALUES (:slug, :date, :value, :ts) "
                "ON CONFLICT ON CONSTRAINT uq_basket_slug_date DO UPDATE SET "
                "value = EXCLUDED.value, computed_at = EXCLUDED.computed_at"
            ), {"slug": slug, "date": day, "value": float(value), "ts": now})
        else:
            existing = (db.query(BasketDailyValue)
                        .filter(BasketDailyValue.slug == slug,
                                BasketDailyValue.date == day)
                        .first())
            if existing:
                existing.value = float(value)
                existing.computed_at = now
            else:
                db.add(BasketDailyValue(slug=slug, date=day,
                                         value=float(value), computed_at=now))
        db.commit()
    except Exception:
        db.rollback()


def _history_from_table(db: Session, slug: str, days: int):
    """Read precomputed daily history from basket_daily_value.

    Returns a list of {date, value} dicts in the same 3-day cadence as the
    legacy live-compute path. Empty cadence slots get value=None so the
    chart shape is identical. Returns [] only if the table has zero rows
    for this slug (signal to fall back to live compute)."""
    cutoff = datetime.utcnow() - timedelta(days=days + 1)
    rows = (db.query(BasketDailyValue.date, BasketDailyValue.value)
            .filter(BasketDailyValue.slug == slug,
                    BasketDailyValue.date >= cutoff)
            .all())
    if not rows:
        return []
    # Map day-key -> value for O(1) lookup
    by_day: dict = {}
    for d, v in rows:
        key = datetime(d.year, d.month, d.day)
        by_day[key] = v
    # Emit the same 3-day cadence the legacy code did
    points = []
    now = datetime.utcnow()
    for d_off in range(days, -1, -3):
        on_date = now - timedelta(days=d_off)
        day_key = datetime(on_date.year, on_date.month, on_date.day)
        points.append({
            "date": on_date.strftime("%Y-%m-%d"),
            "value": by_day.get(day_key),
        })
    return points


def _history_live_compute(db: Session, slug: str, basket: dict, days: int,
                          persist: bool = True):
    """Cold-path: compute history live (legacy behavior) and optionally
    upsert each point into basket_daily_value so the next read is fast."""
    points = []
    now = datetime.utcnow()
    for d in range(days, -1, -3):
        on_date = now - timedelta(days=d)
        val = _basket_value(db, basket, on_date)
        points.append({"date": on_date.strftime("%Y-%m-%d"), "value": val})
        if persist and val is not None:
            _upsert_basket_value(db, slug, on_date, val)
    return points


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


@router.get("/history")
def indices_history_batch(
    days: int = 90,
    slugs: Optional[str] = None,
    response: Response = None,
    db: Session = Depends(get_db),
):
    """Batched daily history for many baskets in one call.

    Query params:
      days  — chart window in days (default 90)
      slugs — comma-separated basket slugs (omit/empty = all known baskets)

    Returns: { "<slug>": [{date, value}, ...], ... }

    Reads from precomputed `basket_daily_value` table for sub-100ms latency.
    Falls back to live compute (and persists the result) for any slug whose
    table rows are missing — covers fresh deploys and newly-added indices.
    """
    if slugs:
        wanted = [s.strip() for s in slugs.split(",") if s.strip()]
    else:
        wanted = list(BASKETS.keys())

    out: dict[str, list] = {}
    for slug in wanted:
        basket = BASKETS.get(slug)
        if not basket:
            out[slug] = []
            continue
        points = _history_from_table(db, slug, days)
        if not points:
            points = _history_live_compute(db, slug, basket, days, persist=True)
        out[slug] = points

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=900, stale-while-revalidate=3600"
    return out


@router.get("/{slug}/history")
def index_history(slug: str, days: int = 90, db: Session = Depends(get_db), response: Response = None):
    """Daily history for one basket.

    Reads from precomputed `basket_daily_value` table for sub-100ms latency.
    Falls back to live compute (and persists the result) for fresh deploys
    or newly-added indices.
    """
    if slug not in BASKETS:
        return {"error": "unknown basket"}
    basket = BASKETS[slug]
    points = _history_from_table(db, slug, days)
    if not points:
        points = _history_live_compute(db, slug, basket, days, persist=True)
    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=900, stale-while-revalidate=3600"
    return {"slug": slug, "name": basket["name"], "points": points}
