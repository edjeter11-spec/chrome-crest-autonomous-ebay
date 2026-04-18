"""
MySlabs scraper — grabs active graded listings for 2025 Topps Chrome F1
and writes to the auctions table with seller='MySlabs'.

Phase-1 diagnosis upgrades: full stealth profile, warm-up, block detection,
telemetry.
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
log = logging.getLogger("myslabs")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

# MySlabs has limited 2025 F1 inventory but solid older Topps Chrome F1 (2020-2024).
# We pull broader F1 queries since these older graded slabs have value too.
QUERIES = [
    "topps chrome formula 1",
    "topps chrome f1",
    "verstappen topps chrome",
    "hamilton topps chrome f1",
    "norris topps chrome f1",
    "leclerc topps chrome",
    "f1 sapphire",
]

MYSLABS_HOME = "https://myslabs.com/"
# Verified: MySlabs search lives at /bin/search/all with ?search= param.
MYSLABS_BASE = "https://myslabs.com/bin/search/all"


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
    deduped = {r[1]: r for r in rows}  # ebay_listing_id at index 1
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


def scrape_myslabs_query(page, query: str):
    url = f"{MYSLABS_BASE}?{urlencode({'search': query})}"
    log.info(f"MySlabs: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(5000)
    human_dwell(page, 3.0)

    blocked, reason = detect_block(page, "MySlabs")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass

    # MySlabs slab pages live under /slab/view/{id}/. We anchor on those links.
    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            // Find every anchor pointing to a slab page; walk up to the row container.
            const links = document.querySelectorAll('a[href*="/slab/view/"]');
            links.forEach(a => {
                const href = a.href || '';
                if (seen.has(href)) return;
                // Walk up to a reasonable container (li/article/div with text + img)
                let el = a;
                for (let i = 0; i < 6 && el && el.parentElement; i++) {
                    if (el.querySelector && el.querySelector('img') && (el.textContent || '').match(/\\$\\s*[\\d,]+/)) break;
                    el = el.parentElement;
                }
                if (!el) return;
                const allText = el.textContent || '';
                // Title: prefer the link text, then look for a heading
                let titleText = (a.textContent || '').trim();
                if (!titleText || titleText.length < 8) {
                    titleText = (el.querySelector('h1,h2,h3,h4,h5')?.textContent || '').trim();
                }
                if (!titleText || titleText.length < 8) return;
                const priceMatch = allText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                if (!priceMatch) return;
                const imgEl = el.querySelector('img');
                seen.add(href);
                out.push({
                    title: titleText,
                    price: priceMatch[0],
                    url: href,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || imgEl.getAttribute('data-original') || '') : '',
                });
            });
            return out.slice(0, 100);
        }
    """)
    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"MySlabs: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


def main():
    log.info("Starting MySlabs scrape run")
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
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        ctx = build_stealth_context(browser)
        page = ctx.new_page()
        apply_stealth(page)
        warm_up(page, MYSLABS_HOME, "MySlabs")

        for query in QUERIES:
            try:
                items, reason = scrape_myslabs_query(page, query)
            except Exception as e:
                log.warning(f"MySlabs scrape failed for {query!r}: {e}")
                items, reason = [], str(e)[:120]
            if reason and not block_reason:
                block_reason = reason
            seen_count += len(items)
            if items:
                queries_succeeded += 1
            log.info(f"  -> {len(items)} items (reason: {reason or 'ok'})")
            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                tl = t.lower()
                # Filter to F1/Formula 1 only — MySlabs returns mixed sports.
                if "f1" not in tl and "formula" not in tl:
                    continue
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
    log.info(f"MySlabs DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "MySlabs", started_at,
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
        logging.exception("MySlabs fatal: %s", e)
        sys.exit(0)
