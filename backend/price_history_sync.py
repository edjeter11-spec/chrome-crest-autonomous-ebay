"""
Price history sync — pulls sold eBay listings via Finding API and stores
them in price_history. Processes BATCH_SIZE drivers per cron call, cycling
through all 20 drivers. Each driver refreshes at most once per 24 h.
"""
from typing import Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import Card, PriceHistory, PriceHistorySyncLog
from ebay_finding_api import fetch_sold_for_driver
from scraper import _parallel_from_title, _is_2025_f1_title
import logging

logger = logging.getLogger(__name__)

BATCH_SIZE = 5      # drivers processed per cron run (~15 Finding API calls)
REFRESH_HOURS = 24  # hours between re-fetching the same driver


def _grade_from_title(title: str) -> Optional[str]:
    t = title.upper()
    for grade in ("PSA 10", "PSA 9", "PSA 8", "PSA 7", "BGS 9.5", "BGS 9", "CGC 10", "CGC 9.5"):
        if grade in t:
            return grade
    return None


def _drivers_due(db: Session) -> list[str]:
    """Return up to BATCH_SIZE drivers whose sync log is older than REFRESH_HOURS."""
    all_drivers = sorted({r[0] for r in db.query(Card.driver_name).all()})
    cutoff = datetime.utcnow() - timedelta(hours=REFRESH_HOURS)

    logs: dict[str, datetime] = {
        r.driver_name: r.last_synced
        for r in db.query(PriceHistorySyncLog).all()
        if r.last_synced
    }

    due = [d for d in all_drivers if logs.get(d, datetime.min) < cutoff]
    due.sort(key=lambda d: logs.get(d, datetime.min))
    return due[:BATCH_SIZE]


async def sync_driver(db: Session, driver_name: str) -> int:
    """Fetch and store sold listings for one driver. Returns new records added."""
    sold = await fetch_sold_for_driver(driver_name, pages=3)
    added = 0

    for item in sold:
        if not _is_2025_f1_title(item["title"]):
            continue

        # Dedup — skip if already in price_history
        if db.query(PriceHistory).filter(
            PriceHistory.ebay_item_id == item["ebay_item_id"]
        ).first():
            continue

        parallel = _parallel_from_title(item["title"])

        # Match to card: exact driver+parallel, then any card for driver
        card = (
            db.query(Card).filter(Card.driver_name == driver_name, Card.parallel == parallel).first()
            or db.query(Card).filter(Card.driver_name == driver_name).first()
        )
        if not card:
            continue

        condition = _grade_from_title(item["title"]) or item["condition"]

        db.add(PriceHistory(
            card_id=card.id,
            price=item["price"],
            sale_date=item["sale_date"],
            source="eBay Sold",
            condition=condition,
            ebay_item_id=item["ebay_item_id"],
        ))
        added += 1

    if added:
        db.commit()

    # Update sync log
    log = db.query(PriceHistorySyncLog).filter(
        PriceHistorySyncLog.driver_name == driver_name
    ).first()
    if log:
        log.last_synced = datetime.utcnow()
        log.total_records = (log.total_records or 0) + added
    else:
        db.add(PriceHistorySyncLog(
            driver_name=driver_name,
            last_synced=datetime.utcnow(),
            total_records=added,
        ))
    db.commit()

    logger.info(f"price_history: {driver_name} → +{added} records")
    return added


async def sync_price_history_batch(db: Session) -> dict:
    """
    Called from cron. Picks next BATCH_SIZE due drivers and syncs them.
    At 5 drivers/run with a 5-min cron all 20 drivers cycle every 20 min.
    """
    drivers = _drivers_due(db)
    if not drivers:
        return {"drivers_synced": 0, "records_added": 0}

    import asyncio
    total = 0
    for i, driver in enumerate(drivers):
        try:
            total += await sync_driver(db, driver)
        except Exception as e:
            logger.error(f"price_history sync failed for {driver}: {e}")
            # Don't update last_synced on error — driver stays due so next cron retries it
        if i < len(drivers) - 1:
            await asyncio.sleep(2.0)  # 2 s between drivers to stay under burst limit

    return {"drivers_synced": len(drivers), "records_added": total}


