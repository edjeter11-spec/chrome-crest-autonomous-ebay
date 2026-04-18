"""
Mavin.io scraper — aggregates eBay sold prices with a clean public search.

URL pattern: https://mavin.io/search?q=<query>&bt=sold
(Mavin uses bt=sold to filter to sold results.)

Writes to sold_cards with source='Mavin'. Synthetic id = 'mavin-{hash}'.

NOTE: Mavin may have been shuttered (late 2025 reports). This scraper will
detect a dead page (no results + no block) and record that in telemetry.
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
log = logging.getLogger("mavin")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

QUERIES = [
    "2025 Topps Chrome F1",
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1 Verstappen",
    "2025 Topps Chrome F1 Hamilton",
    "2025 Topps Chrome F1 Norris",
    "2025 Topps Chrome F1 Leclerc",
    "2025 Topps Chrome F1 Piastri",
    "2025 Topps Chrome F1 Russell",
    "2025 Topps Chrome F1 auto",
    "2025 Topps Chrome F1 Refractor",
]

MAVIN_HOME = "https://mavin.io/"
MAVIN_BASE = "https://mavin.io/search"


def synthetic_id(title: str, price: float) -> str:
    payload = f"{title}|{price:.2f}"
    return f"mavin-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


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


def scrape_mavin_query(page, query: str):
    url = f"{MAVIN_BASE}?{urlencode({'q': query, 'bt': 'sold'})}"
    log.info(f"Mavin: {query!r} -> {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(4000)
    human_dwell(page, 2.5)

    blocked, reason = detect_block(page, "Mavin")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            // Mavin puts results in card-like containers; try a few generic selectors
            const cards = document.querySelectorAll(
                '[class*="result"], [class*="card"], [class*="item"], [class*="listing"], article, li'
            );
            cards.forEach(el => {
                const linkEl = el.querySelector('a[href*="/item"], a[href*="/listing"], a[href*="ebay"]');
                if (!linkEl) return;
                const href = linkEl.href || '';
                if (seen.has(href)) return;
                const titleEl = el.querySelector('h2, h3, h4, [class*="title"]');
                const titleText = (titleEl?.textContent || linkEl.textContent || '').trim();
                if (!titleText || titleText.length < 8) return;
                const allText = el.textContent || '';
                const priceMatch = allText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                if (!priceMatch) return;
                const imgEl = el.querySelector('img');
                // Capture "sold" date if present, e.g. "Sold Apr 10, 2026" or "2026-04-10"
                let dateText = '';
                const dm = allText.match(/sold[:\\s]+([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4})/i);
                if (dm) dateText = dm[1];
                seen.add(href);
                out.push({
                    title: titleText,
                    price: priceMatch[0],
                    url: href,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || '') : '',
                    date_text: dateText,
                });
            });
            return out.slice(0, 100);
        }
    """)

    if not items:
        # Dump a preview so we can tell live-but-empty from JS-failure
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"Mavin: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


def parse_mavin_date(s: str) -> datetime:
    if not s: return datetime.utcnow()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return datetime.utcnow()


def main():
    log.info("Starting Mavin scrape run")
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
        warm_up(page, MAVIN_HOME, "Mavin")

        for query in QUERIES:
            try:
                items, reason = scrape_mavin_query(page, query)
            except Exception as e:
                log.warning(f"Mavin scrape failed for {query!r}: {e}")
                items, reason = [], str(e)[:120]
            if reason and not block_reason:
                block_reason = reason
            seen_count += len(items)
            if items:
                queries_succeeded += 1
            log.info(f"  -> {len(items)} items")
            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                # Only keep 2025 F1 (prevent category bleed from Mavin's broader index)
                tl = t.lower()
                if "2025" not in tl or ("f1" not in tl and "formula" not in tl and "chrome" not in tl):
                    continue
                price = parse_price(it["price"])
                if price <= 0: continue
                grade = grade_from_title(t)
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                sale_date = parse_mavin_date(it.get("date_text", ""))
                item_id = synthetic_id(t, price)
                total_rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, sale_date, it.get("image") or None, it.get("url") or None,
                    False, "F1", "Mavin", datetime.utcnow(),
                ))
            time.sleep(2.5)

        browser.close()

    added = upsert_sold(conn, total_rows)
    log.info(f"Mavin DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "Mavin", started_at,
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
        logging.exception("Mavin fatal: %s", e)
        sys.exit(0)
