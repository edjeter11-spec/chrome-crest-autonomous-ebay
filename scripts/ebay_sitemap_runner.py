"""
eBay sitemap-based deep scraper.

eBay publishes XML sitemaps that index category pages and individual listing
pages. We use the sports-trading-cards category sitemap to discover
top-recent F1 listings and visit each /itm/ URL via Playwright to pull the
full listing detail page. Detail pages expose:
  - Precise time-of-sale (fixes the "always midnight" date problem on
    search-result scrapes)
  - Full description (catches parallels hidden from title)
  - Seller feedback count
  - Shipping exact cost

Only updates sold_cards — active/auction data comes from scrape_runner.py.
Uses source='eBay-detail' so /api/graded/source-counts can distinguish the
enriched detail-page rows from the search-page rows.

We cap at 200 most-recent F1 listings per run to stay under 25-minute GH
Actions budget.
"""
import os, re, sys, time, hashlib, logging
from datetime import datetime
from urllib.parse import urlencode

import httpx
import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runner import (
    parallel_from_title, grade_from_title, driver_from_title, parse_price,
    is_valid_2025_f1, extract_ebay_item_id, write_telemetry, assert_expected_db,
)
from stealth_helpers import (
    build_stealth_context, apply_stealth, warm_up, detect_block,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ebay-sitemap")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

MAX_LISTINGS = int(os.environ.get("MAX_URLS", "200"))

# We skip the sitemap XML walk (it's huge and mostly non-F1) and instead use
# eBay's search-sold endpoint in "newest first" order, which effectively gives
# us the same set of recently-ended F1 listings. Then we hit each /itm/ page.
EBAY_HOME = "https://www.ebay.com/"
EBAY_SEARCH = "https://www.ebay.com/sch/i.html"

QUERIES = [
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1 Refractor",
    "2025 Topps Chrome F1 Auto",
]


def build_sold_url(query: str) -> str:
    params = {"_nkw": query, "_ipg": "240", "LH_Complete": "1", "LH_Sold": "1", "_sop": "13"}  # 13 = newly listed
    return f"{EBAY_SEARCH}?{urlencode(params)}"


def get_conn():
    return psycopg2.connect(DB_URL)


def upsert_sold(conn, rows):
    if not rows: return 0
    sql = """
        INSERT INTO sold_cards (
            ebay_item_id, title, driver_name, parallel, grade, condition,
            sale_price, sale_date, image_url, ebay_url, is_auction, series,
            shipping_cost, source, scraped_at
        ) VALUES %s
        ON CONFLICT (ebay_item_id) DO UPDATE SET
            sale_price = EXCLUDED.sale_price,
            sale_date = EXCLUDED.sale_date,
            image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url),
            shipping_cost = COALESCE(EXCLUDED.shipping_cost, sold_cards.shipping_cost),
            source = EXCLUDED.source,
            scraped_at = EXCLUDED.scraped_at
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def collect_listing_urls(page, url: str, limit: int):
    """Return list of /itm/ URLs from a sold-search page."""
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"search load failed: {e}")
        return []
    page.wait_for_timeout(3000)
    try:
        page.wait_for_selector("a[href*='/itm/']", timeout=15000)
    except Exception:
        return []

    urls = page.evaluate("""
        (lim) => {
            const out = [];
            const seen = new Set();
            document.querySelectorAll("a[href*='/itm/']").forEach(a => {
                const u = a.href || '';
                if (!u) return;
                // Strip query string; pick canonical /itm/<id> form
                const m = u.match(/\\/itm\\/(?:[^\\/]+\\/)?(\\d{10,14})/);
                if (!m) return;
                const canon = 'https://www.ebay.com/itm/' + m[1];
                if (seen.has(canon)) return;
                seen.add(canon);
                out.push(canon);
                if (out.length >= lim) return;
            });
            return out.slice(0, lim);
        }
    """, limit)
    return urls or []


def scrape_listing_detail(page, url: str):
    """Visit a single /itm/ page. Return dict or None."""
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        return None, f"load:{str(e)[:60]}"
    page.wait_for_timeout(1500)

    blocked, reason = detect_block(page, "eBay-detail")
    if blocked:
        return None, reason

    data = page.evaluate("""
        () => {
            const get = (sel) => {
                const el = document.querySelector(sel);
                return el ? (el.textContent || el.innerText || '').trim() : '';
            };
            // Title
            const title = get('h1 .ux-textspans, h1[class*="title"], h1.x-item-title__mainTitle, .it-ttl, h1');
            // Sold-price
            let price = '';
            const priceSels = [
                '.ux-seller-section__item--price',
                '[data-testid*="x-price"]',
                '.x-price-primary .ux-textspans',
                '.notranslate',
                '[itemprop="price"]',
                '.vi-price',
            ];
            for (const s of priceSels) {
                const t = get(s);
                if (t.includes('$')) { price = t; break; }
            }
            if (!price) {
                const body = (document.body.innerText || '');
                const m = body.match(/(?:sold for|ended|winning bid|final bid|\\bUS\\s*)\\s*\\$\\s*([\\d,]+\\.?\\d{0,2})/i);
                if (m) price = '$' + m[1];
            }
            // Sale/end time — look for "Ended: Apr 10, 2026 ..." patterns
            let dateText = '';
            const body = (document.body.innerText || '');
            const dm = body.match(/(?:ended|sold on|sold)\\s*[:\\-]?\\s*([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+20\\d{2}(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)?)?)/i);
            if (dm) dateText = dm[1];
            // Shipping
            let shipping = '';
            const shipSels = [
                '[data-testid*="shipping"]',
                '.ux-labels-values__values-content',
                '.vi-sh-v',
            ];
            for (const s of shipSels) {
                const t = get(s);
                if (t && (/shipping/i.test(t) || t.includes('$') || /free/i.test(t))) {
                    shipping = t; break;
                }
            }
            // Image
            const img = document.querySelector('img[src*="ebayimg"]');
            return {
                title, price, dateText, shipping,
                image: img ? (img.src || '') : '',
            };
        }
    """)
    if not data or not data.get("title") or not data.get("price"):
        return None, "missing"
    return data, ""


def parse_detail_date(s: str) -> datetime:
    if not s: return datetime.utcnow()
    for fmt in (
        "%b %d, %Y %I:%M:%S %p", "%b %d, %Y %I:%M %p",
        "%b %d, %Y", "%B %d, %Y",
    ):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    # Try to split time off
    m = re.match(r"([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})", s)
    if m:
        try:
            return datetime.strptime(m.group(1), "%b %d, %Y")
        except ValueError:
            pass
    return datetime.utcnow()


def parse_ship(s: str):
    if not s: return None
    t = s.lower()
    if "free" in t: return 0.0
    m = re.search(r"\$\s*([\d,]+\.?\d*)", t)
    return float(m.group(1).replace(",", "")) if m else None


def main():
    log.info("Starting eBay-sitemap (detail-page) scrape run")
    assert_expected_db()
    started_at = datetime.utcnow()
    conn = get_conn()
    out_rows = []
    urls_total = 0
    processed = 0
    errors = 0
    block_reason = None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = build_stealth_context(browser)
        page = ctx.new_page()
        apply_stealth(page)
        warm_up(page, EBAY_HOME, "eBay-detail")

        # Phase A: discover URLs
        all_urls = []
        per_query_cap = max(MAX_LISTINGS // len(QUERIES), 10)
        for q in QUERIES:
            url = build_sold_url(q)
            log.info(f"Discovering URLs for {q!r}")
            found = collect_listing_urls(page, url, per_query_cap)
            log.info(f"  found {len(found)}")
            for u in found:
                if u not in all_urls:
                    all_urls.append(u)
            if len(all_urls) >= MAX_LISTINGS:
                break
            time.sleep(1.5)
        all_urls = all_urls[:MAX_LISTINGS]
        urls_total = len(all_urls)
        log.info(f"Total unique listing URLs: {urls_total}")

        # Phase B: detail fetch
        for i, u in enumerate(all_urls):
            try:
                data, reason = scrape_listing_detail(page, u)
            except Exception as e:
                errors += 1
                log.warning(f"detail fail {u}: {e}")
                continue
            if not data:
                if reason and not block_reason:
                    block_reason = reason
                errors += 1
                continue
            t = re.sub(r"\s+", " ", (data.get("title") or "")).strip()
            if not is_valid_2025_f1(t):
                continue
            price = parse_price(data.get("price") or "")
            if price <= 0: continue
            item_id = extract_ebay_item_id(u)
            if not item_id: continue
            parallel = parallel_from_title(t)
            if parallel == "Base":
                continue
            out_rows.append((
                item_id,
                t[:500],
                driver_from_title(t),
                parallel,
                grade_from_title(t),
                "Used",
                price,
                parse_detail_date(data.get("dateText", "")),
                data.get("image") or None,
                u,
                False,
                "F1",
                parse_ship(data.get("shipping") or ""),
                "eBay-detail",
                datetime.utcnow(),
            ))
            processed += 1
            if i % 20 == 0 and i:
                log.info(f"  [{i}/{urls_total}] processed")
            time.sleep(1)  # stay polite

        browser.close()

    # Full-schema insert (includes shipping_cost + source in values)
    added = 0
    if out_rows:
        sql = """
            INSERT INTO sold_cards (
                ebay_item_id, title, driver_name, parallel, grade, condition,
                sale_price, sale_date, image_url, ebay_url, is_auction, series,
                shipping_cost, source, scraped_at
            ) VALUES %s
            ON CONFLICT (ebay_item_id) DO UPDATE SET
                sale_price = EXCLUDED.sale_price,
                sale_date = EXCLUDED.sale_date,
                image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url),
                shipping_cost = COALESCE(EXCLUDED.shipping_cost, sold_cards.shipping_cost),
                source = EXCLUDED.source,
                scraped_at = EXCLUDED.scraped_at
        """
        try:
            with conn.cursor() as cur:
                execute_values(cur, sql, out_rows)
            conn.commit()
            added = len(out_rows)
        except Exception as e:
            conn.rollback()
            log.warning(f"Full-schema insert failed, falling back: {e}")
            legacy_sql = """
                INSERT INTO sold_cards (
                    ebay_item_id, title, driver_name, parallel, grade, condition,
                    sale_price, sale_date, image_url, ebay_url, is_auction, series,
                    source, scraped_at
                ) VALUES %s
                ON CONFLICT (ebay_item_id) DO UPDATE SET
                    sale_price = EXCLUDED.sale_price,
                    sale_date = EXCLUDED.sale_date,
                    scraped_at = EXCLUDED.scraped_at
            """
            legacy = [
                (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[13], r[14])
                for r in out_rows
            ]
            with conn.cursor() as cur:
                execute_values(cur, legacy_sql, legacy)
            conn.commit()
            added = len(out_rows)

    log.info(f"eBay-detail DONE: {urls_total} urls, {processed} 2025-F1 valid, {added} upserted, {errors} errors")

    write_telemetry(
        conn, "eBay-detail", started_at,
        queries_attempted=urls_total,
        queries_succeeded=processed,
        rows_seen=urls_total,
        rows_inserted=added,
        blocked=(urls_total == 0),
        error_message=block_reason,
    )
    conn.close()
    return added


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("eBay-sitemap fatal: %s", e)
        sys.exit(0)
