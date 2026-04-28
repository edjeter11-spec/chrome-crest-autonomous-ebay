"""Affiliate click-out tracking — logs outbound eBay clicks for EPN attribution analytics."""
import os
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db, ClickEvent

router = APIRouter(prefix="/api/clicks", tags=["clicks"])
log = logging.getLogger("clicks")

_SALT = os.getenv("CLICK_IP_SALT", "chrome-crest-click-salt")


class ClickBody(BaseModel):
    auction_id: Optional[int] = None
    card_id: Optional[int] = None
    url: str


def _hash_ip(ip: Optional[str]) -> Optional[str]:
    """Hash the first 3 octets of an IPv4 (or first 4 hextets of IPv6) with a salt.
    Truncating before hashing keeps the record non-PII while still useful for coarse dedup."""
    if not ip:
        return None
    try:
        # Strip any proxy port suffix
        ip = ip.split(",")[0].strip()
        if ":" in ip and ip.count(":") >= 2:
            # IPv6 — keep first 4 hextets
            parts = ip.split(":")
            prefix = ":".join(parts[:4])
        else:
            # IPv4 — keep first 3 octets
            parts = ip.split(".")
            if len(parts) < 3:
                prefix = ip
            else:
                prefix = ".".join(parts[:3])
        digest = hashlib.sha256((prefix + _SALT).encode("utf-8")).hexdigest()
        return digest[:32]
    except Exception:
        return None


def _client_ip(request: Request) -> Optional[str]:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else None


def _require_admin(x_admin_token: Optional[str] = Header(None)):
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected or x_admin_token != expected:
        raise HTTPException(status_code=401, detail="admin only")


@router.get("/stats")
def click_stats(db: Session = Depends(get_db), _admin=Depends(_require_admin)):
    """Admin-only affiliate click summary. Counts + by-day for the last 30 days
    + top auctions by click volume + unique IP hashes (rough audience size)."""
    now = datetime.utcnow()
    cutoff_30 = now - timedelta(days=30)
    cutoff_7 = now - timedelta(days=7)
    cutoff_24h = now - timedelta(hours=24)

    total_all = db.query(func.count(ClickEvent.id)).scalar() or 0
    total_30d = db.query(func.count(ClickEvent.id)).filter(ClickEvent.clicked_at >= cutoff_30).scalar() or 0
    total_7d = db.query(func.count(ClickEvent.id)).filter(ClickEvent.clicked_at >= cutoff_7).scalar() or 0
    total_24h = db.query(func.count(ClickEvent.id)).filter(ClickEvent.clicked_at >= cutoff_24h).scalar() or 0
    unique_ip_30d = db.query(func.count(func.distinct(ClickEvent.ip_hash))).filter(
        ClickEvent.clicked_at >= cutoff_30,
        ClickEvent.ip_hash.isnot(None),
    ).scalar() or 0

    # Per-day for last 30 days
    by_day_rows = db.query(
        func.date(ClickEvent.clicked_at).label("day"),
        func.count(ClickEvent.id).label("n"),
    ).filter(ClickEvent.clicked_at >= cutoff_30).group_by("day").order_by("day").all()
    by_day = [{"day": str(r.day), "clicks": r.n} for r in by_day_rows]

    # Top 10 auctions clicked in last 30 days
    top_rows = db.query(
        ClickEvent.auction_id,
        func.count(ClickEvent.id).label("clicks"),
    ).filter(
        ClickEvent.clicked_at >= cutoff_30,
        ClickEvent.auction_id.isnot(None),
    ).group_by(ClickEvent.auction_id).order_by(func.count(ClickEvent.id).desc()).limit(10).all()
    top_auctions = [{"auction_id": r.auction_id, "clicks": r.clicks} for r in top_rows]

    return {
        "ok": True,
        "totals": {
            "all_time": total_all,
            "last_30d": total_30d,
            "last_7d": total_7d,
            "last_24h": total_24h,
            "unique_visitors_30d": unique_ip_30d,
        },
        "daily": by_day,
        "top_auctions_30d": top_auctions,
        "as_of": now.isoformat(),
    }


@router.post("", status_code=204)
@router.post("/", status_code=204)
async def log_click(
    body: ClickBody,
    request: Request,
    db: Session = Depends(get_db),
):
    """Log an outbound affiliate click. Returns 204 No Content."""
    try:
        ua = (request.headers.get("user-agent") or "")[:300]
        ip_hash = _hash_ip(_client_ip(request))
        db.add(ClickEvent(
            auction_id=body.auction_id,
            card_id=body.card_id,
            url=body.url[:2000] if body.url else "",
            user_agent=ua,
            ip_hash=ip_hash,
        ))
        db.commit()
    except Exception as e:
        # Don't break user navigation on logging failure
        log.warning(f"click log failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    return Response(status_code=204)
