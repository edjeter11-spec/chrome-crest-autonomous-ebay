"""
Goldin Auctions archive scraper — pulls graded 2025 Topps Chrome F1 sold
records and writes them into sold_cards with source='Goldin'.

Synthetic ebay_item_id = 'goldin-{hash}' so we reuse the existing unique
constraint for dedup.
"""
import os, re, sys, time, hashlib, logging
from datetime import datetime
from urllib.parse import urlencode

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright
try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

# Reuse title parsers from eBay scraper
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runner import (
    parallel_from_title, grade_from_title, driver_from_title, parse_price,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("goldin")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

QUERIES = [
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1 Verstappen",
    "2025 Topps Chrome F1 Hamilton",
    "2025 Topps Chrome F1 Norris",
    "2025 Topps Chrome F1 auto",
]

GOLDIN_SEARCH_URL = "https://goldin.co/search-results"


def synthetic_id(title: str, sale_date: datetime, price: float) -> str:
    payload = f"{title}|{sale_date.isoformat()[:10]}|{price:.2f}"
    return f"goldin-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


def get_conn():
    return psycopg2.connect(DB_URL)


def upsert_sold(conn, rows):
    if not rows:
        return 0
    sql = """
        INSERT INTO sold_cards (
            ebay_item_id, title, driver_name, parallel, grade, condition,
            sale_price, sale_date, image_url, ebay_url, is_auction, series,
            source, scraped_at
        ) VALUES %s
        ON CONFLICT (ebay_item_id) DO UPDATE SET
            sale_price = EXCLUDED.sale_price,
            image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url),
            scraped_at = EXCLUDED.scraped_at
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def scrape_goldin_query(page, query: str):
    url = f"{GOLDIN_SEARCH_URL}?{urlencode({'q': query})}"
    log.info(f"Goldin: {query!r} -> {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return []

    title = (page.title() or "").lower()
    if "just a moment" in title or "cloudflare" in title:
        log.warning(f"CLOUDFLARE BLOCK on Goldin for {query!r}")
        return []

    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(2500)

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            // Goldin's markup varies; try several card-container selectors.
            const cards = document.querySelectorAll(
                'article, [class*="result"], [class*="card"], [class*="lot"], li'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/item/"], a[href*="/lot/"], a[href*="/auctions/"]');
                if (!linkEl) return;
                const url = linkEl.href || '';
                if (seen.has(url)) return;
                const titleText = (el.querySelector('h2, h3, h4, [class*="title"]')?.textContent || '').trim();
                if (!titleText || titleText.length < 8) return;
                // Look for any price text inside the card
                const allText = el.textContent || '';
                const priceMatch = allText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                if (!priceMatch) return;
                const imgEl = el.querySelector('img');
                seen.add(url);
                out.push({
                    title: titleText,
                    price: priceMatch[0],
                    url,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || '') : '',
                });
            });
            return out.slice(0, 50);
        }
    """)
    return items or []


def main():
    log.info("Starting Goldin scrape run")
    conn = get_conn()
    total_rows = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = ctx.new_page()
        if HAS_STEALTH:
            try: stealth_sync(page)
            except Exception: pass

        for query in QUERIES:
            try:
                items = scrape_goldin_query(page, query)
            except Exception as e:
                log.warning(f"Goldin scrape failed for {query!r}: {e}")
                items = []
            log.info(f"  -> {len(items)} items")
            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                price = parse_price(it["price"])
                if price <= 0: continue
                grade = grade_from_title(t)
                if not grade: continue  # Only graded sales for this source
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                sale_date = datetime.utcnow()
                item_id = synthetic_id(t, sale_date, price)
                total_rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, sale_date, it.get("image") or None, it.get("url") or None,
                    True, "F1", "Goldin", datetime.utcnow(),
                ))
            time.sleep(3)

        browser.close()

    added = upsert_sold(conn, total_rows)
    conn.close()
    log.info(f"Goldin DONE: upserted {added} rows")
    return added


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("Goldin fatal: %s", e)
        sys.exit(0)  # exit 0 so other scrapers in the workflow still run
