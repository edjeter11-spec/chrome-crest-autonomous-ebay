"""
SportsCardsPro (sister site of PriceCharting) scraper.

Why this source: SportsCardsPro publishes a dedicated price guide page for the
2025 Topps Chrome Formula 1 set (and the autograph subset). Each row contains
ungraded + PSA-graded prices derived from real eBay sales — perfect for
seeding our sold_cards index with reliable benchmark prices.

Verified URLs:
  https://www.sportscardspro.com/console/racing-cards-2025-topps-chrome-formula-1
  https://www.sportscardspro.com/console/racing-cards-2025-topps-chrome-formula-1-autograph

Each card row is rendered server-side in a table (#games_table or similar).
Per-card detail pages expose recent sales transactions.

Writes one synthetic sold_cards row per card per grade tier with
source='SportsCardsPro'. Synthetic id = 'scp-{hash}'.
"""
import os, re, sys, time, hashlib, logging
from datetime import datetime

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
log = logging.getLogger("scp")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

# Confirmed-existing pages on sportscardspro.com (verified via search results).
PAGES = [
    ("https://www.sportscardspro.com/console/racing-cards-2025-topps-chrome-formula-1", "Base"),
    ("https://www.sportscardspro.com/console/racing-cards-2025-topps-chrome-formula-1-autograph", "Autograph"),
    ("https://www.sportscardspro.com/console/racing-cards-2024-topps-chrome-formula-1", "Base"),
    ("https://www.sportscardspro.com/console/racing-cards-2023-topps-chrome-formula-1", "Base"),
]

HOME = "https://www.sportscardspro.com/"


def synthetic_id(title: str, grade: str, price: float) -> str:
    payload = f"{title}|{grade}|{price:.2f}"
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
            image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url),
            scraped_at = EXCLUDED.scraped_at
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def scrape_page(page, url: str, default_parallel: str):
    log.info(f"SCP: {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        log.warning(f"Page load failed: {e}")
        return [], "timeout"

    page.wait_for_timeout(3000)
    human_dwell(page, 2.0)

    blocked, reason = detect_block(page, "SCP")
    if blocked:
        return [], reason

    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

    # SCP uses a #games_table with rows: title link + ungraded price + grade-9 + grade-10 prices.
    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            // Try table rows first
            const rows = document.querySelectorAll('table tr, #games_table tr, .product, [class*="product-row"]');
            rows.forEach(row => {
                const linkEl = row.querySelector('a[href*="/game/"], a[href*="/console/"], a.title');
                if (!linkEl) return;
                const href = linkEl.href || '';
                const titleText = (linkEl.textContent || '').trim();
                if (!titleText || titleText.length < 5) return;
                const cells = row.querySelectorAll('td');
                // Collect every $-shaped value in row order
                const prices = [];
                cells.forEach(td => {
                    const m = (td.textContent || '').match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/g);
                    if (m) m.forEach(p => prices.push(p));
                });
                if (prices.length === 0) {
                    const all = (row.textContent || '').match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/g);
                    if (all) all.forEach(p => prices.push(p));
                }
                if (prices.length === 0) return;
                const imgEl = row.querySelector('img');
                const key = href + '|' + titleText;
                if (seen.has(key)) return;
                seen.add(key);
                out.push({
                    title: titleText,
                    url: href,
                    image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '',
                    prices: prices.slice(0, 5),  // ungraded, grade-7/8, 9, 9.5, 10
                });
            });
            return out.slice(0, 300);
        }
    """)
    if not items:
        body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : ''") or ""
        log.info(f"SCP: 0 items; body preview: {body[:300]!r}")
    return items or [], ""


# Heuristic: SCP table column layout is typically [title, ungraded, grade-7-or-loose, grade-8, grade-9, grade-9.5, grade-10]
# We map by index. Different pages may vary; we keep ungraded + grade 9 + grade 10 (the most-traded tiers).
PRICE_TIER_MAP = [
    ("Ungraded", None),
    ("PSA 9", "PSA 9"),
    ("PSA 10", "PSA 10"),
]


def main():
    log.info("Starting SportsCardsPro scrape run")
    started_at = datetime.utcnow()
    conn = get_conn()
    rows = []
    seen_count = 0
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

        for url, default_parallel in PAGES:
            try:
                items, reason = scrape_page(page, url, default_parallel)
            except Exception as e:
                log.warning(f"SCP scrape failed for {url}: {e}")
                items, reason = [], str(e)[:120]
            if reason and not block_reason:
                block_reason = reason
            seen_count += len(items)
            if items:
                pages_succeeded += 1
            log.info(f"  -> {len(items)} cards")

            for it in items:
                t = re.sub(r"\s+", " ", it["title"]).strip()
                # Stamp the year/set into the title so existing F1 filters pass downstream.
                if "formula" not in t.lower() and "f1" not in t.lower():
                    # Add set context from the URL
                    if "2025" in url:
                        t = f"2025 Topps Chrome Formula 1 {t}"
                    elif "2024" in url:
                        t = f"2024 Topps Chrome Formula 1 {t}"
                    elif "2023" in url:
                        t = f"2023 Topps Chrome Formula 1 {t}"
                tl = t.lower()
                if "f1" not in tl and "formula" not in tl:
                    continue

                driver = driver_from_title(t)
                parallel = parallel_from_title(t)
                if parallel == "Base" and default_parallel != "Base":
                    parallel = default_parallel

                # Emit one row per known price tier (ungraded + PSA9 + PSA10).
                tiers = []
                for i, (label, grade) in enumerate(PRICE_TIER_MAP):
                    if i < len(it["prices"]):
                        price = parse_price(it["prices"][i] if i == 0 else it["prices"][min(i + 1, len(it["prices"]) - 1)])
                        if price > 0:
                            tiers.append((label, grade, price))
                # Fallback: if only one price found, treat as ungraded
                if not tiers and it["prices"]:
                    p0 = parse_price(it["prices"][0])
                    if p0 > 0:
                        tiers.append(("Ungraded", None, p0))

                for label, grade, price in tiers:
                    full_title = f"{t} [{label}]"
                    item_id = synthetic_id(full_title, label, price)
                    rows.append((
                        item_id, full_title[:500], driver, parallel, grade, "Used",
                        price, datetime.utcnow(), it.get("image") or None, it.get("url") or None,
                        False, "F1", "SportsCardsPro", datetime.utcnow(),
                    ))
            time.sleep(2)

        browser.close()

    added = upsert_sold(conn, rows)
    log.info(f"SCP DONE: upserted {added} rows (seen {seen_count} cards)")

    write_telemetry(
        conn, "SportsCardsPro", started_at,
        queries_attempted=len(PAGES),
        queries_succeeded=pages_succeeded,
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
        logging.exception("SCP fatal: %s", e)
        sys.exit(0)
