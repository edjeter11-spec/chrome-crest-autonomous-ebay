"""
Fanatics Collect (fanaticscollect.com) scraper.

Writes:
  - Active listings -> auctions table (seller='Fanatics Collect')
  - Sold listings  -> sold_cards (source='Fanatics Collect')

URL patterns:
  Active: https://www.fanaticscollect.com/search?query=<q>
  Sold:   https://www.fanaticscollect.com/marketplace/sold?query=<q>
          (will try both; whichever renders results wins)

Synthetic id = 'fanatics-{hash}'.
"""
import os, re, sys, time, hashlib, logging
from datetime import datetime, timedelta
from urllib.parse import urlencode

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runner import (
    parallel_from_title, grade_from_title, driver_from_title, parse_price,
    write_telemetry,
)
from stealth_helpers import (
    build_stealth_context, apply_stealth, warm_up, human_dwell, detect_block,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("fanatics")

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
    "Topps Chrome F1 SuperFractor",
]

FANATICS_HOME = "https://www.fanaticscollect.com/"
FANATICS_ACTIVE = "https://www.fanaticscollect.com/search"
FANATICS_SOLD = "https://www.fanaticscollect.com/marketplace/sold"


def synthetic_id(url: str, title: str, price: float) -> str:
    payload = f"{url}|{title}|{price:.2f}"
    return f"fanatics-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


def get_conn():
    return psycopg2.connect(DB_URL)


def get_default_card_id(conn) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM cards ORDER BY id LIMIT 1")
        row = cur.fetchone()
        return row[0] if row else 1


def upsert_sold(conn, rows):
    if not rows: return 0
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


def upsert_auction(conn, rows):
    if not rows: return 0
    sql = """
        INSERT INTO auctions (
            card_id, ebay_listing_id, title, current_price, buy_now_price,
            bid_count, end_time, seller, seller_feedback, condition,
            snipe_eligible, snipe_score, status, ebay_url, image_url,
            shipping_cost, is_real_ebay, buying_options, last_updated
        ) VALUES %s
        ON CONFLICT (ebay_listing_id) DO UPDATE SET
            current_price = EXCLUDED.current_price,
            end_time = EXCLUDED.end_time,
            image_url = COALESCE(EXCLUDED.image_url, auctions.image_url),
            last_updated = EXCLUDED.last_updated,
            status = 'active'
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def scrape_fanatics_page(page, url: str, label: str):
    log.info(f"Fanatics [{label}]: {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(5000)
    human_dwell(page, 3.0)

    blocked, reason = detect_block(page, f"Fanatics-{label}")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            const cards = document.querySelectorAll(
                '[data-testid*="listing"], [data-testid*="card"], [class*="ListingCard"], [class*="listing-card"], [class*="card"], article, li'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/listing"], a[href*="/item"], a[href*="/marketplace"]');
                if (!linkEl) return;
                const url = linkEl.href || '';
                if (seen.has(url)) return;
                const titleText = (el.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]')?.textContent || linkEl.textContent || '').trim();
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
            return out.slice(0, 100);
        }
    """)
    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"Fanatics [{label}]: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


def main():
    log.info("Starting Fanatics Collect scrape run")
    started_at = datetime.utcnow()
    conn = get_conn()
    default_card_id = get_default_card_id(conn)

    sold_rows = []
    active_rows = []
    seen_count = 0
    queries_succeeded = 0
    block_reason = None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = build_stealth_context(browser)
        page = ctx.new_page()
        apply_stealth(page)
        warm_up(page, FANATICS_HOME, "Fanatics")

        for query in QUERIES:
            # Try active
            active_url = f"{FANATICS_ACTIVE}?{urlencode({'query': query})}"
            try:
                items_a, reason_a = scrape_fanatics_page(page, active_url, "active")
            except Exception as e:
                items_a, reason_a = [], str(e)[:120]

            # Try sold
            sold_url = f"{FANATICS_SOLD}?{urlencode({'query': query})}"
            try:
                items_s, reason_s = scrape_fanatics_page(page, sold_url, "sold")
            except Exception as e:
                items_s, reason_s = [], str(e)[:120]

            reason = reason_a or reason_s
            if reason and not block_reason:
                block_reason = reason
            seen_count += len(items_a) + len(items_s)
            if items_a or items_s:
                queries_succeeded += 1

            # Process active -> auctions
            for it in items_a:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                price = parse_price(it["price"])
                if price <= 0: continue
                listing_id = synthetic_id(it["url"], t, price)
                end_time = datetime.utcnow() + timedelta(days=14)
                active_rows.append((
                    default_card_id, listing_id, t[:255], price, None,
                    0, end_time, "Fanatics Collect", 0, "Used",
                    False, 0.0, "active", it["url"], it.get("image") or None,
                    0.0, False, '["FIXED_PRICE"]', datetime.utcnow(),
                ))

            # Process sold -> sold_cards
            for it in items_s:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                tl = t.lower()
                if "2025" not in tl and "formula" not in tl and "f1" not in tl:
                    continue
                price = parse_price(it["price"])
                if price <= 0: continue
                grade = grade_from_title(t)
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                item_id = synthetic_id(it["url"], t, price)
                sold_rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, datetime.utcnow(), it.get("image") or None, it.get("url") or None,
                    False, "F1", "Fanatics Collect", datetime.utcnow(),
                ))

            time.sleep(3)

        browser.close()

    added_active = upsert_auction(conn, active_rows)
    added_sold = upsert_sold(conn, sold_rows)
    log.info(f"Fanatics DONE: sold {added_sold}, active {added_active} (seen {seen_count})")

    write_telemetry(
        conn, "Fanatics Collect", started_at,
        queries_attempted=len(QUERIES) * 2,
        queries_succeeded=queries_succeeded,
        rows_seen=seen_count,
        rows_inserted=added_sold + added_active,
        blocked=(added_sold + added_active == 0 and seen_count == 0),
        error_message=block_reason,
    )
    conn.close()
    return added_sold + added_active


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("Fanatics fatal: %s", e)
        sys.exit(0)
