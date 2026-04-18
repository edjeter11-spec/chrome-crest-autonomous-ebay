"""
Verdict accuracy tracker — backtests STRONG BUY alerts against actual sold data.

For every alert of type='strong_buy' created >14 days ago, we look for sold_cards
rows for the same (driver, parallel) sold within 14 days of the alert creation
time. We then classify:
  Hit      — sold <= our predicted "fair" (median) price
  Miss     — sold > our predicted "fair" price
  No data  — no comp sale found in the window
"""
import re
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db, Alert, Auction, Card, SoldCard

router = APIRouter(prefix="/api/admin", tags=["verdict_accuracy"])


# Pull ratios and median out of the alert's message string:
#   "STRONG BUY: Verstappen Gold /50 PSA 10 — $120 vs $200 median (40% under, n=12 comps)"
_MED_RE = re.compile(r"\$([\d.]+)\s*vs\s*\$([\d.]+)\s*median", re.I)
_N_RE = re.compile(r"n=(\d+)\s*comps", re.I)


def _parse_alert_message(msg: str):
    """Return (cur_total, median, n_comps) parsed from the strong-buy message."""
    if not msg:
        return (None, None, None)
    m = _MED_RE.search(msg)
    n = _N_RE.search(msg)
    cur = float(m.group(1)) if m else None
    med = float(m.group(2)) if m else None
    ncomps = int(n.group(1)) if n else None
    return (cur, med, ncomps)


@router.get("/verdict-accuracy")
def verdict_accuracy(days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db)):
    """
    Backtest strong-buy alerts that are at least 14 days old.
    `days` limits how far back we look.
    """
    now = datetime.utcnow()
    horizon = now - timedelta(days=14)  # alerts older than 14 days are evaluable
    lookback = now - timedelta(days=days)

    alerts = db.query(Alert).filter(
        Alert.alert_type == "strong_buy",
        Alert.created_at <= horizon,
        Alert.created_at >= lookback,
    ).order_by(Alert.created_at.desc()).all()

    total = len(alerts)
    hits = 0
    misses = 0
    no_data = 0

    by_driver: dict = {}
    by_parallel: dict = {}
    recent_misses: list = []

    for al in alerts:
        cur_total, median, ncomps = _parse_alert_message(al.message or "")
        card = db.query(Card).filter(Card.id == al.card_id).first() if al.card_id else None
        driver = (card.driver_name if card else None) or "Unknown"
        parallel = (card.parallel if card else None) or "Base"

        # Lookup actual sold comps in the 14-day window post-alert
        win_start = al.created_at
        win_end = (al.created_at or now) + timedelta(days=14)
        q = db.query(SoldCard).filter(
            SoldCard.driver_name == driver,
            SoldCard.sale_date >= win_start,
            SoldCard.sale_date <= win_end,
            SoldCard.sale_price > 0,
            SoldCard.is_duplicate == False,  # noqa: E712
        )
        if parallel and parallel != "Base":
            q = q.filter(SoldCard.parallel == parallel)
        post_sales = q.all()

        # Driver/Parallel buckets
        d_b = by_driver.setdefault(driver, {"driver": driver, "total": 0, "hits": 0, "misses": 0, "no_data": 0})
        p_b = by_parallel.setdefault(parallel, {"parallel": parallel, "total": 0, "hits": 0, "misses": 0, "no_data": 0})
        d_b["total"] += 1
        p_b["total"] += 1

        if not post_sales or median is None:
            no_data += 1
            d_b["no_data"] += 1
            p_b["no_data"] += 1
            continue

        # Use the median of post-alert sales as the actual settled price
        prices = sorted(
            [float(s.sale_price or 0) + float(s.shipping_cost or 0) for s in post_sales]
        )
        n = len(prices)
        actual_med = prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2

        if actual_med <= median * 1.05:  # within 5% = still a hit
            hits += 1
            d_b["hits"] += 1
            p_b["hits"] += 1
        else:
            misses += 1
            d_b["misses"] += 1
            p_b["misses"] += 1
            if len(recent_misses) < 10:
                recent_misses.append({
                    "alert_id": al.id,
                    "created_at": al.created_at.isoformat() if al.created_at else None,
                    "driver": driver,
                    "parallel": parallel,
                    "predicted_median": round(median, 2),
                    "actual_median": round(actual_med, 2),
                    "overshoot_pct": round((actual_med / median - 1) * 100, 1),
                    "comps_found": n,
                    "message": (al.message or "")[:180],
                })

    evaluable = hits + misses
    hit_rate = round(hits / evaluable * 100, 1) if evaluable else 0.0

    def _sort_buckets(bs):
        out = []
        for b in bs.values():
            ev = b["hits"] + b["misses"]
            b["hit_rate_pct"] = round(b["hits"] / ev * 100, 1) if ev else 0.0
            out.append(b)
        out.sort(key=lambda x: (-x["total"], x.get("driver") or x.get("parallel") or ""))
        return out

    return {
        "total_strong_buys": total,
        "evaluable": evaluable,
        "hits": hits,
        "misses": misses,
        "no_data": no_data,
        "hit_rate_pct": hit_rate,
        "days": days,
        "by_driver": _sort_buckets(by_driver)[:15],
        "by_parallel": _sort_buckets(by_parallel)[:15],
        "recent_misses": recent_misses,
    }
