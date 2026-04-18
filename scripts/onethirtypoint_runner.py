"""
130point.com scraper — meta-aggregator for sold-card data.

Why this source: 130point already aggregates sales from eBay, Fanatics Collect,
Goldin, MySlabs, Pristine, and Heritage. Scraping it once gives us coverage
across multiple marketplaces in one shot — without needing to defeat each
site's individual WAF.

Search lives at https://130point.com/sales/?query=<q>&type=2 where type=2
returns sold listings.

Writes to sold_cards with source='130point'. Synthetic id = '130p-{hash}'.
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
log = logging.getLogger("130point")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

QUERIES = [
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1",
    "Topps Chrome F1 Verstappen",
    "Topps Chrome F1 Hamilton",
    "Topps Chrome F1 Norris",
    "Topps Chrome F1 Leclerc",
    "Topps Chrome F1 Piastri",
    "Topps Chrome F1 SuperFractor",
    "Topps Chrome F1 Refractor",
    "Topps Chrome F1 auto",
]

HOME = "https://130point.com/"
SEARCH = "https://130point.com/sales/"


def synthetic_id(title: str, price: float, url: str) -> str:
    payload = f"{title}|{price:.2f}|{url}"
    return f"130p-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


def get_conn():
    return psycopg2.connect(DB_URL)


def upsert_sold(conn, rows):
    if not rows:
        return 0
    deduped = {r[0]: r for r in rows}
    rows = list(deduped.values())
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


def scrape_query(page, query: str):
    # type=2 -> sold listings, sort by recent
    url = f"{SEARCH}?{urlencode({'query': query, 'type': '2'})}"
    log.info(f"130point: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(4000)
    human_dwell(page, 2.5)

    blocked, reason = detect_block(page, "130point")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass

    # 130point renders results in a table or card grid. Anchor on outbound
    # marketplace links (ebay.com, fanaticscollect.com, etc.) since those are
    # the actual sale records.
    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            const marketplacePattern = /ebay\\.com\\/itm\\/|fanaticscollect\\.com\\/|goldin\\.co\\/|myslabs\\.com\\/|pwccmarketplace\\.com\\/|pristineauction\\.com\\/|ha\\.com\\//;
            const links = document.querySelectorAll('a[href]');
            links.forEach(a => {
                const href = a.href || '';
                if (!marketplacePattern.test(href)) return;
                if (seen.has(href)) return;
                let el = a;
                for (let i = 0; i < 8 && el && el.parentElement; i++) {
                    if (el.querySelector && el.querySelector('img') && (el.textContent || '').match(/\\$\\s*[\\d,]+/)) break;
                    el = el.parentElement;
                }
                if (!el) return;
                const allText = el.textContent || '';
                let titleText = (a.getAttribute('title') || a.textContent || '').trim();
                if (!titleText || titleText.length < 8) {
                    titleText = (el.querySelector('h1,h2,h3,h4,h5')?.textContent || '').trim();
                }
                if (!titleText || titleText.length < 8) return;
                const priceMatch = allText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                if (!priceMatch) return;
                const imgEl = el.querySelector('img');
                // Sale date: "Apr 15, 2026" or "2026-04-15"
                let dateText = '';
                const dm = allText.match(/([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+20\\d{2})/);
                if (dm) dateText = dm[1];
                seen.add(href);
                out.push({
                    title: titleText,
                    price: priceMatch[0],
                    url: href,
                    image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '',
                    date_text: dateText,
                });
            });
            return out.slice(0, 200);
        }
    """)
    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"130point: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


def parse_date(s: str) -> datetime:
    if not s: return datetime.utcnow()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return datetime.utcnow()


def main():
    log.info("Starting 130point scrape run")
    started_at = datetime.utcnow()
    conn = get_conn()
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
        warm_up(page, HOME, "130point")

        for query in QUERIES:
            try:
                items, reason = scrape_query(page, query)
            except Exception as e:
                log.warning(f"130point scrape failed for {query!r}: {e}")
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
                if "f1" not in tl and "formula" not in tl:
                    continue
                price = parse_price(it["price"])
                if price <= 0:
                    continue
                grade = grade_from_title(t)
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                sale_date = parse_date(it.get("date_text", ""))
                item_id = synthetic_id(t, price, it.get("url", ""))
                rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, sale_date, it.get("image") or None, it.get("url") or None,
                    False, "F1", "130point", datetime.utcnow(),
                ))
            time.sleep(2.5)

        browser.close()

    added = upsert_sold(conn, rows)
    log.info(f"130point DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "130point", started_at,
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
        logging.exception("130point fatal: %s", e)
        sys.exit(0)
