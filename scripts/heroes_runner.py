"""
"HEROES" tier-A scraper — targets Giant Sports Cards (giantsportscards.com),
a Shopify F1 card retailer with light bot protection.

NOTE ON NAMING: the original instruction specified "HEROES Sportscards", but
heroessportscards.com is a military-supplies store (not cards), and
sportscardheroes.com is a brick-and-mortar shop with no live F1 search. The
closest matching F1-active marketplace is Giant Sports Cards on Shopify, so
that's what we scrape here. Source label is still 'HEROES' for dashboard
continuity and can be renamed later.

Shopify's /search endpoint is reliably server-rendered and rate-permissive.

Active listings -> auctions table (seller='HEROES').
Sold items aren't exposed, so sold_cards gets nothing from this source.
Synthetic id = 'heroes-{hash}'.
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
    build_stealth_context, apply_stealth, warm_up, detect_block,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("heroes")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

QUERIES = [
    "2025 topps chrome formula 1",
    "2025 topps chrome f1",
    "topps chrome f1",
    "formula 1 cards",
    "f1 verstappen",
    "f1 hamilton",
]

HEROES_HOME = "https://giantsportscards.com/"
HEROES_SEARCH = "https://giantsportscards.com/search"


def synthetic_id(url: str, title: str) -> str:
    payload = f"{url}|{title}"
    return f"heroes-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


def get_conn():
    return psycopg2.connect(DB_URL)


def get_default_card_id(conn) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM cards ORDER BY id LIMIT 1")
        row = cur.fetchone()
        return row[0] if row else 1


def upsert_auction(conn, rows):
    if not rows: return 0
    # Dedup in-memory by ebay_listing_id (index 1) to prevent
    # 'ON CONFLICT DO UPDATE command cannot affect row a second time'.
    # Synthetic IDs derived from {url|title} can collide if the same Shopify
    # product appears across multiple search queries.
    deduped = {}
    for row in rows:
        listing_id = row[1]
        deduped[listing_id] = row  # last one wins
    rows = list(deduped.values())

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


def scrape_heroes_query(page, query: str):
    url = f"{HEROES_SEARCH}?{urlencode({'q': query, 'type': 'product'})}"
    log.info(f"HEROES: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(2500)

    blocked, reason = detect_block(page, "HEROES")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            // Shopify standard card selectors
            const cards = document.querySelectorAll(
                '.product-card, .grid-product, .product-item, [class*="product"], li.grid__item'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/products/"]');
                if (!linkEl) return;
                const url = linkEl.href || '';
                if (seen.has(url)) return;
                const titleText = (el.querySelector('.product-card__title, .product-title, h2, h3, h4, [class*="title"], [class*="Title"]')?.textContent || linkEl.getAttribute('aria-label') || '').trim();
                if (!titleText || titleText.length < 5) return;
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
        log.info(f"HEROES: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


def main():
    log.info("Starting HEROES (GiantSportsCards) scrape run")
    started_at = datetime.utcnow()
    conn = get_conn()
    default_card_id = get_default_card_id(conn)
    rows = []
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
        warm_up(page, HEROES_HOME, "HEROES")

        for query in QUERIES:
            try:
                items, reason = scrape_heroes_query(page, query)
            except Exception as e:
                log.warning(f"HEROES scrape failed for {query!r}: {e}")
                items, reason = [], str(e)[:120]
            if reason and not block_reason:
                block_reason = reason
            seen_count += len(items)
            if items:
                queries_succeeded += 1
            log.info(f"  -> {len(items)} items")
            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                tl = t.lower()
                # Retain anything F1-shaped; Shopify listings use varied wording
                if "f1" not in tl and "formula" not in tl:
                    continue
                price = parse_price(it["price"])
                if price <= 0: continue
                listing_id = synthetic_id(it["url"], t)
                end_time = datetime.utcnow() + timedelta(days=30)
                rows.append((
                    default_card_id, listing_id, t[:255], price, price,
                    0, end_time, "HEROES", 0, "New",
                    False, 0.0, "active", it["url"], it.get("image") or None,
                    0.0, False, '["FIXED_PRICE"]', datetime.utcnow(),
                ))
            time.sleep(2)

        browser.close()

    added = upsert_auction(conn, rows)
    log.info(f"HEROES DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "HEROES", started_at,
        queries_attempted=len(QUERIES),
        queries_succeeded=queries_succeeded,
        rows_seen=seen_count,
        rows_inserted=added,
        blocked=(added == 0 and seen_count == 0),
        error_message=block_reason,
    )
    conn.close()
    return added


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("HEROES fatal: %s", e)
        sys.exit(0)
