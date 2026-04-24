"""
Seller reputation insights — derived from existing `auctions` data.

Endpoints:
  GET /api/sellers/insights?seller=X
  GET /api/sellers/suspicious?limit=20
  GET /api/sellers/top-rated?limit=20
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db, Auction

router = APIRouter(prefix="/api/sellers", tags=["sellers"])


def _compute_flags(row: dict) -> list[str]:
    flags = []
    fb = row.get("total_feedback") or 0
    active = row.get("active_listings") or 0
    recent24 = row.get("recent_listings_24h") or 0
    ended_unsold = row.get("ended_unsold") or 0

    if fb >= 5000:
        flags.append("top_rated")
    if fb < 50:
        flags.append("low_feedback")
    if recent24 > 10:
        flags.append("power_lister")
    if active > 30:
        flags.append("flooder")
    if active >= 10 and fb < 100:
        flags.append("suspicious")
    if ended_unsold > 15 and fb < 500:
        flags.append("many_unsold")
    return flags


def _seller_stats(db: Session, seller: str) -> dict:
    rows = db.query(Auction).filter(Auction.seller == seller).all()
    if not rows:
        return {"seller": seller, "found": False}

    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)

    total = len(rows)
    active = sum(1 for r in rows if r.status == "active")
    ended = sum(1 for r in rows if r.status == "ended")
    # "ended unsold" heuristic: status ended AND bid_count == 0 AND price <= 1 ignored; we only have what we have.
    ended_unsold = sum(1 for r in rows if r.status == "ended" and (r.bid_count or 0) == 0)
    recent24 = sum(1 for r in rows if r.created_at and r.created_at >= cutoff_24h)
    total_feedback = max((r.seller_feedback or 0) for r in rows)
    prices = [r.current_price for r in rows if (r.current_price or 0) > 0]
    avg_price = round(sum(prices) / len(prices), 2) if prices else 0.0

    out = {
        "seller": seller,
        "found": True,
        "total_listings": total,
        "active_listings": active,
        "ended_listings": ended,
        "ended_unsold": ended_unsold,
        "recent_listings_24h": recent24,
        "total_feedback": total_feedback,
        "avg_card_price": avg_price,
        "ebay_seller_url": f"https://www.ebay.com/usr/{seller}",
    }
    out["flags"] = _compute_flags(out)
    return out


@router.get("/insights")
def seller_insights(seller: str = Query(...), db: Session = Depends(get_db)):
    data = _seller_stats(db, seller)
    if not data.get("found"):
        raise HTTPException(404, f"seller '{seller}' not found in auctions")
    return data


def _all_seller_rollup(db: Session) -> list[dict]:
    """Aggregate every known seller into one dict — single DB pass."""
    rows = db.query(Auction).filter(Auction.seller.isnot(None)).all()
    now = datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    agg: dict = {}
    for r in rows:
        s = r.seller
        if not s:
            continue
        b = agg.setdefault(s, {
            "seller": s, "total_listings": 0, "active_listings": 0,
            "ended_listings": 0, "ended_unsold": 0, "recent_listings_24h": 0,
            "total_feedback": 0, "price_sum": 0.0, "price_n": 0,
        })
        b["total_listings"] += 1
        if r.status == "active":
            b["active_listings"] += 1
        if r.status == "ended":
            b["ended_listings"] += 1
            if (r.bid_count or 0) == 0:
                b["ended_unsold"] += 1
        if r.created_at and r.created_at >= cutoff_24h:
            b["recent_listings_24h"] += 1
        fb = r.seller_feedback or 0
        if fb > b["total_feedback"]:
            b["total_feedback"] = fb
        if (r.current_price or 0) > 0:
            b["price_sum"] += r.current_price
            b["price_n"] += 1

    out = []
    for b in agg.values():
        b["avg_card_price"] = round(b["price_sum"] / b["price_n"], 2) if b["price_n"] else 0.0
        b["ebay_seller_url"] = f"https://www.ebay.com/usr/{b['seller']}"
        b.pop("price_sum", None); b.pop("price_n", None)
        b["flags"] = _compute_flags(b)
        out.append(b)
    return out


@router.get("/suspicious")
def suspicious_sellers(limit: int = Query(20, le=100), db: Session = Depends(get_db)):
    sellers = _all_seller_rollup(db)
    sus = [s for s in sellers if "suspicious" in s["flags"] or "flooder" in s["flags"] or "many_unsold" in s["flags"]]
    # Sort by red-flag severity (flooder + low feedback > everything)
    def _score(s):
        sc = 0
        if "suspicious" in s["flags"]: sc += 100
        if "flooder" in s["flags"]: sc += 50
        if "low_feedback" in s["flags"]: sc += 30
        if "many_unsold" in s["flags"]: sc += 20
        sc += (s["active_listings"] or 0)
        return -sc
    sus.sort(key=_score)
    return {"sellers": sus[:limit], "total_flagged": len(sus)}


@router.get("/top-rated")
def top_rated_sellers(limit: int = Query(20, le=100), db: Session = Depends(get_db)):
    sellers = _all_seller_rollup(db)
    top = [s for s in sellers if "top_rated" in s["flags"]]
    top.sort(key=lambda s: -(s["total_feedback"] or 0))
    return {"sellers": top[:limit], "total": len(top)}


@router.get("/score")
def seller_score(seller: str, db: Session = Depends(get_db)):
    from lib.seller_score import compute_seller_score
    return compute_seller_score(db, seller)
