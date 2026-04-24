from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Alert
from typing import Optional
from lib.auth import get_user_id, require_user_id

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def alert_to_dict(a: Alert) -> dict:
    return {
        "id": a.id,
        "card_id": a.card_id,
        "alert_type": a.alert_type,
        "threshold_price": a.threshold_price,
        "triggered": a.triggered,
        "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
        "message": a.message,
        "auction_id": a.auction_id,
        "urgency": a.urgency,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "dismissed": getattr(a, "dismissed", False),
    }


@router.get("")
def list_alerts(
    triggered: Optional[bool] = None,
    urgency: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    q = db.query(Alert)
    if user_id:
        q = q.filter(Alert.user_id == user_id)
    else:
        q = q.filter(Alert.user_id.is_(None))
    if triggered is not None:
        q = q.filter(Alert.triggered == triggered)
    if urgency:
        q = q.filter(Alert.urgency == urgency)
    alerts = q.order_by(Alert.created_at.desc()).limit(limit).all()
    return {"alerts": [alert_to_dict(a) for a in alerts]}


@router.delete("/{alert_id}")
def dismiss_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    a = db.query(Alert).filter(Alert.id == alert_id).first()
    if not a:
        raise HTTPException(404, "Alert not found")
    if a.user_id and a.user_id != user_id:
        raise HTTPException(403, "forbidden")
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.delete("")
def clear_all_alerts(
    urgency: Optional[str] = None,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    q = db.query(Alert)
    if user_id:
        q = q.filter(Alert.user_id == user_id)
    else:
        q = q.filter(Alert.user_id.is_(None))
    if urgency:
        q = q.filter(Alert.urgency == urgency)
    count = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": count}
