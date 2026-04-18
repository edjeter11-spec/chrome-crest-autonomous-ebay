"""
Heritage Auctions (ha.com) scraper — F1 cards in their sports/racing archive.

URL pattern (archive mode):
  https://sports.ha.com/c/search/results.zx?mode=archive&Ntt=<query>
  (sports_category=1638 loosely targets "Other Sports / Motorsports"; we
   don't hard-code category IDs since they churn — searching by text + mode=archive
   returns realized prices.)

Realized price = hammer + 20% buyer's premium. We capture "Sold for" which
already includes BP on Heritage result pages.

Writes to sold_cards with source='Heritage'. Synthetic id = 'heritage-{hash}'.
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
log = logging.getLogger("heritage")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

QUERIES = [
    "2025 Topps Chrome Formula 1",
    "Topps Chrome F1 Verstappen",
    "Topps Chrome F1 Hamilton",
    "Topps Chrome Formula 1 auto",
    "Topps Chrome F1 SuperFractor",
]

HERITAGE_HOME = "https://sports.ha.com/"
HERITAGE_SEARCH = "https://sports.ha.com/c/search/results.zx"


def synthetic_id(title: str, price: float) -> str:
    payload = f"{title}|{price:.2f}"
    return f"heritage-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


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


def scrape_heritage_query(page, query: str):
    params = {"Ntt": query, "mode": "archive", "sold_status": "1526"}
    url = f"{HERITAGE_SEARCH}?{urlencode(params)}"
    log.info(f"Heritage: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(5000)
    human_dwell(page, 3.0)

    blocked, reason = detect_block(page, "Heritage")
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
            // Heritage uses .lot-container / .search-result-row / .item
            const cards = document.querySelectorAll(
                '.lot-container, .search-result-row, .item-container, [class*="lot"], [class*="searchResult"], tr.srprow, li, article'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/itm/"], a[href*="/lot/"], a[href*="/auctions/"], a[href*=".ha.com"]');
                if (!linkEl) return;
                const url = linkEl.href || '';
                if (seen.has(url)) return;
                const titleText = (el.querySelector('.item-title, .lot-title, h2, h3, h4, [class*="title"]')?.textContent || linkEl.textContent || '').trim();
                if (!titleText || titleText.length < 8) return;

                // Heritage shows "Sold for: $X,XXX" or just "$X,XXX Realized" — capture the realized/sold amount
                const allText = el.textContent || '';
                let priceText = '';
                const sp = allText.match(/(?:sold\\s+for|realized|sold)[:\\s]*\\$\\s*([\\d,]+\\.?\\d{0,2})/i);
                if (sp) priceText = '$' + sp[1];
                else {
                    const any = allText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                    if (any) priceText = any[0];
                }
                if (!priceText) return;

                const imgEl = el.querySelector('img');
                // Heritage shows auction date like "Sunday, Jan 14, 2026"
                let dateText = '';
                const dm = allText.match(/([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+20\\d{2})/);
                if (dm) dateText = dm[1];

                seen.add(url);
                out.push({
                    title: titleText,
                    price: priceText,
                    url,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || '') : '',
                    date_text: dateText,
                });
            });
            return out.slice(0, 100);
        }
    """)

    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"Heritage: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


def parse_heritage_date(s: str) -> datetime:
    if not s: return datetime.utcnow()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return datetime.utcnow()


def main():
    log.info("Starting Heritage scrape run")
    started_at = datetime.utcnow()
    conn = get_conn()
    total_rows = []
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
        warm_up(page, HERITAGE_HOME, "Heritage")

        for query in QUERIES:
            try:
                items, reason = scrape_heritage_query(page, query)
            except Exception as e:
                log.warning(f"Heritage scrape failed for {query!r}: {e}")
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
                if "formula" not in tl and "f1" not in tl:
                    continue
                price = parse_price(it["price"])
                if price <= 0: continue
                grade = grade_from_title(t)
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                sale_date = parse_heritage_date(it.get("date_text", ""))
                item_id = synthetic_id(t, price)
                total_rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, sale_date, it.get("image") or None, it.get("url") or None,
                    True, "F1", "Heritage", datetime.utcnow(),
                ))
            time.sleep(3)

        browser.close()

    added = upsert_sold(conn, total_rows)
    log.info(f"Heritage DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "Heritage", started_at,
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
        logging.exception("Heritage fatal: %s", e)
        sys.exit(0)
