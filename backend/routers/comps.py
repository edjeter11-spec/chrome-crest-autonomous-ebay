"""
On-demand comp refresh endpoint. Allows frontend to trigger fresh scrapes
for specific driver/parallel combos without waiting for the next cron cycle.

Improves sold comp freshness from 24h+ to minutes.
"""
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
from lib.auth import client_ip
from datetime import datetime
import asyncio
import logging

router = APIRouter(prefix="/api/comps", tags=["comps"])
logger = logging.getLogger(__name__)

# Track recent refresh jobs to prevent hammering.
# Keyed by trusted client IP — the old (driver, parallel) key let a single
# caller fire unlimited scrapes just by rotating driver names.
_refresh_tracker: dict = {}  # client_ip -> last_refresh_time


@router.post("/refresh")
async def refresh_comps(
    request: Request,
    driver: str = Query(..., description="F1 driver name (e.g., 'Max Verstappen')"),
    parallel: str = Query(None, description="Card parallel (optional; defaults to all)"),
    db: Session = Depends(get_db),
):
    """
    Manually trigger a fresh sold-comp scrape for a specific driver (and optional parallel).
    Non-blocking; scrape runs in background. Returns job ID for status polling.

    Rate-limiting: max 1 refresh per client IP per 5 minutes.
    """
    import os

    # Rate limit: only allow one refresh per 5 minutes per client IP
    tracker_key = client_ip(request)
    last_refresh = _refresh_tracker.get(tracker_key, datetime.min)
    elapsed = (datetime.utcnow() - last_refresh).total_seconds()
    if elapsed < 300:  # 5 minutes
        return {
            "status": "rate_limited",
            "message": f"Last refresh was {int(elapsed)}s ago. Please wait {int(300 - elapsed)}s.",
            "driver": driver,
            "parallel": parallel or "all",
        }

    # Mark as refreshed now
    _refresh_tracker[tracker_key] = datetime.utcnow()

    # Check credentials
    from ebay_api import has_real_credentials
    if not has_real_credentials():
        return {
            "status": "no_credentials",
            "message": "eBay API credentials not configured",
        }

    # Kick off background scrape
    job_id = f"refresh-{driver.replace(' ', '_')}-{(parallel or 'all').replace(' ', '_')}-{int(datetime.utcnow().timestamp())}"

    async def _scrape_background():
        """Run in background; errors don't block response."""
        try:
            from sold_ingest import ingest_sold_for_driver
            from database import SessionLocal

            local_db = SessionLocal()
            try:
                # Scrape sold comps for this driver
                result = await ingest_sold_for_driver(driver, local_db)
                added = result.get("added", 0)
                fetched = result.get("fetched", 0)
                skipped_dupe = result.get("skipped_dupe", 0)

                logger.info(
                    f"Comp refresh complete: {driver} {parallel or ''} "
                    f"— +{added} new, {fetched} fetched, {skipped_dupe} dupes"
                )
            finally:
                local_db.close()
        except Exception as e:
            logger.error(f"Comp refresh failed for {driver}: {e}")

    # Fire it off without blocking
    asyncio.create_task(_scrape_background())

    return {
        "status": "queued",
        "job_id": job_id,
        "driver": driver,
        "parallel": parallel or "all",
        "message": f"Scraping fresh comps for {driver} {parallel or '(all parallels)'}. Check status with ?job_id={job_id}",
    }


@router.get("/status")
async def refresh_status(
    job_id: str = Query(None, description="Job ID from refresh endpoint"),
):
    """
    Poll status of a background comp refresh job.
    Returns estimated time remaining or final result once complete.
    """
    if not job_id:
        return {"error": "job_id required"}

    # In a real system, this would query a job queue (Redis, database, etc).
    # For now, return a placeholder that tells the frontend to check back soon.
    return {
        "job_id": job_id,
        "status": "in_progress",
        "message": "Scrape in progress. Check back in 30-60 seconds.",
        "note": "Full implementation would track job status in Redis or database.",
    }


@router.post("/refresh-all")
async def refresh_all_comps(db: Session = Depends(get_db)):
    """
    Manually trigger a full sold-comp refresh for ALL drivers.
    Non-blocking; runs in background. Same as the hourly Vercel cron,
    but callable on-demand from the frontend.

    Rate-limiting: max 1 full refresh per 30 minutes.
    """
    # Rate limit: allow one full refresh per 30 minutes. Deliberately a
    # GLOBAL key (not per-IP) — per-IP would let a multi-IP attacker queue
    # many full-matrix scrapes; global is strictly tighter.
    last_full = _refresh_tracker.get("full_refresh", datetime.min)
    elapsed = (datetime.utcnow() - last_full).total_seconds()
    if elapsed < 1800:  # 30 minutes
        return {
            "status": "rate_limited",
            "message": f"Last full refresh was {int(elapsed)}s ago. Please wait {int(1800 - elapsed)}s.",
        }

    _refresh_tracker["full_refresh"] = datetime.utcnow()

    from ebay_api import has_real_credentials
    if not has_real_credentials():
        return {
            "status": "no_credentials",
            "message": "eBay API credentials not configured",
        }

    async def _full_scrape_background():
        """Scrape all drivers in background."""
        try:
            from sold_ingest import ingest_all_drivers
            from database import SessionLocal

            local_db = SessionLocal()
            try:
                result = await ingest_all_drivers(local_db)
                total_added = sum(r.get("added", 0) for r in result if "added" in r)
                logger.info(f"Full comps refresh complete: +{total_added} total new rows")
            finally:
                local_db.close()
        except Exception as e:
            logger.error(f"Full comps refresh failed: {e}")

    asyncio.create_task(_full_scrape_background())

    return {
        "status": "queued",
        "message": "Full sold-comp refresh queued for all F1 drivers. Check back in 2-3 minutes.",
        "note": "Runs the same pipeline as the hourly Vercel cron.",
    }


@router.get("/latest-refresh")
def latest_refresh_time(
    driver: str = Query(..., description="F1 driver name"),
    parallel: str = Query(None, description="Card parallel (optional)"),
    db: Session = Depends(get_db),
):
    """
    Return the timestamp of the most recent sold-card scrape for this driver/parallel.
    Helps frontend show "last updated X minutes ago" badges.
    """
    from database import SoldCard
    from sqlalchemy import desc

    filters = [SoldCard.driver_name == driver]
    if parallel:
        filters.append(SoldCard.parallel == parallel)

    latest = (
        db.query(SoldCard)
        .filter(*filters)
        .order_by(desc(SoldCard.scraped_at))
        .limit(1)
        .first()
    )

    if not latest or not latest.scraped_at:
        return {
            "driver": driver,
            "parallel": parallel or "all",
            "latest_scrape": None,
            "freshness_minutes": None,
            "message": "No sold comps found for this driver/parallel",
        }

    scraped_at = latest.scraped_at
    age_seconds = (datetime.utcnow() - scraped_at).total_seconds()
    age_minutes = int(age_seconds / 60)

    return {
        "driver": driver,
        "parallel": parallel or "all",
        "latest_scrape": scraped_at.isoformat(),
        "age_minutes": age_minutes,
        "freshness_category": (
            "fresh" if age_minutes < 60 else
            "recent" if age_minutes < 360 else  # 6 hours
            "stale"
        ),
    }
