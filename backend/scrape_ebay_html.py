"""
eBay search-results HTML scraper (no API, no quota).

DISABLED: scraping eBay HTML violates ToS and puts the eBay Partner Network
account at risk of being banned. Public entry points (ingest_ebay_html_sold
and ingest_ebay_html_auction) no-op and return
{"disabled": True, "reason": "ebay_tos_compliance"}. The original
implementations are preserved as _disabled_* below for future migration
to the Browse API (filter=soldItemsOnly) or Marketplace Insights API.

Scrapes ebay.com/sch/i.html for 2025 Topps Chrome F1 listings in two modes:
  - mode="auction"  -> live auctions (LH_Auction=1)  -> upserts Auction rows
  - mode="sold"     -> completed sold (LH_Complete=1&LH_Sold=1) -> upserts SoldCard rows

Pure httpx + BeautifulSoup so it runs on Vercel Lambda.
"""
import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from database import SoldCard, Auction, Card, SessionLocal
from sold_ingest import _parallel_from_title, _grade_from_title, _match_driver
from ebay_api import _is_valid_2025_f1_listing

logger = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)

# Full realistic Chrome navigation header set. eBay's edge (Akamai) checks for
# the presence AND ordering-consistency of Sec-Fetch-* / sec-ch-ua alongside the
# UA -- a bare UA + Accept pair is fingerprinted as a bot immediately.
HEADERS = {
    "User-Agent": _UA,
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "sec-ch-ua": '"Chromium";v="138", "Not)A;Brand";v="8", "Google Chrome";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Cache-Control": "max-age=0",
    "DNT": "1",
}

# Headers for an in-site navigation (search page reached from the homepage).
SEARCH_HEADERS = {
    **HEADERS,
    "Sec-Fetch-Site": "same-origin",
    "Referer": "https://www.ebay.com/",
}

# Markers that mean eBay served a bot challenge / login wall instead of results.
BLOCK_MARKERS = (
    "Pardon Our Interruption",
    "Checking your browser before you access eBay",
    "Sign in or Register",
    "Security Measure",
)


def _is_blocked(html: str) -> bool:
    if not html:
        return True
    head = html[:4000]
    return any(m in head for m in BLOCK_MARKERS)


async def _new_client() -> httpx.AsyncClient:
    """Build an AsyncClient with HTTP/2 (closer to a real browser's TLS/ALPN
    profile) and redirect following. Falls back to HTTP/1.1 if the `h2`
    extra isn't installed in the Lambda bundle."""
    try:
        return httpx.AsyncClient(follow_redirects=True, http2=True, timeout=25.0)
    except ImportError:
        logger.warning("httpx[http2] not installed; falling back to HTTP/1.1")
        return httpx.AsyncClient(follow_redirects=True, timeout=25.0)


async def _warm_up(client: httpx.AsyncClient) -> bool:
    """GET the eBay homepage first so the client banks the session cookies
    (dp1, nonsession, s, ebay, etc.) that /sch/i.html expects a real browser to
    already hold. Returns False if even the homepage is challenged, which means
    the source IP itself is flagged and no header tweak will help."""
    try:
        resp = await client.get("https://www.ebay.com/", headers=HEADERS)
    except Exception as e:
        logger.warning(f"eBay warm-up failed: {e}")
        return False
    if resp.status_code != 200 or _is_blocked(resp.text):
        logger.warning(
            f"eBay warm-up challenged (status={resp.status_code}); source IP is likely blocked"
        )
        return False
    logger.info(f"eBay warm-up ok, banked {len(client.cookies)} cookies")
    return True

QUERIES = [
    "2025 topps chrome f1",
    "2025 topps chrome formula 1",
    "2025 topps chrome f1 refractor",
    "2025 topps chrome f1 auto",
]


def _price_float(s: str) -> float:
    if not s:
        return 0.0
    m = re.search(r"[\d,]+\.?\d*", s.replace(",", ""))
    return float(m.group()) if m else 0.0


def _parse_time_left(txt: str) -> Optional[datetime]:
    """Parse eBay 'time left' strings like '2d 4h', '3h 12m', '45m' to an end_time."""
    if not txt:
        return None
    total = timedelta()
    for num, unit in re.findall(r"(\d+)\s*([dhm])", txt):
        n = int(num)
        if unit == "d":
            total += timedelta(days=n)
        elif unit == "h":
            total += timedelta(hours=n)
        elif unit == "m":
            total += timedelta(minutes=n)
    if total.total_seconds() <= 0:
        return None
    return datetime.utcnow() + total


def _parse_sold_date(txt: str) -> Optional[datetime]:
    txt = (txt or "").strip()
    txt = re.sub(r"^Sold\s+", "", txt, flags=re.I)
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(txt, fmt)
        except ValueError:
            continue
    return None


def _extract_item_id(url: str) -> Optional[str]:
    m = re.search(r"/itm/(?:[^/]+/)?(\d{10,14})", url or "")
    return m.group(1) if m else None


def _build_url(query: str, mode: str, page: int = 1, host: str = "www.ebay.com",
               extra: str = "") -> str:
    base = (
        f"https://{host}/sch/i.html?_nkw={query.replace(' ', '+')}"
        f"&_ipg=120&_pgn={page}"
    )
    if mode == "auction":
        base += "&LH_Auction=1"
    elif mode == "sold":
        base += "&LH_Complete=1&LH_Sold=1"
    return base + extra


def _url_variants(query: str, mode: str, page: int = 1) -> list[str]:
    """Ordered fallbacks. Desktop /sch/i.html first, then the `rt=nc&_fsrp=1`
    variant, then the mobile host -- each is defended slightly differently, so
    one may serve results when another serves a challenge."""
    return [
        _build_url(query, mode, page),
        _build_url(query, mode, page, extra="&rt=nc&_fsrp=1"),
        _build_url(query, mode, page, host="m.ebay.com"),
    ]


async def _fetch(url: str, client: httpx.AsyncClient) -> str:
    """Fetch a search page on an already-warmed client. Returns "" on a
    challenge page so callers treat it the same as an outright failure."""
    try:
        resp = await client.get(url, headers=SEARCH_HEADERS, timeout=25.0)
    except Exception as e:
        logger.warning(f"eBay HTML fetch {url}: {e}")
        return ""
    if resp.status_code != 200:
        logger.warning(f"eBay HTML {resp.status_code} for {url}")
        return ""
    if _is_blocked(resp.text):
        title = ""
        m = re.search(r"<title>(.*?)</title>", resp.text, re.S)
        if m:
            title = m.group(1).strip()[:80]
        logger.warning(f"eBay HTML challenge page for {url} (title={title!r})")
        return ""
    return resp.text


def _parse_listings(html: str, mode: str) -> list[dict]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    items: list[dict] = []

    # Old eBay layout used li.s-item; the current layout uses .s-card /
    # .su-card-container. Mirrors the selector list in scripts/scrape_runner.py.
    cards = soup.select(
        "li.s-item, .s-item__wrapper, li.s-card, .s-card, .su-card-container"
    )
    seen_ids: set[str] = set()

    for li in cards:
        try:
            a = li.select_one(
                "a.s-item__link, a.s-card__title-link, a.s-card__link, a[href*='/itm/']"
            )
            if not a:
                continue
            url = a.get("href", "")
            item_id = _extract_item_id(url)
            if not item_id:
                continue
            # Nested wrappers (.s-card inside .su-card-container) can yield the
            # same listing twice -- dedupe within the page.
            if item_id in seen_ids:
                continue
            title_el = li.select_one(
                '.s-item__title, .s-card__title, [data-testid="item-title"], h3'
            )
            title = title_el.get_text(" ", strip=True) if title_el else a.get_text(" ", strip=True)
            if not title or "Shop on eBay" in title:
                continue
            price_el = li.select_one(
                '.s-item__price, .s-card__price, [data-testid="item-price"], '
                '.su-styled-text.positive'
            )
            price = _price_float(price_el.get_text(strip=True) if price_el else "")
            if price <= 0:
                continue
            seen_ids.add(item_id)

            img_el = li.select_one("img")
            image_url = None
            if img_el:
                image_url = img_el.get("src") or img_el.get("data-src")

            bid_count = 0
            bid_el = li.select_one(".s-item__bids, .s-item__bidCount")
            if bid_el:
                m = re.search(r"(\d+)", bid_el.get_text())
                if m:
                    bid_count = int(m.group(1))

            row = {
                "item_id": item_id,
                "title": title,
                "price": price,
                "url": url.split("?")[0],
                "image_url": image_url,
                "bid_count": bid_count,
            }

            if mode == "auction":
                tl_el = li.select_one(
                    ".s-item__time-left, .s-card__time-left, .s-item__timeLeft, "
                    '[data-testid="time-left"]'
                )
                end_time = _parse_time_left(tl_el.get_text(strip=True) if tl_el else "")
                row["end_time"] = end_time
            else:
                sd_el = li.select_one(
                    ".s-item__title--tagblock .POSITIVE, .s-item__caption--row, "
                    ".s-item__ended-date, .s-item__endedDate, "
                    ".s-item__caption--signal, .s-item__listingDate, .s-card__caption"
                )
                sold_date = None
                if sd_el:
                    sold_date = _parse_sold_date(sd_el.get_text(strip=True))
                # Last-resort: scan text for "Sold  <date>"
                if not sold_date:
                    txt = li.get_text(" ", strip=True)
                    m = re.search(r"Sold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})", txt)
                    if m:
                        sold_date = _parse_sold_date(m.group(1))
                row["sale_date"] = sold_date or datetime.utcnow()

            items.append(row)
        except Exception:
            continue
    return items


async def scrape_ebay_html(mode: str = "sold", queries: Optional[list[str]] = None,
                           pages: int = 2) -> list[dict]:
    queries = queries or QUERIES
    out: list[dict] = []
    seen: set[str] = set()
    client = await _new_client()
    try:
        # Bank homepage cookies before touching /sch/i.html. If the homepage
        # itself is challenged the IP is flagged and every search will fail too,
        # so bail out immediately rather than burning the rate limit further.
        if not await _warm_up(client):
            logger.warning("eBay HTML: warm-up blocked, aborting scrape")
            return out
        await asyncio.sleep(2.0)

        for q in queries:
            for p in range(1, pages + 1):
                html = ""
                for url in _url_variants(q, mode, p):
                    html = await _fetch(url, client)
                    if html:
                        break
                    await asyncio.sleep(2.0)
                parsed = _parse_listings(html, mode)
                logger.info(f"eBay HTML {mode} '{q}' p{p}: {len(parsed)}")
                for it in parsed:
                    if it["item_id"] not in seen:
                        seen.add(it["item_id"])
                        out.append(it)
                await asyncio.sleep(2.5)
    finally:
        await client.aclose()
    return out


async def ingest_ebay_html_sold(*args, **kwargs):
    """DISABLED: scraping eBay HTML violates ToS. Use Browse API filter=soldItemsOnly or Marketplace Insights API instead."""
    return {"disabled": True, "reason": "ebay_tos_compliance"}


async def ingest_ebay_html_auction(*args, **kwargs):
    """DISABLED: scraping eBay HTML violates ToS. Use Browse API filter=soldItemsOnly or Marketplace Insights API instead."""
    return {"disabled": True, "reason": "ebay_tos_compliance"}


# --- Below: original implementations preserved for future migration to official eBay APIs ---
# Rename-preserved; these remain unreferenced until renamed/rewired through an API client.
async def _disabled_ingest_ebay_html_sold(db: Optional[Session] = None) -> dict:
    owns = db is None
    if owns:
        db = SessionLocal()
    added = 0
    skipped_invalid = 0
    skipped_base = 0
    skipped_dupe = 0
    rows: list[dict] = []
    try:
        rows = await scrape_ebay_html(mode="sold", pages=2)
        for r in rows:
            title = r["title"]
            if not _is_valid_2025_f1_listing(title):
                skipped_invalid += 1
                continue
            parallel = _parallel_from_title(title)
            if parallel == "Base" or not parallel:
                skipped_base += 1
                continue
            if db.query(SoldCard).filter(SoldCard.ebay_item_id == r["item_id"]).first():
                skipped_dupe += 1
                continue
            db.add(SoldCard(
                ebay_item_id=r["item_id"],
                title=title,
                driver_name=_match_driver(title),
                parallel=parallel,
                grade=_grade_from_title(title),
                condition=None,
                sale_price=r["price"],
                sale_date=r.get("sale_date") or datetime.utcnow(),
                image_url=r.get("image_url"),
                ebay_url=r.get("url"),
                shipping_cost=None,
                is_auction=False,
                series="F1",
                scraped_at=datetime.utcnow(),
            ))
            added += 1
        if added:
            try:
                db.commit()
            except Exception as e:
                logger.error(f"ebay_html sold commit: {e}")
                db.rollback()
    finally:
        if owns:
            db.close()
    result = {
        "source": "ebay_html_sold",
        "rows_scraped": len(rows),
        "added": added,
        "skipped_invalid": skipped_invalid,
        "skipped_base": skipped_base,
        "skipped_dupe": skipped_dupe,
    }
    try:
        from lib.telemetry import _write as _telemetry_write
        _telemetry_write({
            "source": "eBay",
            "started_at": datetime.utcnow(),
            "queries_attempted": len(QUERIES),
            "queries_succeeded": len(QUERIES) if rows else 0,
            "rows_seen": len(rows),
            "rows_inserted": added,
            "rows_skipped_dup": skipped_dupe,
            "blocked": (len(rows) == 0),
            "error_message": None,
        })
    except Exception:
        pass
    return result


async def _disabled_ingest_ebay_html_auction(db: Optional[Session] = None) -> dict:
    owns = db is None
    if owns:
        db = SessionLocal()
    added = 0
    updated = 0
    skipped_invalid = 0
    skipped_base = 0
    rows: list[dict] = []
    try:
        rows = await scrape_ebay_html(mode="auction", pages=2)
        for r in rows:
            title = r["title"]
            if not _is_valid_2025_f1_listing(title):
                skipped_invalid += 1
                continue
            parallel = _parallel_from_title(title)
            if parallel == "Base" or not parallel:
                skipped_base += 1
                continue

            driver = _match_driver(title)
            card = None
            if driver and parallel:
                card = (db.query(Card)
                        .filter(Card.driver_name == driver, Card.parallel == parallel)
                        .first())
            existing = db.query(Auction).filter(Auction.ebay_listing_id == r["item_id"]).first()
            if existing:
                existing.current_price = r["price"]
                existing.bid_count = r.get("bid_count", 0)
                existing.end_time = r.get("end_time") or existing.end_time
                existing.image_url = r.get("image_url") or existing.image_url
                existing.last_updated = datetime.utcnow()
                existing.status = "active"
                updated += 1
            else:
                db.add(Auction(
                    card_id=card.id if card else None,
                    ebay_listing_id=r["item_id"],
                    title=title,
                    current_price=r["price"],
                    buy_now_price=None,
                    bid_count=r.get("bid_count", 0),
                    end_time=r.get("end_time") or (datetime.utcnow() + timedelta(days=3)),
                    seller="",
                    seller_feedback=0,
                    condition="Used",
                    snipe_eligible=False,
                    snipe_score=0.0,
                    status="active",
                    ebay_url=r.get("url"),
                    image_url=r.get("image_url"),
                    shipping_cost=0.0,
                    is_real_ebay=True,
                    created_at=datetime.utcnow(),
                    last_updated=datetime.utcnow(),
                ))
                added += 1
        if added or updated:
            try:
                db.commit()
            except Exception as e:
                logger.error(f"ebay_html auction commit: {e}")
                db.rollback()
    finally:
        if owns:
            db.close()
    result = {
        "source": "ebay_html_auction",
        "rows_scraped": len(rows),
        "added": added,
        "updated": updated,
        "skipped_invalid": skipped_invalid,
        "skipped_base": skipped_base,
    }
    try:
        from lib.telemetry import _write as _telemetry_write
        _telemetry_write({
            "source": "eBay",
            "started_at": datetime.utcnow(),
            "queries_attempted": len(QUERIES),
            "queries_succeeded": len(QUERIES) if rows else 0,
            "rows_seen": len(rows),
            "rows_inserted": added,
            "rows_updated": updated,
            "blocked": (len(rows) == 0),
            "error_message": None,
        })
    except Exception:
        pass
    return result
