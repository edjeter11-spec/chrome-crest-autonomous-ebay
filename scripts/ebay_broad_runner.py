"""
eBay broad-query sold scraper — covers F1 driver/parallel queries that the
default scrape_runner.py doesn't hit.

Why this source: eBay is the only sold-data source we have *verified* working
end-to-end. The default scrape_runner uses ~3 generic queries; this runner
adds 25+ driver-specific and parallel-specific queries to surface F1 sales
that get missed by the broad query alone (eBay caps result pages at 240).

Writes to sold_cards with source='eBay-broad' so /api/graded/source-counts
can distinguish the broader sweep from the standard run.
Synthetic id reuses the real eBay item ID extracted from the listing URL.
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
    build_stealth_context, apply_stealth, warm_up, detect_block,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ebay-broad")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

EBAY_HOME = "https://www.ebay.com/"
EBAY_SEARCH = "https://www.ebay.com/sch/i.html"

# Targeted queries the default runner doesn't hit. Each query here typically
# returns 10-50 unique sold listings.
QUERIES = [
    # Driver-specific (top 2025 F1 grid + key rookies)
    "2025 Topps Chrome Verstappen",
    "2025 Topps Chrome Hamilton",
    "2025 Topps Chrome Norris",
    "2025 Topps Chrome Leclerc",
    "2025 Topps Chrome Piastri",
    "2025 Topps Chrome Russell",
    "2025 Topps Chrome Sainz",
    "2025 Topps Chrome Alonso",
    "2025 Topps Chrome Antonelli",
    "2025 Topps Chrome Bortoleto",
    "2025 Topps Chrome Hadjar",
    "2025 Topps Chrome Bearman",
    "2025 Topps Chrome Lawson",
    # Parallel-specific
    "2025 Topps Chrome F1 SuperFractor",
    "2025 Topps Chrome F1 Refractor",
    "2025 Topps Chrome F1 Gold /50",
    "2025 Topps Chrome F1 Orange /25",
    "2025 Topps Chrome F1 Red /5",
    "2025 Topps Chrome F1 Black /10",
    "2025 Topps Chrome F1 75th",
    "2025 Topps Chrome F1 Diamond Anniversary",
    "2025 Topps Chrome F1 Neon Nations",
    "2025 Topps Chrome F1 Vegas at Night",
    "2025 Topps Chrome F1 auto patch",
    "2025 Topps Chrome F1 PSA 10",
    # Sapphire variant
    "2025 Topps Chrome Sapphire Formula 1",
]


def build_sold_url(query: str) -> str:
    params = {
        "_nkw": query,
        "_ipg": "240",
        "LH_Complete": "1",
        "LH_Sold": "1",
        "_sop": "13",  # newly listed first
    }
    return f"{EBAY_SEARCH}?{urlencode(params)}"


EBAY_ITEM_ID_RE = re.compile(r"/itm/(?:[^/?]+/)?(\d{10,14})")


def extract_item_id(url: str) -> str | None:
    m = EBAY_ITEM_ID_RE.search(url or "")
    return m.group(1) if m else None


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
    url = build_sold_url(query)
    log.info(f"eBay-broad: {query!r}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(2500)

    blocked, reason = detect_block(page, "eBay-broad")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            const cards = document.querySelectorAll('li.s-item, .s-item');
            cards.forEach(el => {
                const linkEl = el.querySelector('a.s-item__link, a[href*="/itm/"]');
                if (!linkEl) return;
                const href = linkEl.href || '';
                if (!href.match(/\\/itm\\//)) return;
                if (seen.has(href)) return;
                const titleEl = el.querySelector('.s-item__title, [role="heading"]');
                let titleText = (titleEl ? titleEl.textContent : '').trim();
                // eBay sometimes wraps title text with "New Listing" prefix
                titleText = titleText.replace(/^new listing/i, '').trim();
                if (!titleText || titleText.length < 8) return;
                if (titleText.toLowerCase().includes('shop on ebay')) return;
                const priceEl = el.querySelector('.s-item__price');
                const priceText = priceEl ? priceEl.textContent.trim() : '';
                if (!priceText) return;
                const dateEl = el.querySelector('.s-item__title--tag, .s-item__caption--row, .s-item__ended-date');
                const dateText = dateEl ? dateEl.textContent.trim() : '';
                const imgEl = el.querySelector('.s-item__image-img, img');
                seen.add(href);
                out.push({
                    title: titleText,
                    price: priceText,
                    url: href,
                    image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '',
                    date_text: dateText,
                });
            });
            return out.slice(0, 240);
        }
    """)
    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"eBay-broad: 0 items; body: {body[:200]!r}")
    return items or [], ""


def parse_sold_date(s: str) -> datetime:
    if not s:
        return datetime.utcnow()
    m = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})", s)
    if m:
        try:
            return datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y")
        except ValueError:
            pass
    return datetime.utcnow()


def main():
    log.info("Starting eBay-broad scrape run")
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
        warm_up(page, EBAY_HOME, "eBay-broad")

        for query in QUERIES:
            try:
                items, reason = scrape_query(page, query)
            except Exception as e:
                log.warning(f"eBay-broad failed for {query!r}: {e}")
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
                # Hard F1 filter — driver names alone aren't enough
                if "f1" not in tl and "formula" not in tl and "topps chrome" not in tl:
                    continue
                price = parse_price(it["price"])
                if price <= 0:
                    continue
                item_id = extract_item_id(it["url"])
                if not item_id:
                    # Synthetic fallback
                    item_id = "ebroad-" + hashlib.sha1(f"{t}|{price}".encode()).hexdigest()[:16]
                grade = grade_from_title(t)
                parallel = parallel_from_title(t)
                driver = driver_from_title(t)
                sale_date = parse_sold_date(it.get("date_text", ""))
                rows.append((
                    item_id, t[:500], driver, parallel, grade, "Used",
                    price, sale_date, it.get("image") or None, it.get("url") or None,
                    False, "F1", "eBay-broad", datetime.utcnow(),
                ))
            time.sleep(1.5)

        browser.close()

    added = upsert_sold(conn, rows)
    log.info(f"eBay-broad DONE: upserted {added} rows (seen {seen_count})")

    write_telemetry(
        conn, "eBay-broad", started_at,
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
        logging.exception("eBay-broad fatal: %s", e)
        sys.exit(0)
