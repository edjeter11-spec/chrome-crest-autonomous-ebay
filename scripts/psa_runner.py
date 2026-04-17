"""
PSA pop + auction-prices scraper. Runs via GitHub Actions, writes to Neon.

Scrapes:
  - psacard.com/pop/search?q=... for population counts per driver / set
  - psacard.com/auctionprices/... for graded sale history (price, grade, date, source)

PSA runs on Cloudflare. Playwright + stealth may get through; may not. On
failure we log the evidence (title = "Just a moment..."/challenge page) and
keep going. Partial success > nothing.

Usage:
    DATABASE_URL=postgres://... python scripts/psa_runner.py
"""
import os
import re
import sys
import time
import logging
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright
try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("psa")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)


DRIVERS = [
    "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
    "Fernando Alonso", "Oscar Piastri", "Carlos Sainz", "George Russell",
    "Sergio Perez", "Lance Stroll", "Valtteri Bottas", "Esteban Ocon",
    "Pierre Gasly", "Yuki Tsunoda", "Daniel Ricciardo",
    "Nico Hulkenberg", "Kevin Magnussen", "Zhou Guanyu", "Alexander Albon",
    "Logan Sargeant", "Oliver Bearman", "Jack Doohan", "Andrea Kimi Antonelli",
    "Isack Hadjar", "Gabriel Bortoleto", "Liam Lawson", "Franco Colapinto",
    "Michael Schumacher", "Ayrton Senna", "Alain Prost", "Nigel Mansell",
    "Sebastian Vettel", "Kimi Raikkonen", "Niki Lauda",
]

SET_YEARS = [2023, 2024, 2025]


# --- DB ---

def get_conn():
    return psycopg2.connect(DB_URL)


def upsert_pop(conn, rows):
    if not rows:
        return 0
    # No natural UNIQUE constraint — delete-then-insert per driver handled by caller.
    sql = """
        INSERT INTO psa_pop (
            set_year, set_name, card_num, driver_name, parallel, grade,
            pop_count, pop_higher, source_url, last_scraped
        ) VALUES %s
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def clear_pop_for_driver(conn, driver: str):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM psa_pop WHERE driver_name = %s", (driver,))
    conn.commit()


def upsert_sales(conn, rows):
    if not rows:
        return 0
    sql = """
        INSERT INTO psa_sales (
            driver_name, parallel, grade, price, sale_date,
            source, auction_house, image_url, listing_url, title, scraped_at
        ) VALUES %s
        ON CONFLICT (listing_url) DO UPDATE SET
            price = EXCLUDED.price,
            sale_date = EXCLUDED.sale_date
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


# --- Page helpers ---

def looks_like_challenge(page) -> bool:
    t = (page.title() or "").lower()
    return "just a moment" in t or "attention required" in t or "cloudflare" in t


def safe_goto(page, url: str, timeout=30000) -> bool:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        page.wait_for_timeout(2500)
        if looks_like_challenge(page):
            # Give CF a little time
            page.wait_for_timeout(6000)
            if looks_like_challenge(page):
                log.warning(f"Cloudflare challenge at {url[:80]}: {page.title()[:60]}")
                return False
        return True
    except Exception as e:
        log.warning(f"goto failed {url[:80]}: {e}")
        return False


# --- POP scraping (Track B) ---

def scrape_pop_for_driver(page, driver: str):
    """Hit PSA pop-search for '{year} topps chrome formula 1 {driver}' across years.
    Returns list of row-tuples ready for upsert_pop."""
    rows = []
    for year in SET_YEARS:
        q = f"{year} topps chrome formula 1 {driver}".replace(" ", "+")
        url = f"https://www.psacard.com/pop/search?q={q}"
        if not safe_goto(page, url):
            continue

        # PSA renders search results with linked set rows and per-grade counts.
        # Defensive: grab any table rows with numeric cells that look like grade counts.
        try:
            data = page.evaluate("""
                () => {
                    const out = [];
                    const rows = document.querySelectorAll('table tr, .SearchResults__row, .result-row, [data-testid="row"]');
                    rows.forEach(r => {
                        const text = (r.innerText || r.textContent || '').trim();
                        if (!text) return;
                        // Look for grade label anywhere in row
                        const gm = text.match(/\\b(PSA|BGS|SGC|CGC)\\s*(10|9\\.5|9|8\\.5|8|7|6|5)\\b/i);
                        // Numeric sequence
                        const nums = text.match(/\\b\\d{1,5}\\b/g) || [];
                        // Capture links inside row for set context
                        const link = r.querySelector('a');
                        const href = link ? link.href : '';
                        const linkTxt = link ? (link.innerText || '').trim() : '';
                        out.push({ text: text.slice(0, 400), href, linkTxt, hasGrade: !!gm, nums: nums.slice(0, 20) });
                    });
                    return out;
                }
            """)
        except Exception as e:
            log.warning(f"pop extract failed for {driver} {year}: {e}")
            data = []

        # Very lenient parse — record ANY evidence with grade + count.
        # PSA's page HTML varies; worst case we capture the raw row text + grade.
        for item in data[:80]:
            link_text = item.get("linkTxt") or ""
            text = item.get("text") or ""
            # Extract all grade+count pairs from this row text
            for m in re.finditer(r"(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7|6|5)\s*[:\-\|]?\s*(\d{1,5})", text, re.I):
                grade = f"{m.group(1).upper()} {m.group(2)}"
                count = int(m.group(3))
                # Skip noise (big numbers that are really prices / year-like)
                if count > 100000:
                    continue
                parallel = _parallel_from_set_label(link_text or text)
                rows.append((
                    year, f"Topps Chrome Formula 1 {year}", None,
                    driver, parallel, grade, count, 0, url, datetime.utcnow(),
                ))
        time.sleep(1.5)
    return rows


def _parallel_from_set_label(text: str) -> str:
    t = (text or "").lower()
    for label, needle in [
        ("SuperFractor", "superfractor"), ("Red /5", "red"),
        ("Orange /25", "orange"), ("Gold /50", "gold"),
        ("Green /99", "green"), ("Blue /150", "blue"),
        ("Refractor", "refractor"), ("Autograph", "auto"),
    ]:
        if needle in t:
            return label
    return "Base"


# --- Auction Prices (Track C) ---

def scrape_apr_for_driver(page, driver: str):
    """Hit PSA auctionprices search and grab sale rows (price, grade, date, source)."""
    rows = []
    q = driver.replace(" ", "+")
    for year in SET_YEARS:
        url = f"https://www.psacard.com/auctionprices/search?q={year}+topps+chrome+formula+1+{q}"
        if not safe_goto(page, url):
            continue
        try:
            items = page.evaluate("""
                () => {
                    const out = [];
                    const rows = document.querySelectorAll('table tbody tr, .auction-prices__row, [data-testid="apr-row"]');
                    rows.forEach(r => {
                        const text = (r.innerText || r.textContent || '').trim();
                        if (!text) return;
                        const link = r.querySelector('a');
                        out.push({
                            text: text.slice(0, 500),
                            href: link ? link.href : ''
                        });
                    });
                    return out;
                }
            """)
        except Exception as e:
            log.warning(f"apr extract failed {driver} {year}: {e}")
            items = []

        for it in items[:100]:
            text = it.get("text") or ""
            href = it.get("href") or ""
            # $price anywhere
            pm = re.search(r"\$\s*([\d,]+\.?\d{0,2})", text)
            gm = re.search(r"(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7)", text, re.I)
            dm = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text)
            if not (pm and gm):
                continue
            price = float(pm.group(1).replace(",", ""))
            grade = f"{gm.group(1).upper()} {gm.group(2)}"
            sale_date = datetime.utcnow()
            if dm:
                try:
                    mo, day, yr = int(dm.group(1)), int(dm.group(2)), int(dm.group(3))
                    if yr < 100:
                        yr += 2000
                    sale_date = datetime(yr, mo, day)
                except Exception:
                    pass
            # Auction house heuristic
            house = None
            for h in ("Goldin", "PWCC", "Heritage", "eBay", "REA", "Memory Lane", "Huggins"):
                if h.lower() in text.lower():
                    house = h
                    break
            # Unique key — URL if present else synthesized
            listing_url = href or f"psa-apr://{driver}/{year}/{grade}/{price}/{sale_date.isoformat()}"
            rows.append((
                driver, _parallel_from_set_label(text), grade, price,
                sale_date, "PSA APR", house, None, listing_url, text[:250],
                datetime.utcnow(),
            ))
        time.sleep(1.5)
    return rows


# --- Main ---

def main():
    log.info("PSA scrape run start")
    conn = get_conn()

    pop_total = 0
    apr_total = 0
    pop_blocked = 0
    apr_blocked = 0
    processed = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        page = ctx.new_page()
        if HAS_STEALTH:
            try:
                stealth_sync(page)
                log.info("Stealth mode active")
            except Exception as e:
                log.warning(f"Stealth init failed: {e}")

        # Warm-up on PSA homepage
        if not safe_goto(page, "https://www.psacard.com/"):
            log.warning("Homepage warm-up blocked — continuing anyway")

        for driver in DRIVERS:
            processed += 1
            log.info(f"[{processed}/{len(DRIVERS)}] {driver}")
            # Track B
            try:
                pop_rows = scrape_pop_for_driver(page, driver)
                if pop_rows:
                    clear_pop_for_driver(conn, driver)
                    added = upsert_pop(conn, pop_rows)
                    pop_total += added
                    log.info(f"  pop: {added} rows")
                else:
                    pop_blocked += 1
            except Exception as e:
                log.warning(f"  pop failed: {e}")
                pop_blocked += 1

            # Track C
            try:
                apr_rows = scrape_apr_for_driver(page, driver)
                if apr_rows:
                    added = upsert_sales(conn, apr_rows)
                    apr_total += added
                    log.info(f"  apr: {added} rows")
                else:
                    apr_blocked += 1
            except Exception as e:
                log.warning(f"  apr failed: {e}")
                apr_blocked += 1

        browser.close()
    conn.close()
    log.info(
        f"DONE. pop_rows={pop_total} apr_rows={apr_total} "
        f"pop_empty_or_blocked={pop_blocked} apr_empty_or_blocked={apr_blocked}"
    )


if __name__ == "__main__":
    main()
