from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from database import get_db, Auction, Card
from datetime import datetime
from typing import Optional
import asyncio
import json

router = APIRouter(prefix="/api/auctions", tags=["auctions"])


def auction_to_dict(a: Auction) -> dict:
    now = datetime.utcnow()
    time_left = max(0, int((a.end_time - now).total_seconds())) if a.end_time else 0
    # Scarcity tier — derived from card.parallel (fallback: title-based later)
    try:
        from lib.parallels import scarcity_for, is_rookie
        parallel_label = a.card.parallel if a.card else None
        sc = scarcity_for(parallel_label)
        rookie = is_rookie(a.card.driver_name if a.card else None)
    except Exception:
        sc = {"tier": "-", "count": None, "rank": 99}
        rookie = False
    return {
        "id": a.id,
        "card_id": a.card_id,
        "ebay_listing_id": a.ebay_listing_id,
        "title": a.title,
        "current_price": a.current_price,
        "buy_now_price": a.buy_now_price,
        "bid_count": a.bid_count,
        "end_time": a.end_time.isoformat() if a.end_time else None,
        "time_left": time_left,
        "seller": a.seller,
        "seller_feedback": a.seller_feedback,
        "condition": a.condition,
        "snipe_eligible": a.snipe_eligible,
        "snipe_score": a.snipe_score,
        "status": a.status,
        "ebay_url": a.ebay_url,
        "image_url": a.image_url,
        "shipping_cost": a.shipping_cost,
        "is_real_ebay": a.is_real_ebay,
        "buying_options": json.loads(a.buying_options) if a.buying_options else [],
        "extra_images": json.loads(a.extra_images) if getattr(a, 'extra_images', None) else [],
        "scarcity_tier": sc["tier"],
        "scarcity_count": sc["count"],
        "scarcity_rank": sc["rank"],
        "is_rookie": rookie,
        "card": {
            "driver_name": a.card.driver_name,
            "parallel": a.card.parallel,
            "grade": a.card.grade,
            "team_color": a.card.team_color,
            "investment_score": a.card.investment_score,
            "image_url": a.card.image_url,
            "series": getattr(a.card, "series", "F1") or "F1",
            "is_rookie": getattr(a.card, "is_rookie", False) or False,
        } if a.card else None,
    }


@router.get("")
def list_auctions(
    status: Optional[str] = "active",
    driver: Optional[str] = None,
    snipe_only: bool = False,
    # buying: "auction" → only listings with AUCTION option, "bin" → only
    # non-auction listings. Default returns both so existing clients are
    # unaffected.
    buying: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Auction).options(joinedload(Auction.card))
    if status:
        q = q.filter(Auction.status == status)
    if driver:
        q = q.join(Card).filter(Card.driver_name.ilike(f"%{driver}%"))
    if snipe_only:
        q = q.filter(Auction.snipe_eligible == True)
    if buying == "auction":
        q = q.filter(Auction.buying_options.like('%AUCTION%'))
    elif buying == "bin":
        q = q.filter((Auction.buying_options == None) | (~Auction.buying_options.like('%AUCTION%')))
    total = q.count()
    # Sort ending-soonest first so auction listings (which expire today) always
    # appear before BIN listings (which may expire in 30+ days).
    auctions = q.order_by(Auction.end_time.asc()).offset(offset).limit(limit).all()
    return {"total": total, "auctions": [auction_to_dict(a) for a in auctions]}


@router.get("/snipe/targets")
def snipe_targets(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    from datetime import timedelta
    targets = db.query(Auction).filter(
        Auction.status == "active",
        Auction.snipe_eligible == True,
        Auction.end_time > now,
    ).order_by(Auction.snipe_score.desc()).limit(20).all()
    return {"targets": [auction_to_dict(a) for a in targets]}


@router.get("/watchlist/all")
def get_watchlist(db: Session = Depends(get_db)):
    """Return all watchlisted auctions."""
    auctions = (
        db.query(Auction)
        .filter(Auction.status == "watchlist")
        .order_by(Auction.snipe_score.desc())
        .all()
    )
    return {"auctions": [auction_to_dict(a) for a in auctions], "total": len(auctions)}


@router.get("/{auction_id}")
def get_auction(auction_id: int, db: Session = Depends(get_db)):
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        from fastapi import HTTPException
        raise HTTPException(404, "Auction not found")
    return auction_to_dict(a)


@router.post("/{auction_id}/watchlist")
def toggle_watchlist(auction_id: int, db: Session = Depends(get_db)):
    """Toggle an auction between active and watchlist status."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")
    if a.status == "watchlist":
        a.status = "active"
        watching = False
    else:
        a.status = "watchlist"
        watching = True
    db.commit()
    return {"watching": watching, "status": a.status, "id": a.id}


@router.get("/{auction_id}/details")
async def get_auction_details(auction_id: int, db: Session = Depends(get_db)):
    """Fetch full eBay item details including additional images and item specifics."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    base = auction_to_dict(a)

    # Only fetch live eBay details if we haven't already cached them on this row.
    # Saves hundreds of Browse API calls per day when users open modals for items
    # we've already enriched once.
    already_cached = bool(getattr(a, 'extra_images', None))
    ebay_details = None
    if a.is_real_ebay and a.ebay_listing_id and not already_cached:
        try:
            from ebay_api import get_item_details
            ebay_details = await get_item_details(a.ebay_listing_id)
        except Exception:
            pass

    if ebay_details:
        imgs = ebay_details.get("images", [base.get("image_url", "")])
        base["extra_images"] = imgs
        base["item_specifics"] = ebay_details.get("item_specifics", {})
        base["description"] = ebay_details.get("description", "")
        base["condition_description"] = ebay_details.get("condition_description", "")
        base["seller_feedback_pct"] = ebay_details.get("seller_feedback_pct")
        base["returns_accepted"] = ebay_details.get("returns_accepted", False)
        base["item_location"] = ebay_details.get("item_location", "US")
        base["quantity_sold"] = ebay_details.get("quantity_sold", 0)
        # Cache images back to DB so they display without re-fetching
        if imgs and not getattr(a, 'extra_images', None):
            a.extra_images = json.dumps(imgs)
            db.commit()
    else:
        # Return what we have stored
        stored_imgs = json.loads(a.extra_images) if getattr(a, 'extra_images', None) else []
        base["extra_images"] = stored_imgs if stored_imgs else ([a.image_url] if a.image_url else [])
        base["item_specifics"] = {}
        base["description"] = ""
        base["condition_description"] = ""
        base["seller_feedback_pct"] = None
        base["returns_accepted"] = False
        base["item_location"] = "US"
        base["quantity_sold"] = 0

    return base


@router.get("/{auction_id}/seller")
async def get_seller_info(auction_id: int, db: Session = Depends(get_db)):
    """Return seller profile data for an auction."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    # Compute seller tier based on feedback score
    fb = a.seller_feedback or 0
    if fb >= 10000:
        tier = "Top Rated Plus"
        tier_color = "gold"
    elif fb >= 1000:
        tier = "Top Rated"
        tier_color = "green"
    elif fb >= 100:
        tier = "Established"
        tier_color = "blue"
    elif fb >= 10:
        tier = "Developing"
        tier_color = "gray"
    else:
        tier = "New"
        tier_color = "gray"

    return {
        "seller": a.seller,
        "feedback_score": fb,
        "tier": tier,
        "tier_color": tier_color,
        "ebay_seller_url": f"https://www.ebay.com/usr/{a.seller}" if a.seller else None,
        "auctions_from_seller": db.query(Auction).filter(
            Auction.seller == a.seller,
            Auction.status.in_(["active", "watchlist"]),
        ).count(),
    }


@router.get("/{auction_id}/bid-history")
def get_bid_history(auction_id: int, db: Session = Depends(get_db)):
    """Return synthetic bid history derived from stored auction data."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        raise HTTPException(404, "Auction not found")

    # eBay Browse API doesn't expose raw bid history without user OAuth.
    # Return a synthetic activity summary from what's stored.
    bids = a.bid_count or 0
    now = datetime.utcnow()
    created = a.created_at or now

    # Reconstruct estimated bid timeline
    history = []
    if bids > 0 and a.end_time:
        total_seconds = (a.end_time - created).total_seconds()
        for i in range(min(bids, 10)):  # Show up to 10 estimated bid events
            frac = (i + 1) / bids
            est_time = created.timestamp() + total_seconds * frac * 0.9
            from datetime import timezone
            history.append({
                "bid_number": i + 1,
                "estimated_at": datetime.utcfromtimestamp(est_time).isoformat(),
                "note": "Bid placed" if i < bids - 1 else "Current high bid",
            })

    return {
        "auction_id": auction_id,
        "ebay_listing_id": a.ebay_listing_id,
        "total_bids": bids,
        "current_price": a.current_price,
        "bid_history": history,
        "is_real_ebay": a.is_real_ebay,
        "note": "Live bid-by-bid history requires eBay user OAuth. Showing estimated timeline.",
        "ebay_bid_url": f"{a.ebay_url}#bidHistory" if a.ebay_url else None,
    }
