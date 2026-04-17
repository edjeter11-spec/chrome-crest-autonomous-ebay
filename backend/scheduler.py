"""
Scheduler: all jobs use real eBay API data only. No simulation.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from database import SessionLocal, Alert, Wishlist, Auction, Card
from scraper import sync_real_ebay_listings, run_snipe_alerts
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()

# Injected by main.py after app is created
_broadcast_fn = None

def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn

async def _broadcast(msg: dict):
    if _broadcast_fn:
        try:
            await _broadcast_fn(msg)
        except Exception:
            pass


async def job_ebay_sync():
    db = SessionLocal()
    try:
        added = await sync_real_ebay_listings(db)
        if added:
            logger.info(f"eBay sync: +{added} new listings")
        # Broadcast updated auctions to all connected clients
        await _broadcast({"type": "auctions_updated"})
    except Exception as e:
        logger.error(f"eBay sync error: {e}")
    finally:
        db.close()


async def job_snipe_alerts():
    db = SessionLocal()
    try:
        alerts = run_snipe_alerts(db)
        if alerts:
            logger.info(f"Created {len(alerts)} snipe alerts")
            await _broadcast({"type": "new_alerts", "count": len(alerts)})
    except Exception as e:
        logger.error(f"Snipe alert error: {e}")
    finally:
        db.close()


async def job_wishlist_alerts():
    """Fire an alert when any active auction price is at or below a wishlist max_price."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        wishlist_items = db.query(Wishlist).all()
        created = 0
        for wish in wishlist_items:
            if not wish.max_price:
                continue
            # Find active auctions for this card under max_price
            matches = (
                db.query(Auction)
                .filter(
                    Auction.card_id == wish.card_id,
                    Auction.status == "active",
                    Auction.current_price <= wish.max_price,
                    Auction.end_time > now,
                )
                .all()
            )
            for auction in matches:
                existing = db.query(Alert).filter(
                    Alert.auction_id == auction.id,
                    Alert.alert_type == "wishlist_price_match",
                ).first()
                if existing:
                    continue
                card = db.query(Card).filter(Card.id == wish.card_id).first()
                driver = card.driver_name if card else "F1"
                alert = Alert(
                    card_id=wish.card_id,
                    alert_type="wishlist_price_match",
                    threshold_price=wish.max_price,
                    triggered=True,
                    triggered_at=now,
                    auction_id=auction.id,
                    urgency="high",
                    message=(
                        f"WISHLIST HIT: {driver} {card.parallel if card else ''} — "
                        f"${auction.current_price:.2f} ≤ your max ${wish.max_price:.2f}"
                    ),
                )
                db.add(alert)
                created += 1
        if created:
            db.commit()
            logger.info(f"Wishlist alerts: {created} new price matches")
            await _broadcast({"type": "new_alerts", "count": created})
    except Exception as e:
        logger.error(f"Wishlist alert error: {e}")
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(job_ebay_sync, IntervalTrigger(seconds=90), id="ebay_sync", replace_existing=True)
    scheduler.add_job(job_snipe_alerts, IntervalTrigger(seconds=30), id="snipe_alerts", replace_existing=True)
    scheduler.add_job(job_wishlist_alerts, IntervalTrigger(seconds=60), id="wishlist_alerts", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started — eBay sync 90s, snipe 30s, wishlist 60s")
