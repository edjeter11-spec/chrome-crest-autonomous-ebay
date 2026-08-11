"""Web Push notifications — VAPID-signed to subscribed browsers."""
import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db, PushSubscription
from lib.auth import require_admin, get_user_id

router = APIRouter(prefix="/api/push", tags=["push"])
log = logging.getLogger("push")


@router.get("/vapid-public-key")
def get_vapid_public_key():
    return {"public_key": os.getenv("VAPID_PUBLIC_KEY", "")}


@router.post("/subscribe")
async def subscribe(
    request: Request,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    body = await request.json()
    sub = body.get("subscription") or body
    endpoint = sub.get("endpoint")
    keys = sub.get("keys") or {}
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")
    if not (endpoint and p256dh and auth):
        raise HTTPException(400, "Missing subscription fields")

    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).first()
    ua = request.headers.get("user-agent", "")[:300]
    if existing:
        existing.p256dh = p256dh
        existing.auth = auth
        existing.user_agent = ua
        # Only claim, never un-claim: an anonymous re-subscribe from the same
        # browser must not strip ownership from a previously signed-in device.
        if user_id:
            existing.user_id = user_id
    else:
        db.add(PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth,
                                user_agent=ua, user_id=user_id))
    db.commit()
    return {"ok": True, "linked_user": bool(user_id)}


@router.post("/unsubscribe")
async def unsubscribe(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    endpoint = body.get("endpoint") or (body.get("subscription") or {}).get("endpoint")
    if not endpoint:
        raise HTTPException(400, "Missing endpoint")
    db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).delete()
    db.commit()
    return {"ok": True}


@router.post("/test")
def send_test(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Fire a test notification to every subscriber. Admin-gated (X-Admin-Token)
    so anonymous callers can't push-spam every subscribed browser."""
    sent = send_push_to_all(db, title="Chrome Crest test", body="Push notifications are working!", url="/")
    return {"sent": sent}


def send_push_to_all(db: Session, title: str, body: str, url: str = "/", tag: str = "snipe") -> int:
    """Fan out a web push to every subscribed browser. Returns count of successful sends.
    Broadcast-only — site-wide alerts. Per-user rule matches must go through
    send_push_to_user so one user's private rule hits never reach everyone."""
    subs = db.query(PushSubscription).all()
    return _fan_out(db, subs, title, body, url, tag)


def send_push_to_user(db: Session, user_id: Optional[str], title: str, body: str,
                      url: str = "/", tag: str = "snipe") -> int:
    """Push only to devices owned by `user_id`. No user_id → no push (legacy
    unclaimed subscriptions stay silent rather than leaking to everyone)."""
    if not user_id:
        return 0
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    if not subs:
        return 0
    return _fan_out(db, subs, title, body, url, tag)


def _fan_out(db: Session, subs: list, title: str, body: str, url: str, tag: str) -> int:
    try:
        from pywebpush import webpush, WebPushException
    except Exception as e:
        log.warning(f"pywebpush unavailable: {e}")
        return 0

    priv_key = os.getenv("VAPID_PRIVATE_KEY", "")
    if not priv_key:
        log.warning("VAPID_PRIVATE_KEY not set — skipping push fan-out")
        return 0

    claims = {"sub": "mailto:edjeter11@gmail.com"}
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = 0
    failed = 0
    dead: list = []
    for s in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": s.endpoint,
                    "keys": {"p256dh": s.p256dh, "auth": s.auth},
                },
                data=payload,
                vapid_private_key=priv_key,
                vapid_claims=claims,
                ttl=300,
                # One hung push-service connection must not stall the cron
                # tail (fan-out runs inside the request handler on purpose).
                timeout=5,
            )
            sent += 1
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", 0)
            if status in (404, 410):
                dead.append(s.id)
            else:
                failed += 1
                log.warning(f"push send failed: {e}")
        except Exception as e:
            failed += 1
            log.warning(f"push send error: {e}")
    if failed:
        log.warning(f"push fan-out: {sent} sent, {failed} FAILED, {len(dead)} dead-pruned")

    # Reap dead subscriptions
    if dead:
        db.query(PushSubscription).filter(PushSubscription.id.in_(dead)).delete(synchronize_session=False)
        db.commit()
    return sent
