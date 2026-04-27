"""User feedback widget — accepts anonymous suggestions/bug reports from the
floating widget on the live site. Eddie reviews via /api/feedback/list (admin).
"""
import hashlib
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import UserFeedback, get_db

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


class FeedbackIn(BaseModel):
    message: str = Field(..., min_length=2, max_length=2000)
    page_url: Optional[str] = Field(None, max_length=500)
    email: Optional[str] = Field(None, max_length=200)


def _hash_ip(ip: Optional[str]) -> Optional[str]:
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def _require_admin(x_admin_token: Optional[str] = Header(None)):
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected or x_admin_token != expected:
        raise HTTPException(status_code=401, detail="admin only")


@router.post("")
def submit_feedback(payload: FeedbackIn, request: Request, db: Session = Depends(get_db)):
    """Anonymous-friendly. Trims, hashes IP, stores."""
    msg = payload.message.strip()
    if len(msg) < 2:
        raise HTTPException(status_code=400, detail="message too short")
    ua = request.headers.get("user-agent", "")[:400]
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    ip = ip.split(",")[0].strip() if ip else ""
    row = UserFeedback(
        message=msg[:2000],
        page_url=(payload.page_url or "")[:500] or None,
        user_agent=ua or None,
        user_email=(payload.email or "")[:200] or None,
        ip_hash=_hash_ip(ip),
        resolved=False,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@router.get("/list")
def list_feedback(
    db: Session = Depends(get_db),
    _admin=Depends(_require_admin),
    limit: int = 100,
    only_open: bool = True,
):
    """Admin-only. Newest first."""
    q = db.query(UserFeedback)
    if only_open:
        q = q.filter(UserFeedback.resolved == False)  # noqa: E712
    rows = q.order_by(UserFeedback.created_at.desc()).limit(min(limit, 500)).all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "message": r.message,
                "page_url": r.page_url,
                "user_email": r.user_email,
                "ip_hash": r.ip_hash,
                "user_agent": r.user_agent,
                "resolved": r.resolved,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.post("/{feedback_id}/resolve")
def resolve_feedback(feedback_id: int, db: Session = Depends(get_db), _admin=Depends(_require_admin)):
    row = db.query(UserFeedback).filter(UserFeedback.id == feedback_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row.resolved = True
    db.commit()
    return {"ok": True, "id": row.id, "resolved": True}
