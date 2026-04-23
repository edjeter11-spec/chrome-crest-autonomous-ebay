"""Affiliate click-out tracking — logs outbound eBay clicks for EPN attribution analytics."""
import os
import hashlib
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
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
