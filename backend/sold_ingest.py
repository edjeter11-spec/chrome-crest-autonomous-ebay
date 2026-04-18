"""
Ingestion pipeline that pulls sold 2025 Topps Chrome F1 listings via the
eBay Finding API and upserts them into the SoldCard table.

Finding API has a separate quota from Browse API — safe to use even when Browse
is rate-limited. Non-base cards only.
"""
import asyncio
import logging
import re
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from database import SoldCard, SessionLocal, Auction, Card
from dedup import fingerprint as sold_fingerprint
from ebay_finding_api import (
    fetch_sold_for_driver, fetch_sold_for_query, fetch_active_for_query,
)
from ebay_api import _is_valid_2025_f1_listing, extract_driver_from_title

logger = logging.getLogger(__name__)


# Same list used by scrape_ebay_sold.py — keeps us aligned with the main F1 grid.
F1_DRIVERS = [
    "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
    "Fernando Alonso", "Oscar Piastri", "Carlos Sainz", "George Russell",
    "Sergio Perez", "Lance Stroll", "Valtteri Bottas", "Esteban Ocon",
    "Pierre Gasly", "Yuki Tsunoda", "Nico Hulkenberg", "Kevin Magnussen",
    "Zhou Guanyu", "Alexander Albon", "Gabriel Bortoleto", "Liam Lawson",
    "Andrea Kimi Antonelli", "Oliver Bearman", "Jack Doohan", "Isack Hadjar",
    "Franco Colapinto",
]


def _grade_from_title(title: str) -> Optional[str]:
    t = title.upper()
    # PSA 10 .. PSA 1 — check highest first for better specificity
    for g in ("PSA 10", "PSA 9.5", "PSA 9", "PSA 8.5", "PSA 8", "PSA 7",
              "BGS 10", "BGS 9.5", "BGS 9", "BGS 8.5",
              "SGC 10", "SGC 9.5", "SGC 9",
              "CGC 10", "CGC 9.5", "CGC 9"):
        if g in t:
            return g
    # Raw PSA/BGS match without specific number
    if re.search(r"\bPSA\s*\d", t):
        m = re.search(r"\bPSA\s*(\d+(?:\.\d)?)", t)
        if m:
            return f"PSA {m.group(1)}"
    return None


def _parallel_from_title(title: str) -> str:
    t = title.upper()
    if "1/1" in t or "SUPERFRACTOR" in t: return "Superfractor 1/1"
    if "/5" in t and "RED" in t: return "Red /5"
    if "/10" in t and "BLACK" in t: return "Black /10"
    if "/25" in t and "ORANGE" in t: return "Orange /25"
    if "/50" in t and "GOLD" in t: return "Gold /50"
    if "/75" in t and ("F1 75" in t or "75TH" in t): return "F1 75th /75"
    if "/99" in t and "GREEN" in t: return "Green /99"
    if "/150" in t and "BLUE" in t: return "Blue /150"
    if "/199" in t and "AQUA" in t: return "Aqua /199"
    if "/250" in t and "PINK" in t: return "Pink /250"
    if "/299" in t and "TEAL" in t: return "Teal /299"
    # Inserts (named)
    for insert_name, label in [
        ("VEGAS AT NIGHT", "Vegas at Night"),
        ("NEON NATIONS", "Neon Nations"),
        ("FLOOR IT", "Floor It"),
        ("SPEED WHEELS", "Speed Wheels"),
        ("TOP SPEED", "Top Speed"),
        ("FOUR & MORE", "Four & More"),
        ("FOUR AND MORE", "Four & More"),
        ("DIAMOND 75TH", "Diamond 75th"),
        ("HELIX", "Helix"),
        ("ULTRASONIC", "Ultrasonic"),
        ("THE GRAIL", "The Grail"),
        ("FUTURO", "Futuro"),
        ("THE CHAIN", "The Chain"),
        ("THE GRID", "The Grid"),
        ("HELMET COLLECTION", "Helmet Collection"),
        ("SPEED DEMONS", "Speed Demons"),
        ("ACE OF TRADES", "Ace of Trades"),
    ]:
        if insert_name in t:
            return label
    if " AUTO " in t or t.endswith(" AUTO") or "AUTOGRAPH" in t or "#CAC-" in t:
        return "Autograph"
    if "PRIZM" in t or "PRISM" in t: return "Prism Refractor"
    if "RAY WAVE" in t or "B&W RAY" in t: return "B&W Ray Wave"
    if "LAZER" in t or "LASER" in t: return "B&W Lazer"
    if "CHECKER FLAG" in t or "CHECKERED FLAG" in t: return "Checker Flag"
    if "REFRACTOR" in t: return "Refractor"
    return "Base"


def _match_driver(title: str) -> Optional[str]:
    """Return canonical driver name from F1_DRIVERS if title contains last name."""
    t = title.lower()
    for driver in F1_DRIVERS:
        last = driver.split()[-1].lower()
        if last in t:
            return driver
    # Fallback to ebay_api extractor (wider driver list)
    return extract_driver_from_title(title)


def _extract_image_url(ebay_item_id: str) -> Optional[str]:
    """Finding API sometimes returns a galleryURL per item. We can't retrieve it
    post-hoc without another call; return None and let the frontend fall back
    to proxying the ebay listing when possible."""
    return None


def _build_ebay_url(ebay_item_id: str) -> str:
    # Strip any prefix like "v1|123|0"
    raw = ebay_item_id.split("|")[1] if "|" in ebay_item_id else ebay_item_id
    return f"https://www.ebay.com/itm/{raw}"


def _has_matching_fingerprint(db: Session, driver, parallel, grade, sale_date, sale_price) -> bool:
    """Return True if a non-duplicate SoldCard with this fingerprint already exists."""
    if not sale_date:
        return False
    fp = sold_fingerprint(driver, parallel, grade, sale_date, sale_price)
    try:
        day_start = datetime.combine(sale_date.date(), datetime.min.time())
        day_end = datetime.combine(sale_date.date(), datetime.max.time())
    except Exception:
        return False
    q = db.query(SoldCard).filter(
        SoldCard.driver_name == driver,
        SoldCard.parallel == parallel,
        SoldCard.sale_date >= day_start,
        SoldCard.sale_date <= day_end,
        SoldCard.is_duplicate == False,  # noqa: E712
    )
    for c in q.all():
        if sold_fingerprint(c.driver_name, c.parallel, c.grade, c.sale_date, c.sale_price) == fp:
            return True
    return False


async def ingest_sold_for_driver(driver_name: str, db: Session) -> dict:
    """Fetch Finding API results for one driver and upsert non-base rows."""
    items = await fetch_sold_for_driver(driver_name, pages=3)
    added = 0
    skipped_base = 0
    skipped_invalid = 0
    skipped_dupe = 0

    for item in items:
        title = item.get("title", "")
        if not _is_valid_2025_f1_listing(title):
            skipped_invalid += 1
            continue

        parallel = _parallel_from_title(title)
        if parallel == "Base" or not parallel:
            skipped_base += 1
            continue

        ebay_item_id = item.get("ebay_item_id", "")
        if not ebay_item_id:
            continue

        existing = db.query(SoldCard).filter(
            SoldCard.ebay_item_id == ebay_item_id
        ).first()
        if existing:
            skipped_dupe += 1
            continue

        price = float(item.get("price") or 0)
        if price <= 0:
            continue

        sale_date = item.get("sale_date") or datetime.utcnow()
        grade = _grade_from_title(title)
        matched_driver = _match_driver(title) or driver_name

        is_dupe = _has_matching_fingerprint(db, matched_driver, parallel, grade, sale_date, price)

        db.add(SoldCard(
            ebay_item_id=ebay_item_id,
            title=title,
            driver_name=matched_driver,
            parallel=parallel,
            grade=grade,
            condition=item.get("condition"),
            sale_price=price,
            sale_date=sale_date,
            image_url=item.get("image_url"),
            ebay_url=_build_ebay_url(ebay_item_id),
            shipping_cost=item.get("shipping_cost"),
            is_auction=False,  # Finding API doesn't return buying_options reliably
            series="F1",
            is_duplicate=is_dupe,
            scraped_at=datetime.utcnow(),
        ))
        added += 1

    if added:
        try:
            db.commit()
        except Exception as e:
            logger.error(f"commit failed for {driver_name}: {e}")
            db.rollback()

    return {
        "driver": driver_name,
        "fetched": len(items),
        "added": added,
        "skipped_base": skipped_base,
        "skipped_invalid": skipped_invalid,
        "skipped_dupe": skipped_dupe,
    }


async def ingest_all_drivers(db: Optional[Session] = None) -> dict:
    """Ingest across all F1 drivers. Creates its own session if none provided."""
    owns_session = db is None
    if owns_session:
        db = SessionLocal()

    results = []
    total_added = 0
    try:
        for i, driver in enumerate(F1_DRIVERS):
            try:
                r = await ingest_sold_for_driver(driver, db)
                results.append(r)
                total_added += r["added"]
                logger.info(f"sold_ingest [{i+1}/{len(F1_DRIVERS)}] {driver}: +{r['added']}")
            except Exception as e:
                logger.error(f"sold_ingest error for {driver}: {e}")
                results.append({"driver": driver, "error": str(e)[:200]})
            # Gentle pacing between drivers — Finding API burst limit ~1 req/s
            if i < len(F1_DRIVERS) - 1:
                await asyncio.sleep(0.5)
    finally:
        if owns_session:
            db.close()

    return {
        "total_added": total_added,
        "drivers_processed": len(F1_DRIVERS),
        "results": results,
    }


# ── Aggressive Finding API ingest — driver × parallel matrix + active listings ──

MAJOR_PARALLELS = [
    "Refractor", "Auto", "Green /99", "Gold /50", "Orange /25", "Red /5",
    "Superfractor 1/1", "Prism", "Checker Flag", "Ray Wave", "X-Fractor",
    "Pink /250", "Blue /150", "Aqua /199", "Teal /299",
]

TOP_DRIVERS = [
    "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
    "Oscar Piastri", "Fernando Alonso", "Carlos Sainz", "George Russell",
    "Andrea Kimi Antonelli", "Oliver Bearman", "Gabriel Bortoleto", "Liam Lawson",
]


async def _upsert_sold_item(item: dict, db: Session, fallback_driver: Optional[str] = None) -> str:
    """Returns one of: 'added', 'dupe', 'invalid', 'base', 'skip'."""
    title = item.get("title", "")
    if not _is_valid_2025_f1_listing(title):
        return "invalid"
    parallel = _parallel_from_title(title)
    if parallel == "Base" or not parallel:
        return "base"
    ebay_item_id = item.get("ebay_item_id", "")
    price = float(item.get("price") or 0)
    if not ebay_item_id or price <= 0:
        return "skip"
    if db.query(SoldCard).filter(SoldCard.ebay_item_id == ebay_item_id).first():
        return "dupe"
    sale_date = item.get("sale_date") or datetime.utcnow()
    grade_val = _grade_from_title(title)
    driver_val = _match_driver(title) or fallback_driver
    is_dupe = _has_matching_fingerprint(db, driver_val, parallel, grade_val, sale_date, price)
    db.add(SoldCard(
        ebay_item_id=ebay_item_id,
        title=title,
        driver_name=driver_val,
        parallel=parallel,
        grade=grade_val,
        condition=item.get("condition"),
        sale_price=price,
        sale_date=sale_date,
        image_url=item.get("image_url"),
        ebay_url=item.get("ebay_url") or f"https://www.ebay.com/itm/{ebay_item_id.split('|')[-2] if '|' in ebay_item_id else ebay_item_id}",
        shipping_cost=item.get("shipping_cost"),
        is_auction=False,
        series="F1",
        is_duplicate=is_dupe,
        scraped_at=datetime.utcnow(),
    ))
    return "added"


async def _upsert_active_item(item: dict, db: Session) -> str:
    title = item.get("title", "")
    if not _is_valid_2025_f1_listing(title):
        return "invalid"
    parallel = _parallel_from_title(title)
    if parallel == "Base" or not parallel:
        return "base"
    ebay_item_id = item.get("ebay_item_id", "")
    price = float(item.get("price") or 0)
    if not ebay_item_id or price <= 0:
        return "skip"
    from datetime import timedelta
    driver = _match_driver(title)
    card = None
    if driver and parallel:
        card = (db.query(Card)
                .filter(Card.driver_name == driver, Card.parallel == parallel)
                .first())
    existing = db.query(Auction).filter(Auction.ebay_listing_id == ebay_item_id).first()
    if existing:
        existing.current_price = price
        existing.bid_count = item.get("bid_count", 0)
        existing.end_time = item.get("end_time") or existing.end_time
        existing.image_url = item.get("image_url") or existing.image_url
        existing.last_updated = datetime.utcnow()
        existing.status = "active"
        return "updated"
    db.add(Auction(
        card_id=card.id if card else None,
        ebay_listing_id=ebay_item_id,
        title=title,
        current_price=price,
        bid_count=item.get("bid_count", 0),
        end_time=item.get("end_time") or (datetime.utcnow() + timedelta(days=3)),
        seller="",
        seller_feedback=0,
        condition="Used",
        status="active",
        ebay_url=item.get("ebay_url"),
        image_url=item.get("image_url"),
        shipping_cost=0.0,
        is_real_ebay=True,
        created_at=datetime.utcnow(),
        last_updated=datetime.utcnow(),
    ))
    return "added"


async def ingest_finding_api_all(db: Optional[Session] = None) -> dict:
    """
    Aggressive Finding API ingest:
      - Sold:   driver × major_parallel matrix via findCompletedItems
      - Active: same matrix via findItemsAdvanced  -> Auction rows
    Stays on Finding API quota (separate from Browse).
    """
    owns = db is None
    if owns:
        db = SessionLocal()
    sold_added = 0
    active_added = 0
    active_updated = 0
    queries_run = 0
    errors: list[str] = []
    try:
        for driver in TOP_DRIVERS:
            last = driver.split()[-1]
            for parallel in MAJOR_PARALLELS:
                q = f"2025 Topps Chrome F1 {last} {parallel}"
                queries_run += 1
                # Sold
                try:
                    items = await fetch_sold_for_query(q, pages=1)
                    for it in items:
                        r = await _upsert_sold_item(it, db, fallback_driver=driver)
                        if r == "added":
                            sold_added += 1
                except Exception as e:
                    errors.append(f"sold '{q}': {str(e)[:80]}")
                await asyncio.sleep(1.0)
                # Active
                try:
                    items = await fetch_active_for_query(q, pages=1)
                    for it in items:
                        r = await _upsert_active_item(it, db)
                        if r == "added":
                            active_added += 1
                        elif r == "updated":
                            active_updated += 1
                except Exception as e:
                    errors.append(f"active '{q}': {str(e)[:80]}")
                await asyncio.sleep(1.0)
                # commit periodically so partial progress survives timeouts
                if queries_run % 10 == 0:
                    try:
                        db.commit()
                    except Exception as e:
                        logger.error(f"mid-commit: {e}")
                        db.rollback()
        try:
            db.commit()
        except Exception as e:
            logger.error(f"final commit: {e}")
            db.rollback()
    finally:
        if owns:
            db.close()
    return {
        "queries_run": queries_run,
        "sold_added": sold_added,
        "active_added": active_added,
        "active_updated": active_updated,
        "errors": errors[:20],
    }
