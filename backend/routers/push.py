"""Web Push notifications — VAPID-signed to subscribed browsers."""
import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db, PushSubscription

router = APIRouter(prefix="/api/push", tags=["push"])
log = logging.getLogger("push")


@router.get("/vapid-public-key")
def get_vapid_public_key():
    return {"public_key": os.getenv("VAPID_PUBLIC_KEY", "")}


@router.post("/subscribe")
async def subscribe(request: Request, db: Session = Depends(get_db)):
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
    else:
        db.add(PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth, user_agent=ua))
    db.commit()
    return {"ok": True}


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
def send_test(db: Session = Depends(get_db)):
    """Fire a test notification to every subscriber."""
    sent = send_push_to_all(db, title="Chrome Crest test", body="Push notifications are working!", url="/")
    return {"sent": sent}


def send_push_to_all(db: Session, title: str, body: str, url: str = "/", tag: str = "snipe") -> int:
    """Fan out a web push to every subscribed browser. Returns count of successful sends."""
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
    dead: list = []
    subs = db.query(PushSubscription).all()
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
            )
            sent += 1
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", 0)
            if status in (404, 410):
                dead.append(s.id)
            else:
                log.warning(f"push send failed: {e}")
        except Exception as e:
            log.warning(f"push send error: {e}")

    # Reap dead subscriptions
    if dead:
        db.query(PushSubscription).filter(PushSubscription.id.in_(dead)).delete(synchronize_session=False)
        db.commit()
    return sent
