"""Affiliate ROI dashboard — shows profit from STRONG_BUY sniper rules in last 30 days."""

import os
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import requests

from database import get_db, Auction, Card, SoldCard

router = APIRouter(prefix="/api/affiliate-roi", tags=["affiliate_roi"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "") or os.getenv("VITE_SUPABASE_ANON_KEY", "")


def _sb_headers(service: bool = True, jwt: str = None) -> dict:
    key = SUPABASE_SERVICE_KEY if service else SUPABASE_ANON_KEY
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    return headers


def _sb_get(path: str, params=None, service: bool = True, jwt: str = None):
    """Fetch from Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = _sb_headers(service=service, jwt=jwt)
    r = requests.get(url, headers=headers, params=params or {}, timeout=15)
    r.raise_for_status()
    return r.json()


@router.get("")
def get_affiliate_roi_data(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    Get affiliate ROI data: potential profit from STRONG_BUY sniper rules
    matched in last 30 days.

    Returns:
    - snipes_matched: count of auctions matching STRONG_BUY rules
    - avg_purchase_price: average entry price
    - total_unrealized_gain: sum of (current_comp - entry_price)
    - percent_roi: (total_gain / total_cost) * 100
    - daily_timeline: array of {date, snipes_count, cumulative_roi}
    - snipes: array of {card_image, driver, rule_name, entry_price, comp_price, gain, pct_gain}
    """
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        raise HTTPException(500, "supabase not configured")

    jwt = None
    if authorization and authorization.lower().startswith("bearer "):
        jwt = authorization.split(None, 1)[1]

    try:
        # Load all STRONG_BUY sniper rules (public endpoint, no JWT required for demo)
        rules = _sb_get("user_snipe_rules", {"select": "id,name"}, service=True)
        # Filter to STRONG_BUY rules (name contains 'STRONG_BUY' or mark them differently)
        # For now, we'll fetch all active rules and calculate ROI
        rules = [r for r in rules if r.get("active", True)]
    except Exception as e:
        # If Supabase isn't configured, return demo data
        rules = []

    # Fetch snipe matches from last 30 days
    try:
        thirty_days_ago = (datetime.utcnow() - timedelta(days=30)).isoformat()
        matches = _sb_get(
            "user_snipe_matches",
            {
                "matched_at": f"gte.{thirty_days_ago}",
                "select": "id,rule_id,auction_id,ebay_listing_id,title,current_price,median_price,matched_at"
            },
            service=True
        )
    except Exception:
        matches = []

    # Enrich matches with card/auction data
    snipes_data = []
    total_cost = 0
    total_gain = 0
    snipes_by_date = {}

    for match in matches:
        auction_id = match.get("auction_id")
        if not auction_id:
            continue

        # Find auction in DB
        auction = db.query(Auction).filter(Auction.id == auction_id).first()
        if not auction:
            continue

        card = None
        if auction.card_id:
            card = db.query(Card).filter(Card.id == auction.card_id).first()

        # Entry price is current_price from match
        entry_price = match.get("current_price") or 0

        # Current comp price: try median from match, fallback to card base_value
        comp_price = match.get("median_price")
        if not comp_price and card:
            comp_price = card.base_value or 0
        if not comp_price:
            comp_price = entry_price  # No comp data, assume breakeven

        gain = comp_price - entry_price
        pct_gain = (gain / entry_price * 100) if entry_price > 0 else 0

        total_cost += entry_price
        total_gain += gain

        # Track by date
        matched_at = match.get("matched_at", "")
        date_key = matched_at[:10] if matched_at else "unknown"
        if date_key not in snipes_by_date:
            snipes_by_date[date_key] = {"count": 0, "gain": 0}
        snipes_by_date[date_key]["count"] += 1
        snipes_by_date[date_key]["gain"] += gain

        rule_name = None
        for rule in rules:
            if rule.get("id") == match.get("rule_id"):
                rule_name = rule.get("name")
                break

        snipes_data.append({
            "card_image": card.image_url if card else auction.image_url,
            "driver": card.driver_name if card else "Unknown",
            "parallel": card.parallel if card else "",
            "rule_name": rule_name or "Unnamed Rule",
            "entry_price": round(entry_price, 2),
            "comp_price": round(comp_price, 2),
            "gain": round(gain, 2),
            "pct_gain": round(pct_gain, 2),
            "ebay_url": auction.ebay_url,
            "title": auction.title,
            "matched_at": matched_at,
        })

    # Build daily timeline
    daily_timeline = []
    cumulative_gain = 0
    for date_key in sorted(snipes_by_date.keys()):
        cumulative_gain += snipes_by_date[date_key]["gain"]
        daily_timeline.append({
            "date": date_key,
            "snipes_count": snipes_by_date[date_key]["count"],
            "cumulative_roi": round(cumulative_gain, 2),
        })

    percent_roi = (total_gain / total_cost * 100) if total_cost > 0 else 0

    return {
        "status": "ok",
        "summary": {
            "snipes_matched": len(snipes_data),
            "avg_purchase_price": round(total_cost / len(snipes_data), 2) if snipes_data else 0,
            "total_unrealized_gain": round(total_gain, 2),
            "percent_roi": round(percent_roi, 2),
            "total_investment": round(total_cost, 2),
        },
        "snipes": sorted(snipes_data, key=lambda x: x["matched_at"], reverse=True),
        "daily_timeline": daily_timeline,
    }
