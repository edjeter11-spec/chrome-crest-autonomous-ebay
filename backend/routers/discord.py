"""Discord bot scaffold. Returns Discord-embed JSON for a price query
so a lightweight discord.py bot can relay market data into a server."""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta

from database import get_db, SoldCard

router = APIRouter(prefix="/api/discord", tags=["discord"])


def _verdict(median: float) -> tuple[str, int]:
    # Just a colored label — ratio against median would need cost, which we don't have here
    return "Median reference", 0x6366F1  # indigo


@router.get("/price")
def discord_price(
    driver: str = Query(..., description="Driver name, e.g. 'Lando Norris'"),
    parallel: str | None = Query(None),
    grade: str | None = Query(None),
    days: int = Query(90),
    db: Session = Depends(get_db),
):
    """Returns a Discord webhook-compatible embed payload."""
    since = datetime.utcnow() - timedelta(days=days)
    q = db.query(SoldCard).filter(
        SoldCard.driver_name == driver,
        SoldCard.sale_price > 0,
        SoldCard.sale_date >= since,
    )
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if grade and grade.lower() != "raw":
        q = q.filter(SoldCard.grade.ilike(f"{grade}%"))

    rows = q.order_by(SoldCard.sale_date.desc()).limit(100).all()
    if not rows:
        return {
            "content": None,
            "embeds": [{
                "title": f"{driver}{' · ' + parallel if parallel else ''}",
                "description": "No sold comps found in the last "
                               f"{days} days for this combination.",
                "color": 0x6B7280,
                "footer": {"text": "F1 Card Hub · Discord bot"},
            }],
        }

    prices = sorted([(r.sale_price or 0) + (r.shipping_cost or 0) for r in rows])
    median = prices[len(prices) // 2]
    avg = sum(prices) / len(prices)
    lo = prices[0]
    hi = prices[-1]
    last = rows[0]
    last_date = last.sale_date.strftime("%b %d") if last.sale_date else "—"

    label, color = _verdict(median)
    title = driver
    if parallel:
        title += f" · {parallel}"
    if grade and grade.lower() != "raw":
        title += f" · {grade}"

    return {
        "content": None,
        "embeds": [{
            "title": title,
            "description": f"**Last {days}d · {len(rows)} sold comps**",
            "color": color,
            "fields": [
                {"name": "Median", "value": f"${median:.2f}", "inline": True},
                {"name": "Average", "value": f"${avg:.2f}", "inline": True},
                {"name": "Range", "value": f"${lo:.0f} – ${hi:.0f}", "inline": True},
                {"name": "Last sale", "value": f"${(last.sale_price or 0):.2f} · {last_date}", "inline": False},
            ],
            "thumbnail": {"url": last.image_url} if last.image_url else None,
            "footer": {"text": f"F1 Card Hub · {label}"},
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }],
    }
