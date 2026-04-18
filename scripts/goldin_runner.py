"""
Goldin Auctions archive scraper — pulls graded 2025 Topps Chrome F1 sold
records and writes them into sold_cards with source='Goldin'.

Synthetic ebay_item_id = 'goldin-{hash}' so we reuse the existing unique
constraint for dedup.

Phase-1 diagnosis upgrades (2026-04):
  - Stronger stealth profile via scripts/stealth_helpers
  - Homepage warm-up + cookie accept + human dwell before search
  - Block detection with screenshot + body-preview dumped to logs
  - Telemetry via scraper_runs table
"""
import os, re, sys, time, hashlib, logging
from datetime import datetime
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

GOLDIN_HOME = "https://goldin.co/"
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
        return [], "timeout"

    page.wait_for_timeout(5000)  # initial dwell
    human_dwell(page, 3.0)

    blocked, reason = detect_block(page, "Goldin")
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
                'article, [class*="result"], [class*="card"], [class*="lot"], [class*="Item"], li'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/item/"], a[href*="/lot/"], a[href*="/auctions/"]');
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
            return out.slice(0, 100);
        }
    """)
    return items or [], ""


def main():
    log.info("Starting Goldin scrape run")
    started_at = datetime.utcnow()
    conn = get_conn()
    total_rows = []
    seen_count = 0
    queries_succeeded = 0
    block_reason = None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        ctx = build_stealth_context(browser)
        page = ctx.new_page()
        apply_stealth(page)
        warm_up(page, GOLDIN_HOME, "Goldin")

        for query in QUERIES:
            try:
                items, reason = scrape_goldin_query(page, query)
            except Exception as e:
                log.warning(f"Goldin scrape failed for {query!r}: {e}")
                items, reason = [], str(e)[:120]
            if reason and not block_reason:
                block_reason = reason
            seen_count += len(items)
            if items:
                queries_succeeded += 1
            log.info(f"  -> {len(items)} items (reason: {reason or 'ok'})")
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
                    True, "F1", "Goldin", datetime.utcnow(),
                ))
            time.sleep(3)

        browser.close()

    added = upsert_sold(conn, total_rows)
    log.info(f"Goldin DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "Goldin", started_at,
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
        logging.exception("Goldin fatal: %s", e)
        sys.exit(0)
