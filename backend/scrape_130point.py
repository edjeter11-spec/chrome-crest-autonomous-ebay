"""
130point.com sold-comp scraper.

Uses httpx + BeautifulSoup (no Playwright — Vercel-compatible).
130point aggregates eBay sold comps and usually server-renders results
for simple GET queries. Falls back gracefully if the page is JS-only.

Upserts into SoldCard by ebay_item_id (parsed from the linked eBay URL)
or, if no eBay ID, a synthesized key derived from the 130point URL.
"""
import asyncio
import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin, urlparse, parse_qs

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from database import SoldCard, SessionLocal
from sold_ingest import _parallel_from_title, _grade_from_title, _match_driver
from ebay_api import _is_valid_2025_f1_listing

logger = logging.getLogger(__name__)

BASE_URL = "https://130point.com"
SEARCH_URL = f"{BASE_URL}/sales/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

DEFAULT_QUERIES = [
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


def _parse_date(s: str) -> Optional[datetime]:
    s = (s or "").strip()
    # common formats: "Apr 15, 2026", "2026-04-15", "04/15/2026", "2 days ago"
    if not s:
        return None
    m = re.match(r"(\d+)\s+day[s]?\s+ago", s, re.I)
    if m:
        from datetime import timedelta
        return datetime.utcnow() - timedelta(days=int(m.group(1)))
    m = re.match(r"(\d+)\s+hour[s]?\s+ago", s, re.I)
    if m:
        from datetime import timedelta
        return datetime.utcnow() - timedelta(hours=int(m.group(1)))
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _extract_ebay_item_id(url: str) -> Optional[str]:
    if not url:
        return None
    # eBay URLs embed the item id as /itm/<digits> or itm/.../<digits>
    m = re.search(r"/itm/(?:[^/]+/)?(\d{10,14})", url)
    if m:
        return m.group(1)
    # Sometimes item id appears in a query param
    try:
        qs = parse_qs(urlparse(url).query)
        for k in ("item", "itemId", "hash"):
            if k in qs:
                val = qs[k][0]
                m = re.search(r"(\d{10,14})", val)
                if m:
                    return m.group(1)
    except Exception:
        pass
    return None


async def _fetch_search(query: str, client: httpx.AsyncClient) -> str:
    """GET the 130point sales search page, try a couple URL variants."""
    candidates = [
        f"{SEARCH_URL}?search={query.replace(' ', '+')}&sort=date",
        f"{SEARCH_URL}?query={query.replace(' ', '+')}",
        f"{BASE_URL}/sales?search={query.replace(' ', '+')}",
    ]
    for url in candidates:
        try:
            resp = await client.get(url, headers=HEADERS, timeout=20.0, follow_redirects=True)
            if resp.status_code == 200 and len(resp.text) > 500:
                return resp.text
        except Exception as e:
            logger.warning(f"130point fetch {url}: {e}")
    return ""


def _parse_rows(html: str) -> list[dict]:
    """Parse sale rows out of the 130point results HTML. Resilient to layout changes."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []

    # 130point historically renders each sale as a <tr> in a sales table, or
    # as a card-style <div>. Try both.
    candidates = soup.select("tr.sale, tr.sale-row, tr[data-sale], div.sale-card, div.sale-row")
    if not candidates:
        # Fallback: any <tr> that contains a link to ebay.com
        candidates = [
            tr for tr in soup.find_all("tr")
            if tr.find("a", href=re.compile(r"ebay\.com"))
        ]
    if not candidates:
        # Final fallback: scan anchors to eBay and use their containing row/cell.
        candidates = []
        for a in soup.find_all("a", href=re.compile(r"ebay\.com/itm")):
            parent = a.find_parent(["tr", "li", "div"])
            if parent and parent not in candidates:
                candidates.append(parent)

    for el in candidates:
        try:
            ebay_a = el.find("a", href=re.compile(r"ebay\.com"))
            ebay_url = ebay_a["href"] if ebay_a else None
            if not ebay_url:
                continue
            title = (ebay_a.get_text(strip=True)
                     or (el.find(["h3", "h4", ".title"]).get_text(strip=True)
                         if el.find(["h3", "h4"]) else "")).strip()
            if not title:
                # pull the longest text cell
                texts = [t.get_text(" ", strip=True) for t in el.find_all(["td", "div", "span"])]
                texts = [t for t in texts if len(t) > 20]
                title = texts[0] if texts else ""

            # Price: look for $ amounts in the row
            price_txt = ""
            for t in el.stripped_strings:
                if "$" in t:
                    price_txt = t
                    break
            price = _price_float(price_txt)

            # Date: look for something that smells like a date
            date_txt = ""
            for t in el.stripped_strings:
                if re.search(r"(ago|\d{4}|\d{1,2}/\d{1,2})", t) and "$" not in t:
                    date_txt = t
                    break
            sale_date = _parse_date(date_txt) or datetime.utcnow()

            img = el.find("img")
            image_url = None
            if img:
                image_url = img.get("src") or img.get("data-src")
                if image_url and image_url.startswith("//"):
                    image_url = "https:" + image_url

            rows.append({
                "title": title,
                "price": price,
                "sale_date": sale_date,
                "image_url": image_url,
                "ebay_url": ebay_url,
            })
        except Exception:
            continue
    return rows


async def scrape_130point(queries: Optional[list[str]] = None) -> list[dict]:
    """Scrape all queries and return raw parsed rows (pre-filter)."""
    queries = queries or DEFAULT_QUERIES
    all_rows: list[dict] = []
    async with httpx.AsyncClient() as client:
        for i, q in enumerate(queries):
            html = await _fetch_search(q, client)
            rows = _parse_rows(html)
            logger.info(f"130point '{q}': {len(rows)} rows (html_len={len(html)})")
            all_rows.extend(rows)
            if i < len(queries) - 1:
                await asyncio.sleep(1.5)
    return all_rows


async def ingest_130point(db: Optional[Session] = None) -> dict:
    """Scrape 130point and upsert non-base 2025 Chrome F1 rows into SoldCard."""
    owns = db is None
    if owns:
        db = SessionLocal()
    added = 0
    skipped_invalid = 0
    skipped_base = 0
    skipped_dupe = 0
    skipped_no_id = 0
    errors = 0
    rows: list[dict] = []
    try:
        rows = await scrape_130point()
        for r in rows:
            title = r.get("title", "")
            if not title or not _is_valid_2025_f1_listing(title):
                skipped_invalid += 1
                continue
            parallel = _parallel_from_title(title)
            if parallel == "Base" or not parallel:
                skipped_base += 1
                continue
            price = float(r.get("price") or 0)
            if price <= 0:
                continue
            ebay_url = r.get("ebay_url") or ""
            item_id = _extract_ebay_item_id(ebay_url)
            if not item_id:
                # synthesize stable key
                item_id = f"130p-{abs(hash((title, price, r.get('sale_date'))))}"
                skipped_no_id += 1

            exists = db.query(SoldCard).filter(SoldCard.ebay_item_id == item_id).first()
            if exists:
                skipped_dupe += 1
                continue
            db.add(SoldCard(
                ebay_item_id=item_id,
                title=title,
                driver_name=_match_driver(title),
                parallel=parallel,
                grade=_grade_from_title(title),
                condition=None,
                sale_price=price,
                sale_date=r.get("sale_date") or datetime.utcnow(),
                image_url=r.get("image_url"),
                ebay_url=ebay_url,
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
                logger.error(f"130point commit failed: {e}")
                db.rollback()
                errors += 1
    finally:
        if owns:
            db.close()
    result = {
        "source": "130point",
        "rows_scraped": len(rows),
        "added": added,
        "skipped_invalid": skipped_invalid,
        "skipped_base": skipped_base,
        "skipped_dupe": skipped_dupe,
        "skipped_no_ebay_id": skipped_no_id,
        "errors": errors,
    }
    try:
        from lib.telemetry import _write as _telemetry_write
        _telemetry_write({
            "source": "130point",
            "started_at": datetime.utcnow(),
            "queries_attempted": 1,
            "queries_succeeded": 1 if rows else 0,
            "rows_seen": len(rows),
            "rows_inserted": added,
            "rows_skipped_dup": skipped_dupe,
            "blocked": (len(rows) == 0),
            "error_message": None,
        })
    except Exception:
        pass
    return result
