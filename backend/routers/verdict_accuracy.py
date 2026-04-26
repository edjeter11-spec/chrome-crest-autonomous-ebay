"""
Verdict Accuracy Feedback — track how user-reviewed verdicts actually performed.
Enables closed-loop feedback: "Was this a win?" buttons on sold cards.
"""
import json
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from typing import Optional

from database import get_db, VerdictFeedback, SoldCard, SystemState

router = APIRouter(prefix="/api/verdicts", tags=["verdicts"])

# Separate router so we can expose /api/verdict/scoreboard (singular) for the
# public-facing scoreboard widget without clashing with the /api/verdicts prefix.
public_router = APIRouter(prefix="/api/verdict", tags=["verdicts"])


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


# ---------------------------------------------------------------------------
# Public scoreboard — "X% of our STRONG_BUYs profited"
# ---------------------------------------------------------------------------
SCOREBOARD_CACHE_KEY = "verdict_scoreboard_cache"
SCOREBOARD_CACHE_TTL_HOURS = 24
SCOREBOARD_WINDOW_DAYS = 90


def _compute_scoreboard(db: Session, window_days: int = SCOREBOARD_WINDOW_DAYS) -> dict:
    """
    Methodology (proxy — we don't store historical verdict snapshots):

    For each sold_card in the last `window_days`, treat its sale as the
    "verdict-eligible" anchor price. We then check the median sold price for
    the same (driver, parallel, grade) combo within `window_days` *after*
    the anchor sale. If that forward median > anchor price, the verdict
    "wins" (would have been profitable).

    Verdict bucketing is derived from the anchor sale's discount vs. that
    forward median:
        STRONG_BUY  -> anchor priced >=25% below forward median
        GOOD_BUY    -> anchor priced 10-25% below forward median
        (other tiers ignored for the scoreboard)

    A verdict "wins" if forward_median > anchor_price (profit > 0%).

    This is a defensible proxy until we backfill a verdict_history table.
    """
    cutoff = datetime.utcnow() - timedelta(days=window_days)

    # Pull every sold card in window with the fields we need.
    rows = (
        db.query(
            SoldCard.id,
            SoldCard.driver_name,
            SoldCard.parallel,
            SoldCard.grade,
            SoldCard.sale_price,
            SoldCard.sale_date,
        )
        .filter(
            SoldCard.sale_date >= cutoff,
            SoldCard.sale_price > 0,
            SoldCard.is_duplicate == False,  # noqa: E712
        )
        .all()
    )

    # Group sales by (driver, parallel, grade) for forward-median lookups.
    groups: dict = {}
    for r in rows:
        key = (r.driver_name or "", r.parallel or "", r.grade or "")
        groups.setdefault(key, []).append((r.sale_date, float(r.sale_price)))

    # Sort each group's sales by date for cheap windowed lookups.
    for key in groups:
        groups[key].sort(key=lambda x: x[0])

    def _forward_median(key, anchor_date, anchor_price) -> Optional[float]:
        sales = groups.get(key, [])
        window_end = anchor_date + timedelta(days=window_days)
        forward = [
            p for (d, p) in sales
            if d > anchor_date and d <= window_end and p > 0
        ]
        if len(forward) < 2:  # need at least 2 forward comps to be meaningful
            return None
        forward.sort()
        n = len(forward)
        return forward[n // 2] if n % 2 else (forward[n // 2 - 1] + forward[n // 2]) / 2

    buckets = {
        "STRONG_BUY": {"wins": 0, "total": 0, "profit_pcts": []},
        "GOOD_BUY":   {"wins": 0, "total": 0, "profit_pcts": []},
    }
    total_tracked = 0

    for r in rows:
        key = (r.driver_name or "", r.parallel or "", r.grade or "")
        anchor = float(r.sale_price)
        fwd = _forward_median(key, r.sale_date, anchor)
        if fwd is None or fwd <= 0:
            continue
        discount = (fwd - anchor) / fwd  # positive = anchor cheaper than forward
        if discount >= 0.25:
            verdict = "STRONG_BUY"
        elif discount >= 0.10:
            verdict = "GOOD_BUY"
        else:
            continue
        profit_pct = (fwd - anchor) / anchor * 100.0
        buckets[verdict]["total"] += 1
        if profit_pct > 0:
            buckets[verdict]["wins"] += 1
            buckets[verdict]["profit_pcts"].append(profit_pct)
        total_tracked += 1

    def _summarize(b):
        total = b["total"]
        wins = b["wins"]
        win_rate = round(wins / total, 4) if total > 0 else None
        avg_profit = (
            round(sum(b["profit_pcts"]) / len(b["profit_pcts"]), 1)
            if b["profit_pcts"] else None
        )
        return {
            "win_rate": win_rate,
            "sample_size": total,
            "avg_profit_pct": avg_profit,
        }

    return {
        "strong_buy": _summarize(buckets["STRONG_BUY"]),
        "good_buy":   _summarize(buckets["GOOD_BUY"]),
        "total_tracked": total_tracked,
        "window_days": window_days,
        "last_updated": datetime.utcnow().isoformat() + "Z",
        "methodology": (
            "Proxy: a sold card 'wins' if the forward median price for the "
            "same (driver, parallel, grade) over the next "
            f"{window_days} days exceeded the anchor sale price. "
            "Verdict tier inferred from anchor's discount vs. forward median "
            "(STRONG_BUY >=25% below, GOOD_BUY 10-25% below)."
        ),
    }


@public_router.get("/scoreboard")
def verdict_scoreboard(db: Session = Depends(get_db)):
    """
    Public verdict accuracy scoreboard. Cached in system_state (24h TTL)
    because the underlying scan is moderately expensive.
    """
    # Try cache first
    try:
        row = db.query(SystemState).filter(
            SystemState.key == SCOREBOARD_CACHE_KEY
        ).first()
        if row and row.value:
            payload = json.loads(row.value)
            cached_at = payload.get("_cached_at")
            if cached_at:
                age = datetime.utcnow() - datetime.fromisoformat(cached_at)
                if age < timedelta(hours=SCOREBOARD_CACHE_TTL_HOURS):
                    payload.pop("_cached_at", None)
                    return payload
    except Exception:
        pass  # cache miss — fall through to recompute

    result = _compute_scoreboard(db, window_days=SCOREBOARD_WINDOW_DAYS)

    # Persist to cache (best-effort)
    try:
        cached = dict(result)
        cached["_cached_at"] = datetime.utcnow().isoformat()
        row = db.query(SystemState).filter(
            SystemState.key == SCOREBOARD_CACHE_KEY
        ).first()
        if row:
            row.value = json.dumps(cached)
            row.updated_at = datetime.utcnow()
        else:
            db.add(SystemState(key=SCOREBOARD_CACHE_KEY, value=json.dumps(cached)))
        db.commit()
    except Exception:
        db.rollback()

    return result
