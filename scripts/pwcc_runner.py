"""
PWCC Marketplace scraper — pulls graded 2025 Topps Chrome F1 sold records
and writes into sold_cards with source='PWCC'. Synthetic id = 'pwcc-{hash}'.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runner import (
    parallel_from_title, grade_from_title, driver_from_title, parse_price,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pwcc")

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

PWCC_BASE = "https://www.pwccmarketplace.com/search"


def synthetic_id(title: str, sale_date: datetime, price: float) -> str:
    payload = f"{title}|{sale_date.isoformat()[:10]}|{price:.2f}"
    return f"pwcc-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


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


def scrape_pwcc_query(page, query: str):
    url = f"{PWCC_BASE}?{urlencode({'q': query})}"
    log.info(f"PWCC: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return []

    title = (page.title() or "").lower()
    if "just a moment" in title or "cloudflare" in title or "access denied" in title:
        log.warning(f"BLOCK on PWCC for {query!r}: {title[:80]}")
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
            const cards = document.querySelectorAll(
                'article, [data-testid*="result"], [class*="ListingCard"], [class*="SearchResult"], [class*="card"], li'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/item"], a[href*="/listing"], a[href*="/auction"]');
                if (!linkEl) return;
                const url = linkEl.href || '';
                if (seen.has(url)) return;
                const titleText = (el.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]')?.textContent || '').trim();
                if (!titleText || titleText.length < 8) return;
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
    log.info("Starting PWCC scrape run")
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
                items = scrape_pwcc_query(page, query)
            except Exception as e:
                log.warning(f"PWCC scrape failed for {query!r}: {e}")
                items = []
            log.info(f"  -> {len(items)} items")
            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                price = parse_price(it["price"])
                if price <= 0: continue
                grade = grade_from_title(t)
                if not grade: continue
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                sale_date = datetime.utcnow()
                item_id = synthetic_id(t, sale_date, price)
                total_rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, sale_date, it.get("image") or None, it.get("url") or None,
                    True, "F1", "PWCC", datetime.utcnow(),
                ))
            time.sleep(3)

        browser.close()

    added = upsert_sold(conn, total_rows)
    conn.close()
    log.info(f"PWCC DONE: upserted {added} rows")
    return added


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("PWCC fatal: %s", e)
        sys.exit(0)
