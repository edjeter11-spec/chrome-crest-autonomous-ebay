"""
Weekly email digest — top movers in user's watchlist sent every Monday 9am UTC.
Queries watched cards, filters to ones with price change in last 7 days, ranks by % change.
Sends personalized HTML email per user via Resend API.

Auth: CRON_SECRET bearer (Vercel cron) or X-Admin-Token (same as cleanup.py pattern).
"""
import os
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc

from database import get_db, Wishlist, Card, Auction, SoldCard
from lib.auth import require_cron_or_admin
import httpx

router = APIRouter(prefix="/api/email", tags=["email"])

RESEND_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("DIGEST_FROM_EMAIL", "F1 Card Vault <digest@f1cardhub.com>")
EBAY_CAMPID = os.getenv("EBAY_CAMPID", "")
EBAY_CUSTOMID = os.getenv("EBAY_CUSTOMID", "f1cardhub")
EBAY_ROTATOR = "711-53200-19255-0"


def _ebay_affiliate_url(url: str) -> str:
    """Add eBay affiliate params to URL."""
    if not url or not EBAY_CAMPID:
        return url or ""
    try:
        p = urlparse(url)
        if "ebay." not in (p.hostname or ""):
            return url
        q = dict(parse_qsl(p.query))
        q.update({
            "mkcid": "1",
            "mkrid": EBAY_ROTATOR,
            "siteid": "0",
            "campid": EBAY_CAMPID,
            "customid": EBAY_CUSTOMID,
            "toolid": "10001",
            "mkevt": "1",
        })
        return urlunparse(p._replace(query=urlencode(q)))
    except Exception:
        return url


def _get_price_change(card_id: int, db: Session) -> Optional[dict]:
    """
    Calculate price change for a card over last 7 days.
    Returns {current_price, old_price, pct_change, source_type} or None.

    Prioritizes active auctions, falls back to recent sold_cards.
    """
    week_ago = datetime.utcnow() - timedelta(days=7)

    # Get current price from active auctions
    current_auction = db.query(Auction).filter(
        and_(
            Auction.card_id == card_id,
            Auction.status == "active",
        )
    ).order_by(desc(Auction.created_at)).first()

    if current_auction:
        current_price = current_auction.current_price + (current_auction.shipping_cost or 0)
        current_time = current_auction.last_updated or datetime.utcnow()
    else:
        # Fall back to most recent sold card
        recent_sale = db.query(SoldCard).filter(
            SoldCard.driver_name == db.query(Card).filter(Card.id == card_id).first().driver_name if db.query(Card).filter(Card.id == card_id).first() else None
        ).order_by(desc(SoldCard.sale_date)).first()

        if not recent_sale:
            return None

        current_price = recent_sale.sale_price + (recent_sale.shipping_cost or 0)
        current_time = recent_sale.sale_date

    # Get price from 7 days ago
    old_auctions = db.query(Auction).filter(
        and_(
            Auction.card_id == card_id,
            Auction.status == "active",
            Auction.created_at <= week_ago,
        )
    ).order_by(desc(Auction.created_at)).first()

    if old_auctions:
        old_price = old_auctions.current_price + (old_auctions.shipping_cost or 0)
    else:
        # No active auction from 7 days ago, use most recent sold
        old_sales = db.query(SoldCard).filter(
            SoldCard.sale_date <= week_ago
        ).order_by(desc(SoldCard.sale_date)).first()

        if not old_sales:
            return None
        old_price = old_sales.sale_price + (old_sales.shipping_cost or 0)

    if old_price == 0:
        return None

    pct_change = ((current_price - old_price) / old_price) * 100

    return {
        "current_price": current_price,
        "old_price": old_price,
        "pct_change": pct_change,
        "source_type": "auction" if current_auction else "sale"
    }


def _build_user_digest_html(user_id: str, top_movers: list[dict]) -> str:
    """Render HTML email template for user's top movers."""
    if not top_movers:
        return (
            "<div style='font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;'>"
            "<h2 style='color:#111;margin-bottom:4px;'>F1 Card Vault — Weekly Watchlist Update</h2>"
            "<p style='color:#666;margin-top:0;'>No price changes detected on your watchlist this week.</p>"
            "</div>"
        )

    # Build card rows
    rows = []
    for i, mover in enumerate(top_movers, 1):
        card = mover.get("card", {})
        change = mover.get("pct_change", 0)
        direction = "↑" if change > 0 else "↓" if change < 0 else "→"
        color = "#10b981" if change < 0 else "#ef4444" if change > 0 else "#999"  # green for drops, red for increases

        driver = card.get("driver_name", "—")
        parallel = card.get("parallel") or ""
        current_price = mover.get("current_price", 0)
        old_price = mover.get("old_price", 0)
        link = mover.get("ebay_url", "#")

        rows.append(
            f"<tr>"
            f"<td style='padding:12px 8px;border-bottom:1px solid #eee;'>"
            f"<strong>{driver}</strong>"
            f"<br><small style='color:#666;'>{parallel if parallel else 'Base'}</small>"
            f"</td>"
            f"<td style='padding:12px 8px;border-bottom:1px solid #eee;text-align:right;'>"
            f"${current_price:.0f}"
            f"<br><small style='color:#999;'>${old_price:.0f}</small>"
            f"</td>"
            f"<td style='padding:12px 8px;border-bottom:1px solid #eee;text-align:right;color:{color};font-weight:bold;'>"
            f"{direction} {abs(change):.1f}%"
            f"</td>"
            f"<td style='padding:12px 8px;border-bottom:1px solid #eee;text-align:right;'>"
            f"<a href='{link}' style='color:#dc2626;font-weight:bold;text-decoration:none;'>View</a>"
            f"</td>"
            f"</tr>"
        )

    return (
        "<div style='font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;'>"
        "<h2 style='color:#111;margin-bottom:4px;'>F1 Card Vault — Weekly Watchlist Update</h2>"
        "<p style='color:#666;margin-top:0;'>Your top card price movements this week, ranked by change.</p>"
        "<table style='width:100%;border-collapse:collapse;font-size:14px;'>"
        "<thead><tr style='text-align:left;color:#555;background:#f9fafb;'>"
        "<th style='padding:8px;'>Card</th>"
        "<th style='padding:8px;text-align:right;'>Now / Week Ago</th>"
        "<th style='padding:8px;text-align:right;'>Change</th>"
        "<th style='padding:8px;'></th>"
        "</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
        "<p style='color:#999;font-size:11px;margin-top:24px;'>"
        "As an eBay Partner, F1 Card Vault may be compensated when you make a qualifying purchase. "
        "Prices are informational, not investment advice."
        "</p>"
        "</div>"
    )


async def _send_email(to: str, subject: str, html: str) -> dict:
    """Low-level Resend send — returns {sent, status} or {sent: False, reason}."""
    if not RESEND_KEY:
        return {"sent": False, "reason": "no_resend_key"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_KEY}"},
                json={"from": FROM_EMAIL, "to": to, "subject": subject, "html": html},
            )
            return {
                "sent": r.status_code < 300,
                "status": r.status_code,
            }
    except Exception as e:
        return {"sent": False, "reason": "request_failed", "error": str(e)[:100]}


# GET + POST — Vercel cron sends GET. POST-only meant Monday digests
# never sent (request fell through to SPA index.html).
@router.api_route("/digest", methods=["GET", "POST"])
async def send_weekly_digest(request: Request, db: Session = Depends(get_db)):
    """
    Cron endpoint: Sent Monday 9am UTC. Iterates all users with watchlists,
    calculates top 5 movers, sends personalized emails.
    """
    require_cron_or_admin(request)

    week_ago = datetime.utcnow() - timedelta(days=7)

    # Get all unique user_ids with wishlist items
    users = db.query(Wishlist.user_id).distinct().filter(
        Wishlist.user_id.isnot(None)
    ).all()

    if not users:
        return {"status": "no_users", "count": 0}

    sent_count = 0
    failed_count = 0
    results = []

    for (user_id,) in users:
        # Get user's watchlist cards with price changes
        watchlist_items = db.query(Wishlist).filter(
            Wishlist.user_id == user_id
        ).all()

        if not watchlist_items:
            continue

        movers = []
        for item in watchlist_items:
            card = db.query(Card).filter(Card.id == item.card_id).first()
            if not card:
                continue

            # Get latest active auction for this card
            latest_auction = db.query(Auction).filter(
                and_(
                    Auction.card_id == card.id,
                    Auction.status == "active",
                )
            ).order_by(desc(Auction.created_at)).first()

            if not latest_auction:
                continue

            current_price = latest_auction.current_price + (latest_auction.shipping_cost or 0)

            # Get price from 7 days ago
            old_auction = db.query(Auction).filter(
                and_(
                    Auction.card_id == card.id,
                    Auction.last_updated <= week_ago,
                )
            ).order_by(desc(Auction.last_updated)).first()

            if not old_auction:
                continue

            old_price = old_auction.current_price + (old_auction.shipping_cost or 0)
            if old_price == 0:
                continue

            pct_change = ((current_price - old_price) / old_price) * 100

            movers.append({
                "card": {
                    "driver_name": card.driver_name,
                    "parallel": card.parallel,
                    "image_url": card.image_url,
                },
                "current_price": current_price,
                "old_price": old_price,
                "pct_change": pct_change,
                "ebay_url": _ebay_affiliate_url(latest_auction.ebay_url or ""),
            })

        if not movers:
            continue

        # Sort by absolute % change, get top 5
        movers.sort(key=lambda x: abs(x.get("pct_change", 0)), reverse=True)
        top_movers = movers[:5]

        # Build and send email
        html = _build_user_digest_html(user_id, top_movers)
        subject = f"F1 Card Vault — Weekly Watchlist Update ({len(top_movers)} movers)"

        result = await _send_email(user_id, subject, html)

        if result.get("sent"):
            sent_count += 1
            results.append({"user_id": user_id, "movers": len(top_movers), "status": "sent"})
        else:
            failed_count += 1
            results.append({"user_id": user_id, "status": "failed", "reason": result.get("reason")})

    return {
        "status": "completed",
        "sent": sent_count,
        "failed": failed_count,
        "total_users": len(users),
        "details": results,
    }
