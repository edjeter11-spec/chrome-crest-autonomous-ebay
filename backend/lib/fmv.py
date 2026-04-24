"""Population-weighted Fair Market Value computation per (driver, parallel, grade)."""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from typing import Optional
import math

def compute_fmv(
    db: Session,
    driver: str,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    days: int = 90,
    min_sample: int = 5,
) -> dict:
    """
    Returns: {fmv, lower, upper, n, confidence, last_sale_date}
    confidence: 'high' (n>=20), 'medium' (n>=10), 'low' (n>=5), 'unknown' (n<5)
    Uses trimmed mean of last N sales — drops top/bottom 10% to ignore outliers.
    """
    from database import SoldCard
    from sqlalchemy import func

    cutoff = datetime.utcnow() - timedelta(days=days)
    q = db.query(SoldCard).filter(
        SoldCard.sale_date >= cutoff,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,
        SoldCard.driver_name == driver,
    )
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if grade:
        q = q.filter(SoldCard.grade == grade)
    rows = q.order_by(SoldCard.sale_date.desc()).all()

    prices = [(r.sale_price or 0) + (r.shipping_cost or 0) for r in rows if (r.sale_price or 0) > 0]
    n = len(prices)
    if n < min_sample:
        return {"fmv": None, "lower": None, "upper": None, "n": n, "confidence": "unknown", "last_sale_date": rows[0].sale_date.isoformat() + "Z" if rows else None}

    # Trim 10% from each end
    prices.sort()
    trim = max(1, n // 10)
    trimmed = prices[trim:-trim] if n > 2 * trim else prices
    fmv = sum(trimmed) / len(trimmed)
    # Standard deviation for confidence interval
    if len(trimmed) > 1:
        mean = fmv
        variance = sum((p - mean) ** 2 for p in trimmed) / len(trimmed)
        std = math.sqrt(variance)
        lower = round(max(0, fmv - std), 2)
        upper = round(fmv + std, 2)
    else:
        lower = upper = round(fmv, 2)

    confidence = "high" if n >= 20 else "medium" if n >= 10 else "low"
    return {
        "fmv": round(fmv, 2),
        "lower": lower,
        "upper": upper,
        "n": n,
        "confidence": confidence,
        "last_sale_date": rows[0].sale_date.isoformat() + "Z" if rows else None,
    }
