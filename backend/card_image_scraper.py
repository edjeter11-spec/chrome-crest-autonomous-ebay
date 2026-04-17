"""
Scrapes eBay public search HTML for representative card images.
No API key required — uses public eBay search pages.
Images are stored per (driver, parallel) in the Card catalog.
"""
import re
import asyncio
import httpx
import logging
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Parallel → search hint (improves precision)
PARALLEL_HINTS = {
    "Base": "",
    "Refractor": "refractor",
    "Blue /150": "blue refractor /150",
    "Green /99": "green refractor /99",
    "Orange /50": "orange refractor /50",
    "Red /25": "red refractor /25",
    "Gold /10": "gold refractor /10",
    "Autograph": "auto autograph",
    "Prism Refractor": "prism refractor",
}


async def scrape_ebay_card_image(driver: str, parallel: str = "Base", year: int = 2025) -> str:
    """
    Scrape eBay's public search page for a card type and return the best image URL.
    Returns empty string on failure.
    """
    last_name = driver.split()[-1]
    hint = PARALLEL_HINTS.get(parallel, parallel.lower())
    query = f"{year} Topps Chrome Formula 1 {last_name} {hint}".strip()
    # Sort by Best Match, Buy It Now preferred for cleaner images
    search_url = (
        f"https://www.ebay.com/sch/i.html"
        f"?_nkw={quote_plus(query)}&_sacat=212&LH_BIN=1&_sop=12&_ipg=24"
    )

    try:
        async with httpx.AsyncClient(
            timeout=12.0,
            follow_redirects=True,
            headers=HEADERS,
        ) as client:
            r = await client.get(search_url)
            if r.status_code != 200:
                logger.debug(f"eBay search returned {r.status_code} for {driver} {parallel}")
                return ""

            html = r.text

            # eBay renders images as: src="https://i.ebayimg.com/thumbs/images/g/xxx/s-l225.jpg"
            # or data-src for lazy loading. Grab the first real card listing image.
            patterns = [
                r'<img[^>]+class="[^"]*s-item__image-img[^"]*"[^>]+(?:src|data-src)="(https://i\.ebayimg\.com/[^"?]+)"',
                r'<img[^>]+(?:src|data-src)="(https://i\.ebayimg\.com/thumbs/images/g/[^"?]+)"',
                r'<img[^>]+(?:src|data-src)="(https://i\.ebayimg\.com/images/g/[^"?]+)"',
            ]
            for pattern in patterns:
                match = re.search(pattern, html)
                if match:
                    img_url = match.group(1)
                    # Upgrade thumbnail (s-l225 or s-l300) to s-l500
                    img_url = re.sub(r'/thumbs/', '/', img_url)
                    img_url = re.sub(r's-l\d+', 's-l500', img_url)
                    logger.info(f"Found image for {driver} {parallel}: {img_url[:60]}...")
                    return img_url

            logger.debug(f"No image found in eBay HTML for {driver} {parallel}")
    except Exception as e:
        logger.warning(f"eBay scrape error for {driver} {parallel}: {e}")
    return ""


async def scrape_all_missing(db) -> int:
    """
    For every Card that still has a placeholder image, scrape eBay for a real one.
    Deduplicates by (driver_name, parallel) so each combo is scraped once.
    Returns number of cards updated.
    """
    from database import Card

    # Find cards still using placehold.co or with no image
    cards = db.query(Card).filter(
        Card.image_url.like("%placehold.co%") | Card.image_url.is_(None)
    ).all()

    if not cards:
        logger.info("All cards already have images — skipping scrape")
        return 0

    # Deduplicate: scrape once per (driver, parallel)
    seen: set[tuple] = set()
    results: dict[tuple, str] = {}

    tasks = []
    keys = []
    for card in cards:
        key = (card.driver_name, card.parallel or "Base")
        if key not in seen:
            seen.add(key)
            keys.append(key)
            tasks.append(scrape_ebay_card_image(card.driver_name, card.parallel or "Base", card.year or 2025))

    logger.info(f"Scraping eBay for {len(tasks)} unique card types...")
    # Run in small batches to avoid hammering eBay
    batch_size = 5
    for i in range(0, len(tasks), batch_size):
        batch_keys = keys[i:i + batch_size]
        batch_tasks = tasks[i:i + batch_size]
        batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
        for key, result in zip(batch_keys, batch_results):
            if isinstance(result, str) and result:
                results[key] = result
        if i + batch_size < len(tasks):
            await asyncio.sleep(1.5)  # Rate-limit batches

    # Write results to DB — update ALL cards sharing the same (driver, parallel)
    updated = 0
    for (driver, parallel), img_url in results.items():
        rows = db.query(Card).filter(
            Card.driver_name == driver,
            Card.parallel == parallel,
        ).all()
        for row in rows:
            row.image_url = img_url
        updated += len(rows)

    db.commit()
    logger.info(f"Card image scrape complete: {len(results)} types scraped, {updated} rows updated")
    return updated
