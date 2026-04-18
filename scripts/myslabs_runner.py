"""
MySlabs scraper — grabs active graded listings for 2025 Topps Chrome F1
and writes to the auctions table with seller='MySlabs'.
"""
import os, re, sys, time, hashlib, logging
from datetime import datetime, timedelta
from urllib.parse import urlencode

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright
try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runner import (
    parallel_from_title, grade_from_title, driver_from_title, parse_price,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("myslabs")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

QUERIES = [
    "2025 topps chrome f1",
    "2025 topps chrome formula 1",
    "2025 chrome f1 verstappen",
    "2025 chrome f1 norris",
    "2025 chrome f1 hamilton",
]

MYSLABS_BASE = "https://myslabs.com/cards"


def synthetic_id(url: str, title: str) -> str:
    payload = f"{url}|{title}"
    return f"myslabs-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


def get_conn():
    return psycopg2.connect(DB_URL)


def get_default_card_id(conn) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM cards ORDER BY id LIMIT 1")
        row = cur.fetchone()
        return row[0] if row else 1


def upsert_auction(conn, rows):
    if not rows:
        return 0
    sql = """
        INSERT INTO auctions (
            card_id, ebay_listing_id, title, current_price, buy_now_price,
            bid_count, end_time, seller, seller_feedback, condition,
            snipe_eligible, snipe_score, status, ebay_url, image_url,
            shipping_cost, is_real_ebay, buying_options, last_updated
        ) VALUES %s
        ON CONFLICT (ebay_listing_id) DO UPDATE SET
            current_price = EXCLUDED.current_price,
            buy_now_price = EXCLUDED.buy_now_price,
            end_time = EXCLUDED.end_time,
            image_url = COALESCE(EXCLUDED.image_url, auctions.image_url),
            last_updated = EXCLUDED.last_updated,
            status = 'active'
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def scrape_myslabs_query(page, query: str):
    url = f"{MYSLABS_BASE}?{urlencode({'search': query})}"
    log.info(f"MySlabs: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return []

    title = (page.title() or "").lower()
    if "just a moment" in title or "cloudflare" in title:
        log.warning(f"BLOCK on MySlabs for {query!r}")
        return []

    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass
    page.wait_for_timeout(2000)

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            const cards = document.querySelectorAll(
                '[class*="card-tile"], [class*="card-item"], article, .listing, li.card'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/cards/"], a[href*="/card/"], a[href*="/listing"]');
                if (!linkEl) return;
                const href = linkEl.href || '';
                if (seen.has(href)) return;
                const titleText = (el.querySelector('h2, h3, h4, [class*="title"], [class*="name"]')?.textContent || '').trim();
                if (!titleText || titleText.length < 8) return;
                const allText = el.textContent || '';
                const priceMatch = allText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                if (!priceMatch) return;
                const imgEl = el.querySelector('img');
                seen.add(href);
                out.push({
                    title: titleText,
                    price: priceMatch[0],
                    url: href,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || '') : '',
                });
            });
            return out.slice(0, 80);
        }
    """)
    return items or []


def main():
    log.info("Starting MySlabs scrape run")
    conn = get_conn()
    default_card_id = get_default_card_id(conn)
    rows = []

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
                items = scrape_myslabs_query(page, query)
            except Exception as e:
                log.warning(f"MySlabs scrape failed for {query!r}: {e}")
                items = []
            log.info(f"  -> {len(items)} items")
            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                price = parse_price(it["price"])
                if price <= 0: continue
                listing_id = synthetic_id(it["url"], t)
                end_time = datetime.utcnow() + timedelta(days=30)
                rows.append((
                    default_card_id, listing_id, t[:255], price, price,
                    0, end_time, "MySlabs", 0, "Used",
                    False, 0.0, "active", it["url"], it.get("image") or None,
                    0.0, False, '["FIXED_PRICE"]', datetime.utcnow(),
                ))
            time.sleep(3)

        browser.close()

    added = upsert_auction(conn, rows)
    conn.close()
    log.info(f"MySlabs DONE: upserted {added} rows")
    return added


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("MySlabs fatal: %s", e)
        sys.exit(0)
