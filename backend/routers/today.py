"""
Today endpoint — diff of what changed for the user since `since` ISO timestamp.

Exposes:
  GET /api/today?since=ISO
    - new_sales: recent SoldCard rows since cutoff (up to 25)
    - new_alerts: Alert rows since cutoff grouped by alert_type
    - watchlist_changes: watchlisted auctions updated after cutoff
    - biggest_movers_24h: drivers+parallels whose median price moved most in last 24h
    - new_strong_buys_count: count of active auctions with verdict STRONG_BUY
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime, timedelta
from typing import Optional

from database import get_db, SoldCard, Alert, Auction, Card

router = APIRouter(prefix="/api/today", tags=["today"])


def _median(vals: list[float]) -> Optional[float]:
    if not vals:
        return None
    s = sorted(vals)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


@router.get("")
def today(since: Optional[str] = Query(None), db: Session = Depends(get_db)):
    now = datetime.utcnow()
    try:
        since_dt = datetime.fromisoformat((since or "").replace("Z", "").replace("+00:00", ""))
    except Exception:
        since_dt = now - timedelta(hours=24)

    # --- New sales ---
    sales_rows = db.query(SoldCard).filter(
        SoldCard.sale_date >= since_dt,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
    ).order_by(desc(SoldCard.sale_date)).limit(25).all()
    new_sales = [
        {
            "id": s.id,
            "driver": s.driver_name,
            "parallel": s.parallel,
            "grade": s.grade,
            "sale_price": s.sale_price,
            "shipping_cost": s.shipping_cost,
            "sale_date": s.sale_date.isoformat() if s.sale_date else None,
            "title": (s.title or "")[:120],
            "ebay_url": s.ebay_url,
            "image_url": s.image_url,
        }
        for s in sales_rows
    ]
    new_sales_total = db.query(func.count(SoldCard.id)).filter(
        SoldCard.sale_date >= since_dt,
        SoldCard.is_duplicate == False,  # noqa: E712
    ).scalar() or 0

    # --- New alerts, grouped ---
    alert_rows = db.query(Alert).filter(
        Alert.created_at >= since_dt,
        Alert.triggered == True,
    ).order_by(desc(Alert.created_at)).limit(200).all()
    alerts_by_type: dict = {}
    for a in alert_rows:
        b = alerts_by_type.setdefault(a.alert_type or "other", {"count": 0, "samples": []})
        b["count"] += 1
        if len(b["samples"]) < 3:
            b["samples"].append({
                "id": a.id,
                "message": (a.message or "")[:160],
                "urgency": a.urgency,
                "auction_id": a.auction_id,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            })
    new_alerts = [{"alert_type": k, **v} for k, v in alerts_by_type.items()]
    new_alerts.sort(key=lambda r: -r["count"])

    # --- Watchlist changes ---
    watch_rows = db.query(Auction).filter(
        Auction.status == "watchlist",
    ).all()
    watchlist_changes = []
    for a in watch_rows:
        lu = a.last_updated or a.created_at
        if not lu or lu < since_dt:
            continue
        watchlist_changes.append({
            "id": a.id,
            "title": (a.title or "")[:140],
            "current_price": a.current_price,
            "driver": a.card.driver_name if a.card else None,
            "parallel": a.card.parallel if a.card else None,
            "ebay_url": a.ebay_url,
            "image_url": a.image_url,
            "last_updated": lu.isoformat() if lu else None,
        })
    watchlist_changes.sort(key=lambda r: r.get("last_updated") or "", reverse=True)
    watchlist_changes = watchlist_changes[:20]

    # --- Biggest movers 24h (driver+parallel): compare last-24h median vs prior-7d median ---
    recent_cut = now - timedelta(hours=24)
    prior_cut = now - timedelta(days=8)
    mover_rows = db.query(SoldCard).filter(
        SoldCard.sale_date >= prior_cut,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
        SoldCard.driver_name.isnot(None),
        SoldCard.parallel.isnot(None),
    ).all()
    buckets: dict = {}
    for r in mover_rows:
        total = float(r.sale_price or 0) + float(r.shipping_cost or 0)
        if total <= 0:
            continue
        k = (r.driver_name, r.parallel)
        b = buckets.setdefault(k, {"recent": [], "prior": []})
        if r.sale_date >= recent_cut:
            b["recent"].append(total)
        else:
            b["prior"].append(total)
    movers = []
    for (driver, parallel), b in buckets.items():
        if len(b["recent"]) < 1 or len(b["prior"]) < 2:
            continue
        r_med = _median(b["recent"])
        p_med = _median(b["prior"])
        if not r_med or not p_med or p_med <= 0:
            continue
        delta_pct = (r_med - p_med) / p_med * 100
        movers.append({
            "driver": driver,
            "parallel": parallel,
            "recent_median": round(r_med, 2),
            "prior_median": round(p_med, 2),
            "delta_pct": round(delta_pct, 1),
            "recent_n": len(b["recent"]),
            "prior_n": len(b["prior"]),
        })
    movers.sort(key=lambda x: abs(x["delta_pct"]), reverse=True)
    biggest_movers = movers[:8]

    # --- New strong buys count (use auctions table + compare with sold median like /with-verdicts) ---
    new_strong_buys_count = 0
    try:
        from scraper import median_comp_price, _extract_grade_from_title
        active_rows = db.query(Auction).filter(
            Auction.status == "active",
            Auction.created_at >= since_dt,
        ).limit(400).all()
        cache: dict = {}
        for a in active_rows:
            if not a.card:
                continue
            key = (a.card.driver_name, a.card.parallel, _extract_grade_from_title(a.title or ""))
            if key not in cache:
                cache[key] = median_comp_price(db, key[0], key[1], key[2])
            median, n = cache[key]
            if median and n >= 3:
                total = (a.current_price or 0) + (a.shipping_cost or 0)
                if median > 0 and total / median <= 0.6:
                    new_strong_buys_count += 1
    except Exception:
        pass

    total_changes = (
        len(new_sales) + sum(r["count"] for r in new_alerts)
        + len(watchlist_changes) + new_strong_buys_count
    )

    return {
        "since": since_dt.isoformat(),
        "now": now.isoformat(),
        "new_sales": new_sales,
        "new_sales_total": new_sales_total,
        "new_alerts": new_alerts,
        "watchlist_changes": watchlist_changes,
        "biggest_movers_24h": biggest_movers,
        "new_strong_buys_count": new_strong_buys_count,
        "total_changes": total_changes,
    }


@router.get("/count")
def today_count(since: Optional[str] = Query(None), db: Session = Depends(get_db)):
    """Lightweight badge count — only unread totals (no row payloads)."""
    now = datetime.utcnow()
    try:
        since_dt = datetime.fromisoformat((since or "").replace("Z", "").replace("+00:00", ""))
    except Exception:
        since_dt = now - timedelta(hours=24)

    sales_n = db.query(func.count(SoldCard.id)).filter(
        SoldCard.sale_date >= since_dt,
        SoldCard.is_duplicate == False,  # noqa: E712
    ).scalar() or 0
    alerts_n = db.query(func.count(Alert.id)).filter(
        Alert.created_at >= since_dt,
        Alert.triggered == True,
    ).scalar() or 0
    return {
        "since": since_dt.isoformat(),
        "new_sales": int(sales_n),
        "new_alerts": int(alerts_n),
        "total": int(sales_n) + int(alerts_n),
    }
