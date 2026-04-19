"""
Price prediction — simple linear regression trend over last 60 days.
No ML, just cov(x,y)/var(x).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional

from database import get_db, SoldCard

router = APIRouter(prefix="/api/predictions", tags=["predictions"])


def _median(values):
    if not values:
        return None
    v = sorted(values)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


@router.get("/driver/{driver_name}")
def predict_driver(
    driver_name: str,
    parallel: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    days: int = 60,
    horizon: int = 30,
    db: Session = Depends(get_db),
):
    cutoff = datetime.utcnow() - timedelta(days=days)
    q = db.query(SoldCard).filter(
        SoldCard.driver_name == driver_name,
        SoldCard.sale_date >= cutoff,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
    )
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if grade:
        if grade.lower() == "raw":
            q = q.filter(SoldCard.grade.is_(None))
        else:
            q = q.filter(SoldCard.grade == grade)

    rows = q.all()
    pts = []
    now = datetime.utcnow()
    for r in rows:
        price = float((r.sale_price or 0) + (r.shipping_cost or 0))
        if price <= 0 or not r.sale_date:
            continue
        days_ago = (now - r.sale_date).total_seconds() / 86400.0
        pts.append((days_ago, price, r.sale_date.date().isoformat()))

    n = len(pts)
    if n < 5:
        return {"status": "insufficient", "n": n, "driver": driver_name,
                "parallel": parallel, "grade": grade}

    # Linear regression: y = intercept + slope * x, where x = -days_ago (so future = +horizon)
    xs = [-p[0] for p in pts]  # chronological: older = more negative
    ys = [p[1] for p in pts]
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    den = sum((xs[i] - mx) ** 2 for i in range(n))
    slope = (num / den) if den > 0 else 0.0
    intercept = my - slope * mx

    current_median = _median(ys)
    # Project horizon days into the future: x = horizon
    predicted = intercept + slope * horizon
    # Current trend baseline at x=0 (today)
    today_trend = intercept + slope * 0
    if today_trend > 0:
        pct_change = round((predicted - today_trend) / today_trend * 100, 1)
    else:
        pct_change = None

    # Build history (date, price) sorted chronologically
    pts_sorted = sorted(pts, key=lambda t: t[0], reverse=True)
    history = [{"date": p[2], "price": round(p[1], 2)} for p in pts_sorted]

    return {
        "status": "ok",
        "driver": driver_name,
        "parallel": parallel,
        "grade": grade,
        "n": n,
        "days": days,
        "horizon": horizon,
        "slope_per_day": round(slope, 4),
        "current_median": round(current_median, 2) if current_median else None,
        "predicted_30d": round(predicted, 2),
        "percent_change": pct_change,
        "history": history,
    }
