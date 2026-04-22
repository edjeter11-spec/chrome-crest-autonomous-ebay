"""
Verdict Accuracy Feedback — track how user-reviewed verdicts actually performed.
Enables closed-loop feedback: "Was this a win?" buttons on sold cards.
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime
from typing import Optional

from database import get_db, VerdictFeedback, SoldCard

router = APIRouter(prefix="/api/verdicts", tags=["verdicts"])


@router.post("/feedback")
def submit_verdict_feedback(
    sold_card_id: int,
    verdict_key: str,
    feedback: str = Query(..., regex="^(up|down|neutral)$"),
    actual_sale_price: Optional[float] = None,
    notes: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Record user feedback on a verdict's accuracy.
    - feedback: 'up' (verdict was right/underpriced), 'down' (verdict was wrong/overpriced), 'neutral'
    - actual_sale_price: optional — user's actual final price if different from listed
    - notes: optional user context
    """
    # Verify the sold card exists
    card = db.query(SoldCard).filter(SoldCard.id == sold_card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Sold card not found")

    # Check for existing feedback on this card
    existing = db.query(VerdictFeedback).filter(
        VerdictFeedback.sold_card_id == sold_card_id
    ).first()

    if existing:
        # Update
        existing.verdict_key = verdict_key
        existing.feedback = feedback
        existing.actual_sale_price = actual_sale_price
        existing.notes = notes
        existing.updated_at = datetime.utcnow()
    else:
        # Create
        existing = VerdictFeedback(
            sold_card_id=sold_card_id,
            ebay_item_id=card.ebay_item_id,
            verdict_key=verdict_key,
            feedback=feedback,
            actual_sale_price=actual_sale_price,
            notes=notes,
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return {
        "id": existing.id,
        "sold_card_id": existing.sold_card_id,
        "verdict_key": existing.verdict_key,
        "feedback": existing.feedback,
        "created_at": existing.created_at.isoformat(),
        "updated_at": existing.updated_at.isoformat(),
    }


@router.get("/feedback/{sold_card_id}")
def get_verdict_feedback(sold_card_id: int, db: Session = Depends(get_db)):
    """Get feedback for a specific sold card (if any)."""
    feedback = db.query(VerdictFeedback).filter(
        VerdictFeedback.sold_card_id == sold_card_id
    ).first()

    if not feedback:
        return {"feedback": None}

    return {
        "feedback": {
            "id": feedback.id,
            "verdict_key": feedback.verdict_key,
            "feedback_type": feedback.feedback,
            "actual_sale_price": feedback.actual_sale_price,
            "notes": feedback.notes,
            "created_at": feedback.created_at.isoformat(),
            "updated_at": feedback.updated_at.isoformat(),
        }
    }


@router.get("/accuracy")
def verdict_accuracy_stats(
    verdict_key: Optional[str] = None,
    days: int = 90,
    db: Session = Depends(get_db),
):
    """
    Aggregate accuracy stats: % of STRONG_BUY/GOOD_BUY verdicts that got 'up' feedback.

    Returns:
    - overall: {total_verdicts, up_count, down_count, neutral_count, accuracy_pct}
    - by_verdict_key: {STRONG_BUY, GOOD_BUY, ...} with same breakdown
    """
    cutoff = datetime.utcnow()
    if days:
        from datetime import timedelta

        cutoff = cutoff - timedelta(days=days)

    # Base query: all feedbacks in timeframe
    base_q = db.query(VerdictFeedback).filter(VerdictFeedback.created_at >= cutoff)
    if verdict_key:
        base_q = base_q.filter(VerdictFeedback.verdict_key == verdict_key)

    all_feedback = base_q.all()
    if not all_feedback:
        return {
            "days": days,
            "overall": {
                "total": 0,
                "up": 0,
                "down": 0,
                "neutral": 0,
                "accuracy_pct": None,
            },
            "by_verdict_key": {},
        }

    # Overall
    up_count = sum(1 for f in all_feedback if f.feedback == "up")
    down_count = sum(1 for f in all_feedback if f.feedback == "down")
    neutral_count = sum(1 for f in all_feedback if f.feedback == "neutral")
    total = len(all_feedback)
    accuracy_pct = round((up_count / total * 100), 1) if total > 0 else None

    # By verdict key
    by_key = {}
    for f in all_feedback:
        key = f.verdict_key
        if key not in by_key:
            by_key[key] = {"up": 0, "down": 0, "neutral": 0, "total": 0}
        by_key[key][f.feedback] += 1
        by_key[key]["total"] += 1

    by_verdict_key = {}
    for key, counts in sorted(by_key.items()):
        pct = (
            round((counts["up"] / counts["total"] * 100), 1)
            if counts["total"] > 0
            else None
        )
        by_verdict_key[key] = {
            "total": counts["total"],
            "up": counts["up"],
            "down": counts["down"],
            "neutral": counts["neutral"],
            "accuracy_pct": pct,
        }

    return {
        "days": days,
        "overall": {
            "total": total,
            "up": up_count,
            "down": down_count,
            "neutral": neutral_count,
            "accuracy_pct": accuracy_pct,
        },
        "by_verdict_key": by_verdict_key,
    }


@router.get("/leaderboard")
def verdict_leaderboard(
    top_n: int = Query(10, le=50),
    min_samples: int = Query(3, ge=1),
    days: int = 90,
    db: Session = Depends(get_db),
):
    """
    Top-performing parallel+grade combos by verdict accuracy.
    Useful for "which parallels have best STRONG_BUY track record?".
    """
    cutoff = datetime.utcnow()
    from datetime import timedelta

    if days:
        cutoff = cutoff - timedelta(days=days)

    # Join feedback to sold_cards to group by parallel+grade
    rows = (
        db.query(
            SoldCard.driver_name,
            SoldCard.parallel,
            SoldCard.grade,
            func.count(VerdictFeedback.id).label("total"),
            func.sum(
                func.case(
                    (VerdictFeedback.feedback == "up", 1),
                    else_=0,
                )
            ).label("up_count"),
        )
        .join(VerdictFeedback, SoldCard.id == VerdictFeedback.sold_card_id)
        .filter(
            VerdictFeedback.created_at >= cutoff,
            VerdictFeedback.verdict_key.in_(["STRONG_BUY", "GOOD_BUY"]),
        )
        .group_by(SoldCard.driver_name, SoldCard.parallel, SoldCard.grade)
        .all()
    )

    results = []
    for driver, parallel, grade, total, up_count in rows:
        if total < min_samples:
            continue
        accuracy = round((up_count / total * 100), 1) if total > 0 else 0
        results.append(
            {
                "driver": driver,
                "parallel": parallel or "Raw",
                "grade": grade or "Ungraded",
                "total_feedback": total,
                "up_count": up_count,
                "accuracy_pct": accuracy,
            }
        )

    # Sort by accuracy descending, then by total descending
    results.sort(key=lambda r: (-r["accuracy_pct"], -r["total_feedback"]))
    return {
        "days": days,
        "min_samples": min_samples,
        "leaderboard": results[:top_n],
    }
