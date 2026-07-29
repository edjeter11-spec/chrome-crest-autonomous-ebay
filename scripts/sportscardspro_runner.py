"""
SportsCardsPro scraper — full set extraction + per-card sale history.

Main listing page  →  all cards in 2025 Topps Chrome F1 (+ autos, parallels).
Per-card detail    →  recent sales with real prices + dates (eBay-sourced by SCP).

SCP is PriceCharting's sports sister; data is real eBay sales, not estimates.
Synthetic id prefix 'scp-' prevents collision with real eBay item IDs.
"""
import os, re, sys, time, hashlib, logging, random
from datetime import datetime, timedelta

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runner import (
    parallel_from_title, grade_from_title, driver_from_title, parse_price,
    write_telemetry, assert_expected_db,
)
from stealth_helpers import (
    build_stealth_context, apply_stealth, warm_up, human_dwell, detect_block,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scp")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

HOME = "https://www.sportscardspro.com/"
BASE_URL = "https://www.sportscardspro.com"

# All 2025 Topps Chrome F1 pages on SCP
LISTING_PAGES = [
    ("https://www.sportscardspro.com/console/racing-cards-2025-topps-chrome-formula-1", "2025"),
    ("https://www.sportscardspro.com/console/racing-cards-2025-topps-chrome-formula-1-autograph", "2025 Auto"),
    ("https://www.sportscardspro.com/console/racing-cards-2024-topps-chrome-formula-1", "2024"),
    ("https://www.sportscardspro.com/console/racing-cards-2023-topps-chrome-formula-1", "2023"),
]

# Cap detail pages per run so we don't time out in CI
MAX_DETAIL_PAGES = int(os.environ.get("SCP_MAX_DETAIL", "80"))


def synthetic_id(url: str, grade: str, price: float, sale_date: str) -> str:
    payload = f"{url}|{grade}|{price:.2f}|{sale_date}"
    return f"scp-{hashlib.sha1(payload.encode()).hexdigest()[:16]}"


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
            scraped_at = EXCLUDED.scraped_at
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def scrape_listing_page(page, url: str):
    """Return list of {title, url, image, prices[]} from the console/listing page."""
    log.info(f"SCP listing: {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=50000)
    except Exception as e:
        log.warning(f"Listing load failed: {e}")
        return [], str(e)[:120]

    page.wait_for_timeout(3000)
    human_dwell(page, 2.0)

    blocked, reason = detect_block(page, "SCP-listing")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

    # Try to ensure full table is rendered (DataTables can lazy-load on scroll)
    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)
    except Exception:
        pass

    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();

            // Strategy: find every link to /game/ (product page), walk up to its row
            // container, pull title + all $ values in that container.
            const links = document.querySelectorAll('a[href*="/game/"]');
            links.forEach(linkEl => {
                const href = linkEl.getAttribute('href') || '';
                if (!href || !href.includes('/game/')) return;
                if (seen.has(href)) return;

                const title = (linkEl.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!title || title.length < 3) return;

                // Walk up to find the row container (tr, or div with price info)
                let row = linkEl.closest('tr');
                if (!row) row = linkEl.closest('.product, .game, [class*="row"], li');
                if (!row) row = linkEl.parentElement && linkEl.parentElement.parentElement;
                if (!row) return;

                // Grab all dollar amounts in this row
                const rowText = row.textContent || '';
                const priceMatches = rowText.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/g) || [];
                const prices = priceMatches.slice(0, 8);

                seen.add(href);
                const imgEl = row.querySelector('img');
                const fullHref = href.startsWith('http') ? href : 'https://www.sportscardspro.com' + href;
                out.push({
                    title,
                    url: fullHref,
                    image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '',
                    prices,
                });
            });

            return out;
        }
    """) or []

    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 600) : ''") or ""
        log.warning(f"SCP: 0 cards found on {url}. Body: {body[:400]!r}")

    log.info(f"  -> {len(items)} cards found")
    return items, ""


def scrape_detail_page(page, card_url: str, card_title: str):
    """
    Visit a per-card SCP page and extract the recent sales table.
    Returns list of {price, grade, condition, sale_date, buyer_condition}.
    """
    try:
        page.goto(card_url, wait_until="domcontentloaded", timeout=40000)
    except Exception as e:
        log.debug(f"Detail load failed for {card_url}: {e}")
        return []

    page.wait_for_timeout(2000 + random.randint(0, 1000))

    blocked, _ = detect_block(page, "SCP-detail")
    if blocked:
        return []

    sales = page.evaluate("""
        () => {
            const out = [];
            // SCP detail page: recent sales in #sold-items table or .price-table
            const selectors = [
                '#sold-items tbody tr',
                '.price-table tbody tr',
                'table.sold-prices tbody tr',
                '#completed-auctions tbody tr',
            ];
            let rows = [];
            for (const sel of selectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) { rows = Array.from(found); break; }
            }

            // Fallback: any table with $ values and a date column
            if (rows.length === 0) {
                document.querySelectorAll('table tr').forEach(r => {
                    const txt = r.textContent || '';
                    if (txt.includes('$') && /\\d{4}/.test(txt)) rows.push(r);
                });
            }

            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 2) return;
                const texts = cells.map(c => (c.textContent || '').trim());
                const priceCell = texts.find(t => /^\\$[\\d,]+/.test(t));
                if (!priceCell) return;
                const price = parseFloat(priceCell.replace(/[^\\d.]/g, ''));
                if (!price || price < 0.5) return;

                // Date: look for M/D/YYYY or YYYY-MM-DD or Month Day, YYYY
                let sale_date = null;
                for (const t of texts) {
                    const m1 = t.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);
                    const m2 = t.match(/(\\d{4})-(\\d{2})-(\\d{2})/);
                    const m3 = t.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\\d{1,2}),? (\\d{4})/i);
                    if (m1) { sale_date = `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`; break; }
                    if (m2) { sale_date = m2[0]; break; }
                    if (m3) {
                        const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                                        Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
                        sale_date = `${m3[3]}-${months[m3[1].slice(0,3)]}-${m3[2].padStart(2,'0')}`;
                        break;
                    }
                }
                if (!sale_date) return;

                // Grade: look for PSA 10, PSA 9, BGS, SGC, Ungraded etc.
                let grade = null;
                let condition = 'Used';
                for (const t of texts) {
                    const gm = t.match(/PSA\\s*(\\d+\\.?\\d*)|BGS\\s*(\\d+\\.?\\d*)|SGC\\s*(\\d+\\.?\\d*)/i);
                    if (gm) { grade = t.trim(); break; }
                    if (/ungraded|raw|loose/i.test(t)) { condition = 'Ungraded'; break; }
                }

                out.push({ price, sale_date, grade, condition });
            });
            return out.slice(0, 30); // cap per card
        }
    """) or []

    return sales


def build_row(item_id, title, driver, parallel, grade, condition, price, sale_date, image, url):
    dt = None
    if sale_date:
        try:
            dt = datetime.strptime(sale_date, "%Y-%m-%d")
        except Exception:
            dt = datetime.utcnow()
    else:
        dt = datetime.utcnow()
    return (
        item_id, title[:500], driver, parallel, grade, condition,
        price, dt, image or None, url or None,
        False, "F1", "SportsCardsPro", datetime.utcnow(),
    )


def enrich_title(raw_title: str, year: str) -> str:
    t = re.sub(r"\s+", " ", raw_title).strip()
    tl = t.lower()
    if "formula" not in tl and "f1" not in tl and "topps chrome" not in tl:
        t = f"{year} Topps Chrome Formula 1 {t}"
    return t


def main():
    log.info("Starting SportsCardsPro full scrape")
    assert_expected_db()
    started_at = datetime.utcnow()
    conn = get_conn()
    all_rows = []
    total_cards_seen = 0
    total_detail_scraped = 0
    pages_succeeded = 0
    block_reason = None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = build_stealth_context(browser)
        page = ctx.new_page()
        apply_stealth(page)
        warm_up(page, HOME, "SCP")

        detail_queue = []  # (card_url, card_title, year_label, image)

        # Phase 1: scrape all listing pages to get card index
        for url, year_label in LISTING_PAGES:
            try:
                items, reason = scrape_listing_page(page, url)
            except Exception as e:
                log.warning(f"Listing failed {url}: {e}")
                items, reason = [], str(e)[:120]

            if reason and not block_reason:
                block_reason = reason
            if items:
                pages_succeeded += 1
            total_cards_seen += len(items)

            for it in items:
                title = enrich_title(it["title"], year_label.split()[0])
                tl = title.lower()
                if "f1" not in tl and "formula" not in tl:
                    continue

                driver = driver_from_title(title)
                parallel = parallel_from_title(title)

                # Emit benchmark price rows from the listing (ungraded price = prices[0])
                prices = [p for p in (it.get("prices") or []) if p]
                price_tiers = [
                    ("Ungraded", None, 0),
                    ("PSA 9", "PSA 9", 1),
                    ("PSA 10", "PSA 10", 2),
                ]
                for label, grade, idx in price_tiers:
                    if idx < len(prices) and prices[idx]:
                        price = parse_price(prices[idx])
                        if price > 0:
                            sid = synthetic_id(it["url"], label, price, "benchmark")
                            full_title = f"{title} [{label}]"
                            all_rows.append(build_row(
                                sid, full_title, driver, parallel, grade, "Used",
                                price, None, it.get("image"), it.get("url"),
                            ))

                # Queue for detail page scraping
                if it.get("url"):
                    detail_queue.append((it["url"], title, it.get("image", "")))

            time.sleep(random.uniform(1.5, 3.0))

        log.info(f"Phase 1 done: {total_cards_seen} cards across {len(LISTING_PAGES)} pages")
        log.info(f"Phase 2: scraping detail pages (cap={MAX_DETAIL_PAGES})")

        # Phase 2: per-card detail pages for real sale history
        random.shuffle(detail_queue)  # prioritize diverse cards not just top of list
        for card_url, card_title, card_image in detail_queue[:MAX_DETAIL_PAGES]:
            try:
                sales = scrape_detail_page(page, card_url, card_title)
            except Exception as e:
                log.debug(f"Detail error {card_url}: {e}")
                sales = []

            if sales:
                total_detail_scraped += 1
                driver = driver_from_title(card_title)
                parallel = parallel_from_title(card_title)
                for s in sales:
                    price = s.get("price", 0)
                    if not price or price < 0.5:
                        continue
                    grade = s.get("grade")
                    condition = s.get("condition", "Used")
                    sale_date = s.get("sale_date")
                    sid = synthetic_id(card_url, grade or "raw", price, sale_date or "")
                    grade_label = grade if grade else ("Ungraded" if condition == "Ungraded" else None)
                    full_title = f"{card_title} [{grade_label or 'Ungraded'}]"
                    all_rows.append(build_row(
                        sid, full_title, driver, parallel, grade, condition,
                        price, sale_date, card_image, card_url,
                    ))

            time.sleep(random.uniform(0.8, 2.0))

        browser.close()

    added = upsert_sold(conn, all_rows)
    log.info(f"SCP DONE: {added} rows upserted | {total_cards_seen} cards seen | {total_detail_scraped} detail pages with sales")

    write_telemetry(
        conn, "SportsCardsPro", started_at,
        queries_attempted=len(LISTING_PAGES) + min(len(detail_queue), MAX_DETAIL_PAGES),
        queries_succeeded=pages_succeeded + total_detail_scraped,
        rows_seen=total_cards_seen,
        rows_inserted=added,
        blocked=(added == 0 and total_cards_seen == 0),
        error_message=block_reason,
    )
    conn.close()
    return added


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.exception("SCP fatal: %s", e)
        sys.exit(0)
