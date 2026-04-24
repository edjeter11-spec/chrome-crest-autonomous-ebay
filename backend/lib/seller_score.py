"""Compute a per-seller trust score from historical listings."""
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from database import Auction

def compute_seller_score(db: Session, seller: str) -> dict:
    """Returns {tier, score, listings_count, reputation_label, flags}"""
    if not seller:
        return {"tier": "unknown", "score": 0, "listings_count": 0, "reputation_label": "—", "flags": []}

    # Total active + ended listings from this seller
    listings = db.query(Auction).filter(Auction.seller == seller).all()
    n = len(listings)
    if n == 0:
        return {"tier": "unknown", "score": 0, "listings_count": 0, "reputation_label": "no data", "flags": []}

    # Average feedback (eBay reported)
    feedbacks = [a.seller_feedback for a in listings if a.seller_feedback is not None]
    avg_fb = sum(feedbacks) / len(feedbacks) if feedbacks else 0

    flags = []
    if n >= 50: flags.append("prolific")
    if avg_fb >= 1000: flags.append("trusted_ebay")
    if avg_fb < 50: flags.append("new_seller")

    # Score: weighted combo
    score = min(100, int(avg_fb / 100 + n * 0.5))

    if score >= 80: tier, label = "platinum", "Platinum Seller"
    elif score >= 60: tier, label = "gold", "Trusted"
    elif score >= 40: tier, label = "silver", "OK"
    elif "new_seller" in flags: tier, label = "new", "New Seller — caution"
    else: tier, label = "bronze", "Limited history"

    return {
        "tier": tier,
        "score": score,
        "listings_count": n,
        "avg_feedback": avg_fb,
        "reputation_label": label,
        "flags": flags,
    }
