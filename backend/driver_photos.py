"""
Fetches official F1 driver headshots from Wikipedia/Wikimedia Commons.
No API key required — Wikipedia's API is public.
Images served through our proxy to avoid hotlink issues.
"""
import asyncio
import re
import httpx
import logging

logger = logging.getLogger(__name__)

# Matches a Wikimedia ORIGINAL (non-/thumb/) image URL — i.e. a camera-res
# multi-MB file we never want to serve as an avatar. Do NOT hand-build
# /thumb/ URLs from these (renditions only exist at certain widths — 400s);
# re-fetch via the pageimages API instead, which returns a valid thumbnail.
_WIKIMEDIA_ORIGINAL_RE = re.compile(
    r"^https://upload\.wikimedia\.org/wikipedia/[a-z]+/[0-9a-f]/[0-9a-f]{2}/[^/?#]+$",
    re.IGNORECASE,
)


def is_wikimedia_original(url: str) -> bool:
    return bool(url and _WIKIMEDIA_ORIGINAL_RE.match(url))

# Wikipedia article titles for each driver
DRIVER_WIKIPEDIA = {
    "Max Verstappen": "Max Verstappen",
    "Lewis Hamilton": "Lewis Hamilton",
    "Charles Leclerc": "Charles Leclerc",
    "Lando Norris": "Lando Norris",
    "Fernando Alonso": "Fernando Alonso",
    "Oscar Piastri": "Oscar Piastri",
    "Carlos Sainz": "Carlos Sainz Jr.",
    "George Russell": "George Russell (racing driver)",
    "Sergio Perez": "Sergio Pérez",
    "Liam Lawson": "Liam Lawson",
    "Andrea Kimi Antonelli": "Kimi Antonelli",
    "Gabriel Bortoleto": "Gabriel Bortoleto",
    "Oliver Bearman": "Oliver Bearman",
    "Yuki Tsunoda": "Yuki Tsunoda",
    "Lance Stroll": "Lance Stroll",
    "Pierre Gasly": "Pierre Gasly",
    "Esteban Ocon": "Esteban Ocon",
    "Nico Hulkenberg": "Nico Hülkenberg",
    "Jack Doohan": "Jack Doohan",
    "Isack Hadjar": "Isack Hadjar",
}

# Hard fallbacks for drivers whose Wikipedia page image fetch is flaky.
_PHOTO_FALLBACKS: dict[str, str] = {
    "Andrea Kimi Antonelli": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/FIA_F1_Austria_2024_Nr._12_Antonelli.jpg/330px-FIA_F1_Austria_2024_Nr._12_Antonelli.jpg",
}

# In-memory cache: driver_name -> image_url
_photo_cache: dict[str, str] = {}


async def fetch_driver_photo(driver_name: str) -> str:
    """Fetch the Wikipedia page image URL for a driver.

    Requests thumbnail|original and PREFERS the thumbnail: the `original`
    source is camera resolution (1700px+, multi-MB) — absurd for the
    36-144px avatars we render, and slow enough that avatar <img>s sat
    pending for many seconds on first load. Wikimedia picks a rendition
    width that actually exists (hand-building /thumb/ URLs can 400).
    """
    title = DRIVER_WIKIPEDIA.get(driver_name, driver_name)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "prop": "pageimages",
                    "format": "json",
                    "piprop": "thumbnail|original",
                    "pithumbsize": 512,
                    "titles": title,
                    "origin": "*",
                },
                headers={"User-Agent": "F1ChromeCrest/1.0 (card platform)"},
            )
            if r.status_code != 200:
                return ""
            data = r.json()
            pages = data.get("query", {}).get("pages", {})
            for page in pages.values():
                if "thumbnail" in page:
                    return page["thumbnail"]["source"]
                if "original" in page:
                    return page["original"]["source"]
    except Exception as e:
        logger.warning(f"Wikipedia fetch failed for {driver_name}: {e}")
    return _PHOTO_FALLBACKS.get(driver_name, "")


async def warm_cache() -> dict[str, str]:
    """Fetch all driver photos concurrently and cache them."""
    tasks = {
        name: asyncio.create_task(fetch_driver_photo(name))
        for name in DRIVER_WIKIPEDIA
    }
    results = {}
    for name, task in tasks.items():
        try:
            url = await task
            if url:
                _photo_cache[name] = url
                results[name] = url
                logger.info(f"Cached photo for {name}")
        except Exception as e:
            logger.warning(f"Photo cache failed for {name}: {e}")
    return results


def get_cached_photo(driver_name: str) -> str:
    return _photo_cache.get(driver_name, "")


async def get_photo(driver_name: str) -> str:
    """Return cached photo or fetch if missing.

    Priority:
    1. In-memory cache
    2. Database cache (image_url from Card table)
    3. Wikipedia API fetch
    4. Hardcoded fallbacks
    """
    cached = _photo_cache.get(driver_name, "")
    if cached and not is_wikimedia_original(cached):
        return cached

    # Check database for cached photo — skip placeholder URLs so Wikipedia
    # fetch runs, and skip Wikimedia ORIGINALS (multi-MB stale entries from
    # pre-thumbnail refresh runs) so they get replaced by a thumbnail below.
    try:
        from database import SessionLocal, Card
        db = SessionLocal()
        card = db.query(Card).filter(Card.driver_name == driver_name).first()
        db.close()
        if (
            card and card.image_url
            and "placehold.co" not in card.image_url
            and not is_wikimedia_original(card.image_url)
        ):
            _photo_cache[driver_name] = card.image_url
            return card.image_url
    except Exception as e:
        logger.debug(f"Database photo lookup failed for {driver_name}: {e}")

    # Fetch from Wikipedia if not in DB
    url = await fetch_driver_photo(driver_name)
    if not url:
        url = _PHOTO_FALLBACKS.get(driver_name, "")
    if not url and cached:
        # Refetch failed but we hold a stale heavy original — better that
        # than a blank avatar.
        url = cached
    if url:
        _photo_cache[driver_name] = url
    return url
