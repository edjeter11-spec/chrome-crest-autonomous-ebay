"""
eBay Finding API — fetches COMPLETED (sold) listings via findCompletedItems.
Uses App ID only — no OAuth token required.
Returns up to 3 pages × 100 items per driver query.
"""
import os
import httpx
import asyncio
from datetime import datetime, timezone
from typing import Optional
import logging

logger = logging.getLogger(__name__)

FINDING_API_URL = "https://svcs.ebay.com/services/search/FindingService/v1"


def _app_id() -> str:
    return os.getenv("EBAY_APP_ID", "")


async def _find_completed_items(keywords: str, page: int = 1) -> list[dict]:
    """Single page call to findCompletedItems. Returns parsed sold listings."""
    app_id = _app_id()
    if not app_id:
        return []

    params = {
        "OPERATION-NAME": "findCompletedItems",
        "SERVICE-VERSION": "1.0.0",
        "SECURITY-APPNAME": app_id,
        "RESPONSE-DATA-FORMAT": "JSON",
        "REST-PAYLOAD": "",
        "keywords": keywords,
        "categoryId": "212",
        "itemFilter(0).name": "SoldItemsOnly",
        "itemFilter(0).value": "true",
        "paginationInput.entriesPerPage": "100",
        "paginationInput.pageNumber": str(page),
        "sortOrder": "EndTimeSoonest",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(FINDING_API_URL, params=params)
            if resp.status_code != 200:
                logger.error(f"Finding API {resp.status_code}: {resp.text[:200]}")
                return []

            data = resp.json()
            resp_root = data.get("findCompletedItemsResponse", [{}])[0]

            ack = resp_root.get("ack", [""])[0]
            if ack not in ("Success", "Warning"):
                logger.warning(f"Finding API ack={ack} for '{keywords}' p{page}")
                return []

            items_raw = resp_root.get("searchResult", [{}])[0].get("item", [])
            parsed = []
            for item in items_raw:
                try:
                    item_id = item.get("itemId", [""])[0]
                    title = item.get("title", [""])[0]

                    selling = item.get("sellingStatus", [{}])[0]
                    price_raw = selling.get("currentPrice", [{}])[0]
                    price = float(price_raw.get("__value__", 0))

                    listing_info = item.get("listingInfo", [{}])[0]
                    end_str = listing_info.get("endTime", [""])[0]
                    sale_date = None
                    if end_str:
                        sale_date = datetime.fromisoformat(
                            end_str.replace("Z", "+00:00")
                        ).astimezone(timezone.utc).replace(tzinfo=None)

                    cond_list = item.get("condition", [{}])[0]
                    condition = cond_list.get("conditionDisplayName", ["Used"])[0]

                    if price > 0 and sale_date and item_id:
                        parsed.append({
                            "ebay_item_id": item_id,
                            "title": title,
                            "price": price,
                            "sale_date": sale_date,
                            "condition": condition,
                        })
                except Exception:
                    continue

            logger.info(f"Finding API: {len(parsed)} sold for '{keywords}' p{page}")
            return parsed

        except Exception as e:
            logger.error(f"Finding API error '{keywords}' p{page}: {e}")
            return []


async def _find_items_advanced(keywords: str, page: int = 1, active_only: bool = True) -> list[dict]:
    """
    Single page call to findItemsAdvanced — returns ACTIVE listings (auctions + BIN).
    Parallel API to findCompletedItems, same App ID, separate quota from Browse.
    """
    app_id = _app_id()
    if not app_id:
        return []
    params = {
        "OPERATION-NAME": "findItemsAdvanced",
        "SERVICE-VERSION": "1.0.0",
        "SECURITY-APPNAME": app_id,
        "RESPONSE-DATA-FORMAT": "JSON",
        "REST-PAYLOAD": "",
        "keywords": keywords,
        "categoryId": "212",
        "paginationInput.entriesPerPage": "100",
        "paginationInput.pageNumber": str(page),
        "sortOrder": "EndTimeSoonest",
    }
    if active_only:
        params["itemFilter(0).name"] = "ListingType"
        params["itemFilter(0).value(0)"] = "Auction"
        params["itemFilter(0).value(1)"] = "AuctionWithBIN"
        params["itemFilter(0).value(2)"] = "FixedPrice"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(FINDING_API_URL, params=params)
            if resp.status_code != 200:
                logger.error(f"findItemsAdvanced {resp.status_code}: {resp.text[:200]}")
                return []
            data = resp.json()
            root = data.get("findItemsAdvancedResponse", [{}])[0]
            if root.get("ack", [""])[0] not in ("Success", "Warning"):
                return []
            items_raw = root.get("searchResult", [{}])[0].get("item", [])
            parsed = []
            for item in items_raw:
                try:
                    item_id = item.get("itemId", [""])[0]
                    title = item.get("title", [""])[0]
                    selling = item.get("sellingStatus", [{}])[0]
                    price = float(selling.get("currentPrice", [{}])[0].get("__value__", 0))
                    bid_count = int(selling.get("bidCount", ["0"])[0])
                    listing_info = item.get("listingInfo", [{}])[0]
                    end_str = listing_info.get("endTime", [""])[0]
                    listing_type = listing_info.get("listingType", [""])[0]
                    end_time = None
                    if end_str:
                        end_time = datetime.fromisoformat(
                            end_str.replace("Z", "+00:00")
                        ).astimezone(timezone.utc).replace(tzinfo=None)
                    gallery = item.get("galleryURL", [None])[0]
                    view_url = item.get("viewItemURL", [None])[0]
                    if price > 0 and item_id:
                        parsed.append({
                            "ebay_item_id": item_id,
                            "title": title,
                            "price": price,
                            "bid_count": bid_count,
                            "end_time": end_time,
                            "listing_type": listing_type,
                            "image_url": gallery,
                            "ebay_url": view_url,
                        })
                except Exception:
                    continue
            return parsed
        except Exception as e:
            logger.error(f"findItemsAdvanced '{keywords}' p{page}: {e}")
            return []


async def fetch_active_for_query(keywords: str, pages: int = 2) -> list[dict]:
    all_items: list[dict] = []
    seen: set[str] = set()
    for p in range(1, pages + 1):
        items = await _find_items_advanced(keywords, page=p)
        for it in items:
            if it["ebay_item_id"] not in seen:
                seen.add(it["ebay_item_id"])
                all_items.append(it)
        if p < pages:
            await asyncio.sleep(1.0)
    return all_items


async def fetch_sold_for_query(keywords: str, pages: int = 2) -> list[dict]:
    """Generic keyword sold fetch (not driver-specific)."""
    all_items: list[dict] = []
    seen: set[str] = set()
    for p in range(1, pages + 1):
        items = await _find_completed_items(keywords, page=p)
        for it in items:
            if it["ebay_item_id"] not in seen:
                seen.add(it["ebay_item_id"])
                all_items.append(it)
        if p < pages:
            await asyncio.sleep(1.0)
    return all_items


async def fetch_sold_for_driver(driver_name: str, pages: int = 3) -> list[dict]:
    """
    Fetch up to pages×100 sold listings for one driver (all parallels).
    Runs pages sequentially with a 1 s gap to respect Finding API rate limits.
    """
    last_name = driver_name.split()[-1]
    keywords = f"2025 Topps Chrome F1 {last_name}"

    all_items: list[dict] = []
    seen: set[str] = set()

    for p in range(1, pages + 1):
        items = await _find_completed_items(keywords, page=p)
        for item in items:
            iid = item["ebay_item_id"]
            if iid not in seen:
                seen.add(iid)
                all_items.append(item)
        if p < pages:
            await asyncio.sleep(1.0)  # Finding API burst limit: 1 req/s safe

    return all_items
