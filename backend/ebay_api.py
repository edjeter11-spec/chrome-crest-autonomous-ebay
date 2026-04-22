"""
eBay Browse API client for F1 card searching.
Uses OAuth 2.0 client credentials flow.
Requires EBAY_APP_ID and EBAY_APP_SECRET in backend/.env
"""
import os
import base64
import httpx
import asyncio
from datetime import datetime, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Rate limit tracking
_api_call_count = 0
_api_call_reset_at = None

EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
EBAY_SANDBOX_OAUTH_URL = "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
EBAY_SANDBOX_BROWSE_URL = "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search"

# F1 card search queries — kept narrow to stay under eBay Browse API's
# 5,000-call/day default limit. Each cron run hits 2 queries × 2 passes = 4 calls.
# Broad queries only; driver-specific searches were redundant with broad ones.
SEARCH_QUERIES = [
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1",
]

# eBay category IDs for trading cards
TRADING_CARDS_CATEGORY = "212"  # Sports Trading Cards

_token_cache: dict = {"token": None, "expires_at": None}
_last_oauth_error: Optional[str] = None


def _get_credentials():
    app_id = os.getenv("EBAY_APP_ID", "")
    # Prefer EBAY_CERT_ID (new naming), fall back to EBAY_APP_SECRET (legacy).
    app_secret = os.getenv("EBAY_CERT_ID", "") or os.getenv("EBAY_APP_SECRET", "")
    sandbox = os.getenv("EBAY_SANDBOX", "false").lower() == "true"
    return app_id, app_secret, sandbox


def has_real_credentials() -> bool:
    app_id, app_secret, _ = _get_credentials()
    return bool(app_id and app_secret and app_id != "YOUR_EBAY_APP_ID")


async def get_oauth_token() -> Optional[str]:
    """Get or refresh eBay OAuth token using client credentials."""
    global _token_cache

    # Return cached token if still valid
    if _token_cache["token"] and _token_cache["expires_at"]:
        if datetime.utcnow() < _token_cache["expires_at"]:
            return _token_cache["token"]

    app_id, app_secret, sandbox = _get_credentials()
    if not app_id or not app_secret:
        return None

    oauth_url = EBAY_SANDBOX_OAUTH_URL if sandbox else EBAY_OAUTH_URL

    # Base64 encode credentials
    credentials = base64.b64encode(f"{app_id}:{app_secret}".encode()).decode()

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                oauth_url,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": f"Basic {credentials}",
                },
                data={
                    "grant_type": "client_credentials",
                    "scope": "https://api.ebay.com/oauth/api_scope",
                },
                timeout=10.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                token = data["access_token"]
                expires_in = data.get("expires_in", 7200)
                _token_cache = {
                    "token": token,
                    "expires_at": datetime.utcnow() + timedelta(seconds=expires_in - 60),
                }
                logger.info("eBay OAuth token obtained successfully")
                return token
            else:
                logger.error(f"eBay OAuth failed: {resp.status_code} {resp.text}")
                global _last_oauth_error
                _last_oauth_error = f"HTTP {resp.status_code}: {resp.text[:400]}"
                return None
        except Exception as e:
            logger.error(f"eBay OAuth error: {e}")
            return None


# In-process cache of cooldown timestamp. Persisted to DB on write so cold starts
# see it; read from DB on first check per process.
_rate_limited_until: Optional[datetime] = None
_cooldown_loaded = False


def _track_api_call():
    """Track API call count towards daily 5000 limit. Returns True if warning threshold exceeded."""
    global _api_call_count, _api_call_reset_at
    now = datetime.utcnow()

    # Reset counter at daily boundary (07:05 UTC when eBay quota resets)
    reset_time = now.replace(hour=7, minute=5, second=0, microsecond=0)
    if reset_time > now:
        reset_time -= timedelta(days=1)

    if _api_call_reset_at is None or now >= _api_call_reset_at + timedelta(days=1):
        _api_call_count = 0
        _api_call_reset_at = reset_time

    _api_call_count += 1

    # Warn at 80% of daily quota
    if _api_call_count == 4000:
        logger.warning(f"eBay API usage: {_api_call_count}/5000 calls — 80% quota reached")
        return True
    elif _api_call_count == 4500:
        logger.warning(f"eBay API usage: {_api_call_count}/5000 calls — 90% quota reached")
        return True
    elif _api_call_count > 5000:
        logger.error(f"eBay API usage: {_api_call_count}/5000 calls — QUOTA EXCEEDED")
        return True

    return False


def _load_cooldown_from_db():
    """Read persisted cooldown from system_state table. Safe to call repeatedly."""
    global _rate_limited_until, _cooldown_loaded
    if _cooldown_loaded:
        return
    try:
        from database import SessionLocal, SystemState
        db = SessionLocal()
        row = db.query(SystemState).filter(SystemState.key == "ebay_rate_limited_until").first()
        if row and row.value:
            try:
                _rate_limited_until = datetime.fromisoformat(row.value)
            except Exception:
                pass
        db.close()
    except Exception:
        pass
    _cooldown_loaded = True


def _is_rate_limited() -> bool:
    global _rate_limited_until
    _load_cooldown_from_db()
    if _rate_limited_until and datetime.utcnow() < _rate_limited_until:
        return True
    _rate_limited_until = None
    return False


def _next_ebay_reset() -> datetime:
    """eBay quota resets at 07:00 UTC (midnight Pacific). Returns next reset datetime."""
    now = datetime.utcnow()
    reset = now.replace(hour=7, minute=5, second=0, microsecond=0)
    if reset <= now:
        reset += timedelta(days=1)
    return reset


def _mark_rate_limited_until_reset():
    """Suppress further eBay calls until the next daily quota reset. Persisted."""
    _mark_rate_limited(int((_next_ebay_reset() - datetime.utcnow()).total_seconds()))


def _mark_rate_limited(seconds: int = 600):
    """Suppress further eBay calls for `seconds` after a 429. Persists across cold starts."""
    global _rate_limited_until, _cooldown_loaded
    _rate_limited_until = datetime.utcnow() + timedelta(seconds=seconds)
    _cooldown_loaded = True
    try:
        from database import SessionLocal, SystemState
        db = SessionLocal()
        row = db.query(SystemState).filter(SystemState.key == "ebay_rate_limited_until").first()
        if row:
            row.value = _rate_limited_until.isoformat()
        else:
            db.add(SystemState(key="ebay_rate_limited_until", value=_rate_limited_until.isoformat()))
        db.commit()
        db.close()
    except Exception as e:
        logger.warning(f"Failed to persist rate-limit cooldown: {e}")


async def search_f1_cards(
    query: str = "2025 Topps Chrome F1",
    limit: int = 200,
    sort: str = "endingSoonest",
    buying_options_filter: str = "buyingOptions:{AUCTION|FIXED_PRICE}",
) -> list[dict]:
    """Search eBay for 2025 Topps Chrome F1 cards with exponential backoff on rate limits."""
    if _is_rate_limited():
        logger.warning("eBay rate-limit cooldown active — skipping search")
        return []

    token = await get_oauth_token()
    if not token:
        logger.warning("No eBay token — returning empty results")
        return []

    _, _, sandbox = _get_credentials()
    browse_url = EBAY_SANDBOX_BROWSE_URL if sandbox else EBAY_BROWSE_URL

    params = {
        "q": query,
        "category_ids": TRADING_CARDS_CATEGORY,
        "limit": min(limit, 200),
        "filter": buying_options_filter,
        "sort": sort,
        "fieldgroups": "MATCHING_ITEMS,EXTENDED",
    }

    max_retries = 3
    backoff_seconds = [1, 2, 4]  # 1s, 2s, 4s exponential backoff

    async with httpx.AsyncClient() as client:
        for attempt in range(max_retries + 1):
            try:
                resp = await client.get(
                    browse_url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
                        "Content-Type": "application/json",
                    },
                    params=params,
                    timeout=15.0,
                )

                if resp.status_code == 200:
                    _track_api_call()
                    data = resp.json()
                    items = data.get("itemSummaries", [])
                    logger.info(f"eBay returned {len(items)} items for query: {query}")
                    return items

                elif resp.status_code in (429, 503):
                    # 429: Too Many Requests, 503: Service Unavailable
                    if attempt < max_retries:
                        wait_time = backoff_seconds[attempt]
                        logger.warning(
                            f"eBay {resp.status_code} on '{query}' (attempt {attempt + 1}/{max_retries + 1}) "
                            f"— backoff {wait_time}s before retry"
                        )
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        # Max retries exhausted, mark rate limited
                        logger.error(
                            f"eBay Browse API 429/503 exhausted retries on '{query}' "
                            f"— entering cooldown until next daily reset"
                        )
                        _mark_rate_limited_until_reset()
                        return []
                else:
                    logger.error(f"eBay Browse API error: {resp.status_code} {resp.text[:200]}")
                    return []
            except Exception as e:
                logger.error(f"eBay search error (attempt {attempt + 1}): {e}")
                return []

        return []


def parse_ebay_item(item: dict) -> dict:
    """Parse a raw eBay item summary into our internal format."""
    title = item.get("title", "")
    item_id = item.get("itemId", "")

    # Price info
    price_data = item.get("price", {})
    current_price = float(price_data.get("value", 0))

    # Buy It Now
    buy_now = None
    if "buyingOptions" in item:
        options = item["buyingOptions"]
        if "FIXED_PRICE" in options:
            buy_now = current_price

    # Auction-specific
    bid_count = item.get("bidCount", 0)

    # End time
    end_time_str = item.get("itemEndDate", "")
    end_time = None
    if end_time_str:
        try:
            end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))
        except Exception:
            pass

    # Seller
    seller = item.get("seller", {}).get("username", "unknown_seller")
    seller_feedback = item.get("seller", {}).get("feedbackScore", 0)

    # Condition
    condition = item.get("condition", "Used")

    # Image
    image_url = item.get("image", {}).get("imageUrl", "")

    # eBay URL
    ebay_url = item.get("itemWebUrl", "")

    # Shipping
    shipping_data = item.get("shippingOptions", [{}])
    shipping_cost = 0.0
    if shipping_data:
        ship = shipping_data[0]
        cost = ship.get("shippingCost", {})
        shipping_cost = float(cost.get("value", 0))

    return {
        "ebay_item_id": item_id,
        "title": title,
        "current_price": current_price,
        "buy_now_price": buy_now,
        "bid_count": bid_count,
        "end_time": end_time,
        "seller": seller,
        "seller_feedback": seller_feedback,
        "condition": condition,
        "image_url": image_url,
        "ebay_url": ebay_url,
        "shipping_cost": shipping_cost,
        "buying_options": item.get("buyingOptions", []),
    }


def _is_valid_2025_f1_listing(title: str) -> bool:
    """Return True only for 2025 Topps Chrome Formula 1 cards (not F2/F3/other years)."""
    t = title.lower()
    # Must mention 2025
    if "2025" not in t:
        return False
    # Must be F1 (Formula 1) — reject F2, F3, Indy, NASCAR, etc.
    f1_keywords = ["formula 1", "formula1", "f1", "grand prix"]
    if not any(k in t for k in f1_keywords):
        return False
    # Reject F2 / F3 specific terms
    reject = [" f2 ", " f3 ", "formula 2", "formula 3", "formula two", "formula three",
              "indycar", "nascar", "nfl", "nba", "mlb", "soccer", "football"]
    if any(k in t for k in reject):
        return False
    return True


async def fetch_all_f1_listings(limit_per_query: int = 200) -> list[dict]:
    """
    Fetch auction and BIN listings. Uses a very small query set (SEARCH_QUERIES)
    and bails out immediately on a 429 cooldown to preserve the daily quota.
    Returns parsed, de-duped, 2025-F1-only listings.
    """
    all_items = []
    seen_ids = set()

    async def _run_queries(queries, buying_filter, sort):
        results = []
        for q in queries:
            if _is_rate_limited():
                logger.warning("Aborting query loop — eBay cooldown active")
                break
            try:
                items = await search_f1_cards(q, limit_per_query, sort=sort,
                                              buying_options_filter=buying_filter)
                results.extend(items)
                await asyncio.sleep(0.5)
            except Exception as e:
                logger.warning(f"Query failed ({q}): {e}")
        return results

    # Pass 1: true auction listings sorted by ending soonest
    auction_items = await _run_queries(
        SEARCH_QUERIES, "buyingOptions:{AUCTION}", "endingSoonest"
    )
    # Pass 2: BIN listings (newly listed). Skipped entirely if rate-limited.
    bin_items = await _run_queries(
        SEARCH_QUERIES, "buyingOptions:{FIXED_PRICE}", "newlyListed"
    )

    for item in auction_items + bin_items:
        item_id = item.get("itemId", "")
        title = item.get("title", "")
        if item_id and item_id not in seen_ids and _is_valid_2025_f1_listing(title):
            seen_ids.add(item_id)
            all_items.append(parse_ebay_item(item))

    logger.info(f"fetch_all_f1_listings: {len(all_items)} unique listings across {len(SEARCH_QUERIES)} queries")
    return all_items


EBAY_ITEM_URL = "https://api.ebay.com/buy/browse/v1/item"
EBAY_SANDBOX_ITEM_URL = "https://api.sandbox.ebay.com/buy/browse/v1/item"


async def get_item_details(item_id: str) -> Optional[dict]:
    """Fetch full item details from eBay Browse API with exponential backoff on rate limits."""
    if _is_rate_limited():
        return None
    token = await get_oauth_token()
    if not token:
        return None

    _, _, sandbox = _get_credentials()
    base_url = EBAY_SANDBOX_ITEM_URL if sandbox else EBAY_ITEM_URL

    max_retries = 3
    backoff_seconds = [1, 2, 4]

    async with httpx.AsyncClient() as client:
        for attempt in range(max_retries + 1):
            try:
                resp = await client.get(
                    f"{base_url}/{item_id}",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
                        "Content-Type": "application/json",
                    },
                    timeout=15.0,
                )

                if resp.status_code == 200:
                    _track_api_call()
                    data = resp.json()
                    images = [data.get("image", {}).get("imageUrl", "")]
                    for img in data.get("additionalImages", []):
                        url = img.get("imageUrl", "")
                        if url and url not in images:
                            images.append(url)
                    images = [u for u in images if u]

                    specifics = {}
                    for spec in data.get("localizedAspects", []):
                        name = spec.get("name", "")
                        value = spec.get("value", "")
                        if name and value:
                            specifics[name] = value

                    seller = data.get("seller", {})
                    seller_feedback_pct = seller.get("feedbackPercentage")

                    return {
                        "item_id": item_id,
                        "title": data.get("title", ""),
                        "description": data.get("shortDescription", data.get("description", "")),
                        "images": images,
                        "condition": data.get("condition", ""),
                        "condition_description": data.get("conditionDescription", ""),
                        "item_specifics": specifics,
                        "seller": seller.get("username", ""),
                        "seller_feedback_score": seller.get("feedbackScore", 0),
                        "seller_feedback_pct": seller_feedback_pct,
                        "categories": [c.get("categoryName") for c in data.get("categories", [])],
                        "buying_options": data.get("buyingOptions", []),
                        "bid_count": data.get("bidCount", 0),
                        "quantity_sold": data.get("estimatedAvailabilities", [{}])[0].get("soldQuantity", 0)
                        if data.get("estimatedAvailabilities") else 0,
                        "returns_accepted": data.get("returnTerms", {}).get("returnsAccepted", False),
                        "item_location": data.get("itemLocation", {}).get("country", ""),
                        "ebay_url": data.get("itemWebUrl", ""),
                    }

                elif resp.status_code in (429, 503):
                    if attempt < max_retries:
                        wait_time = backoff_seconds[attempt]
                        logger.warning(
                            f"eBay {resp.status_code} on item {item_id} (attempt {attempt + 1}/{max_retries + 1}) "
                            f"— backoff {wait_time}s before retry"
                        )
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        logger.error(
                            f"eBay item details 429/503 exhausted retries on {item_id} "
                            f"— entering cooldown until next daily reset"
                        )
                        _mark_rate_limited_until_reset()
                        return None

                else:
                    logger.error(f"eBay item details error: {resp.status_code} {resp.text[:200]}")
                    return None

            except Exception as e:
                logger.error(f"eBay item details fetch error (attempt {attempt + 1}): {e}")
                return None

        return None


def extract_driver_from_title(title: str) -> Optional[str]:
    """Try to extract driver name from card title."""
    title_lower = title.lower()

    drivers = [
        "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
        "Fernando Alonso", "Oscar Piastri", "Carlos Sainz", "George Russell",
        "Sergio Perez", "Lance Stroll", "Valtteri Bottas", "Esteban Ocon",
        "Pierre Gasly", "Yuki Tsunoda", "Sebastian Vettel", "Kimi Raikkonen",
        "Nico Hulkenberg", "Kevin Magnussen", "Zhou Guanyu", "Alexander Albon",
        "Logan Sargeant", "Nyck de Vries", "Franco Colapinto", "Oliver Bearman",
        "Jack Doohan", "Andrea Kimi Antonelli", "Isack Hadjar",
        "Gabriel Bortoleto", "Liam Lawson", "Nico Hulkenberg",
    ]

    for driver in drivers:
        # Check full name or last name
        last = driver.split()[-1]
        if driver.lower() in title_lower or last.lower() in title_lower:
            return driver

    return None


def extract_parallel_from_title(title: str) -> str:
    """Extract card parallel/variant from title."""
    title_upper = title.upper()

    if "SUPERFRACTOR" in title_upper or "1/1" in title_upper:
        return "Superfractor 1/1"
    if "GOLD" in title_upper and "/10" in title_upper:
        return "Gold /10"
    if "RED" in title_upper and "/25" in title_upper:
        return "Red /25"
    if "ORANGE" in title_upper and "/50" in title_upper:
        return "Orange /50"
    if "GREEN" in title_upper and "/99" in title_upper:
        return "Green /99"
    if "BLUE" in title_upper and "/150" in title_upper:
        return "Blue /150"
    if "PURPLE" in title_upper and "/250" in title_upper:
        return "Purple /250"
    if "PINK" in title_upper and "/199" in title_upper:
        return "Pink /199"
    if "PRISM" in title_upper or "PRIZM" in title_upper:
        return "Prism Refractor"
    if "AUTO" in title_upper or "AUTOGRAPH" in title_upper:
        return "Autograph"
    if "REFRACTOR" in title_upper:
        return "Refractor"
    if "CHROME" in title_upper:
        return "Base Chrome"
    return "Base"


def extract_grade_from_title(title: str) -> str:
    """Extract grade info from title."""
    title_upper = title.upper()

    if "PSA 10" in title_upper:
        return "PSA 10"
    if "PSA 9" in title_upper:
        return "PSA 9"
    if "PSA 8" in title_upper:
        return "PSA 8"
    if "PSA 7" in title_upper:
        return "PSA 7"
    if "BGS 9.5" in title_upper or "BGS 9 .5" in title_upper:
        return "BGS 9.5"
    if "BGS 9" in title_upper:
        return "BGS 9"
    if "BGS 8.5" in title_upper:
        return "BGS 8.5"
    if "CGC 10" in title_upper:
        return "CGC 10"
    if "CGC 9.5" in title_upper:
        return "CGC 9.5"
    if "GRADED" in title_upper:
        return "Graded"
    return "Raw"
