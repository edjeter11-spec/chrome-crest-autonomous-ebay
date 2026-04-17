"""
Playwright-based eBay scraper that runs from GitHub Actions and writes
directly to the Neon/Supabase Postgres database.

Bypasses every quota and bot-challenge that blocks our Vercel-side scrapers:
- Real Chromium browser (not httpx) → defeats eBay's "Pardon Our Interruption"
- Runs on GitHub Actions free tier (2000 min/mo) → no Vercel Lambda size limit
- Hits eBay search HTML directly → uses zero Browse/Finding API quota

Usage (locally):
    DATABASE_URL=postgres://... python scripts/scrape_runner.py

In CI: scheduled via .github/workflows/scrape.yml every 3 hours.
"""
import os
import re
import sys
import time
import logging
from datetime import datetime, timedelta
from urllib.parse import urlencode

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright
try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scraper")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

# --- Title parsers (mirror backend/sold_ingest.py + ebay_api.py) ---

GRADE_RE = re.compile(r"\b(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7|6)\b", re.I)

PARALLEL_PATTERNS = [
    ("SuperFractor", re.compile(r"super ?fractor", re.I)),
    ("Red /5", re.compile(r"\bred\b.*\/\s*5\b|\/\s*5\b.*\bred", re.I)),
    ("Black /10", re.compile(r"\bblack\b.*\/\s*10\b|\/\s*10\b.*\bblack", re.I)),
    ("Orange /25", re.compile(r"\borange\b.*\/\s*25\b|\/\s*25\b.*\borange", re.I)),
    ("Gold /50", re.compile(r"\bgold\b.*\/\s*50\b|\/\s*50\b.*\bgold", re.I)),
    ("F1 75th /75", re.compile(r"75th.*\/\s*75\b|\/\s*75\b.*75th|anniversary.*\/\s*75\b", re.I)),
    ("Green /99", re.compile(r"\bgreen\b.*\/\s*99\b|\/\s*99\b.*\bgreen", re.I)),
    ("Blue /150", re.compile(r"\bblue\b.*\/\s*150\b|\/\s*150\b.*\bblue", re.I)),
    ("Aqua /199", re.compile(r"\baqua\b.*\/\s*199\b|\/\s*199\b.*\baqua", re.I)),
    ("Pink /250", re.compile(r"\bpink\b.*\/\s*250\b|\/\s*250\b.*\bpink", re.I)),
    ("Teal /299", re.compile(r"\bteal\b.*\/\s*299\b|\/\s*299\b.*\bteal", re.I)),
    ("Vegas at Night", re.compile(r"vegas at night|vegas ?night", re.I)),
    ("Neon Nations", re.compile(r"neon nations?", re.I)),
    ("Floor It", re.compile(r"floor ?it", re.I)),
    ("Speed Wheels", re.compile(r"speed wheels?", re.I)),
    ("Top Speed", re.compile(r"top speed", re.I)),
    ("Four & More", re.compile(r"four ?& ?more|four and more|4 ?& ?more", re.I)),
    ("Diamond 75th", re.compile(r"diamond ?75th|75th anniversary diamond", re.I)),
    ("Helix", re.compile(r"\bhelix\b", re.I)),
    ("Ultrasonic", re.compile(r"ultrasonic", re.I)),
    ("The Grail", re.compile(r"\bthe grail\b|\bgrail\b", re.I)),
    ("Futuro", re.compile(r"futuro", re.I)),
    ("The Chain", re.compile(r"\bthe chain\b", re.I)),
    ("The Grid", re.compile(r"\bthe grid\b", re.I)),
    ("Helmet Collection", re.compile(r"helmet collection|helmet collectors", re.I)),
    ("Speed Demons", re.compile(r"speed demons?", re.I)),
    ("Ace of Trades", re.compile(r"ace of trades?", re.I)),
    ("Checker Flag", re.compile(r"checker ?flag|checkered ?flag", re.I)),
    ("Prism Refractor", re.compile(r"prism ?refractor|prizm ?refractor", re.I)),
    ("Refractor", re.compile(r"refractor", re.I)),
    ("Autograph", re.compile(r"\bauto(graph)?\b|\bsigned\b", re.I)),
]

DRIVERS = [
    "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
    "Fernando Alonso", "Oscar Piastri", "Carlos Sainz", "George Russell",
    "Sergio Perez", "Lance Stroll", "Valtteri Bottas", "Esteban Ocon",
    "Pierre Gasly", "Yuki Tsunoda", "Sebastian Vettel", "Kimi Raikkonen",
    "Nico Hulkenberg", "Kevin Magnussen", "Zhou Guanyu", "Alexander Albon",
    "Logan Sargeant", "Oliver Bearman", "Jack Doohan", "Andrea Kimi Antonelli",
    "Isack Hadjar", "Gabriel Bortoleto", "Liam Lawson", "Franco Colapinto",
]


def parallel_from_title(title: str):
    for label, pat in PARALLEL_PATTERNS:
        if pat.search(title):
            return label
    return "Base"


def grade_from_title(title: str):
    m = GRADE_RE.search(title)
    return f"{m.group(1).upper()} {m.group(2)}" if m else None


def driver_from_title(title: str):
    t = title.lower()
    for d in DRIVERS:
        if d.lower() in t:
            return d
        last = d.split()[-1].lower()
        if len(last) > 4 and re.search(rf"\b{re.escape(last)}\b", t):
            return d
    return None


def is_valid_2025_f1(title: str):
    t = (title or "").lower()
    if "2025" not in t:
        return False
    if not any(k in t for k in ("formula 1", "formula1", "f1", "grand prix", "topps chrome")):
        return False
    if any(k in t for k in (" f2 ", " f3 ", "formula 2", "formula 3", "indycar", "nascar")):
        return False
    return True


def parse_price(s: str) -> float:
    if not s:
        return 0.0
    m = re.search(r"[\d,]+\.?\d*", s.replace(",", ""))
    return float(m.group()) if m else 0.0


def extract_ebay_item_id(url: str):
    if not url:
        return None
    m = re.search(r"/itm/(?:[^/]+/)?(\d{10,14})", url)
    return m.group(1) if m else None


# --- DB ---

def get_conn():
    return psycopg2.connect(DB_URL)


def upsert_sold(conn, rows):
    if not rows:
        return 0
    sql = """
        INSERT INTO sold_cards (
            ebay_item_id, title, driver_name, parallel, grade, condition,
            sale_price, sale_date, image_url, ebay_url, is_auction, series
        ) VALUES %s
        ON CONFLICT (ebay_item_id) DO UPDATE SET
            sale_price = EXCLUDED.sale_price,
            sale_date = EXCLUDED.sale_date,
            image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url)
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


# --- Scraper ---

EBAY_BASE = "https://www.ebay.com/sch/i.html"

QUERIES = [
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1 Refractor",
    "2025 Topps Chrome F1 Auto",
    "2025 Topps Chrome F1 Verstappen",
    "2025 Topps Chrome F1 Hamilton",
    "2025 Topps Chrome F1 Norris",
    "2025 Topps Chrome F1 Leclerc",
    "2025 Topps Chrome F1 Neon Nations",
    "2025 Topps Chrome F1 Helix",
    "2025 Topps Chrome F1 Vegas at Night",
]


def build_url(query: str, mode: str = "sold"):
    params = {"_nkw": query, "_ipg": "240"}
    if mode == "sold":
        params["LH_Complete"] = "1"
        params["LH_Sold"] = "1"
    elif mode == "auction":
        params["LH_Auction"] = "1"
        params["_sop"] = "1"  # ending soonest
    return f"{EBAY_BASE}?{urlencode(params)}"


def scrape_search_page(page, url: str):
    """Return list of dicts: title, price, url, image, sale_date_text."""
    page.goto(url, wait_until="domcontentloaded", timeout=45000)
    title = page.title() or ""
    if "Pardon" in title or "interruption" in title.lower():
        log.warning(f"Bot challenge: {title}")
        page.wait_for_timeout(8000)
    try:
        page.wait_for_selector(
            "li.s-item, .s-item__wrapper, .srp-results, .su-card-container, .s-card",
            timeout=20000,
        )
    except Exception:
        log.warning(f"No selector match at {url[:80]} (title={title})")
        return []

    # Try old + new eBay layouts. Modern eBay uses .s-card / .su-card-container.
    # Price extraction is strict: only accept text that contains "$" so we don't
    # catch "16 watchers" or "FREE shipping" badges.
    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            const cards = document.querySelectorAll(
                'li.s-item, .s-item__wrapper, .s-card, .su-card-container'
            );
            cards.forEach(el => {
                const titleEl = el.querySelector(
                    '.s-item__title, .s-item__title span, .s-card__title, [data-testid="item-title"], h3'
                );
                const linkEl = el.querySelector(
                    'a.s-item__link, a.s-card__link, a[href*="/itm/"]'
                );
                const imgEl = el.querySelector('img');
                const dateEl = el.querySelector(
                    '.s-item__caption--signal, .s-item__title--tagblock, .s-item__listingDate, .s-card__caption'
                );
                if (!titleEl || !linkEl) return;
                const title = (titleEl.innerText || titleEl.textContent || '').trim();
                if (!title || title === 'Shop on eBay' || title.length < 5) return;
                const url = linkEl.href || '';
                if (!url.includes('/itm/')) return;
                if (seen.has(url)) return;

                // Price: try known selectors first, but VALIDATE each candidate
                // contains a "$". Fall back to scanning all text inside the card
                // for the first dollar amount.
                let priceText = '';
                const priceCandidates = el.querySelectorAll(
                    '.s-item__price, .s-card__price, [data-testid="item-price"], .su-styled-text.positive'
                );
                for (const p of priceCandidates) {
                    const t = (p.innerText || p.textContent || '').trim();
                    if (t.includes('$')) { priceText = t; break; }
                }
                if (!priceText) {
                    // Fallback: scan all text nodes for first $ amount.
                    const all = (el.innerText || el.textContent || '');
                    const m = all.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                    if (m) priceText = m[0];
                }
                if (!priceText) return;  // No real price → skip
                seen.add(url);
                out.push({
                    title,
                    price: priceText,
                    url,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || '') : '',
                    date_text: dateEl ? (dateEl.innerText || dateEl.textContent || '').trim() : ''
                });
            });
            return out;
        }
    """)
    if not items:
        # Dump first 2KB of body for debugging
        body_snippet = page.evaluate("() => document.body.innerText.slice(0, 800)")
        log.warning(f"Zero items extracted. Body preview: {body_snippet[:400]}")
    return items


def parse_sale_date(date_text: str) -> datetime:
    """eBay sold listings format: 'Sold  Apr 15, 2026' or similar."""
    if not date_text:
        return datetime.utcnow()
    m = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})", date_text)
    if m:
        try:
            return datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y")
        except ValueError:
            pass
    return datetime.utcnow()


def main():
    log.info("Starting scrape run")
    conn = get_conn()
    total_added = 0
    total_seen = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-web-security",
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
                "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
            },
        )
        page = ctx.new_page()
        if HAS_STEALTH:
            try:
                stealth_sync(page)
                log.info("Stealth mode active")
            except Exception as e:
                log.warning(f"Stealth init failed: {e}")
        # Visit eBay homepage first to get cookies
        try:
            page.goto("https://www.ebay.com/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2500)
            log.info(f"Homepage warm-up: {page.title()[:60]}")
        except Exception as e:
            log.warning(f"Homepage warm-up failed: {e}")

        # SOLD ONLY — active auctions belong in /auctions table (handled by Vercel Browse sync).
        # The Sales Database must only contain actual completed sales.
        for query in QUERIES:
            url = build_url(query, "sold")
            log.info(f"Scraping [sold] {query!r}")
            try:
                items = scrape_search_page(page, url)
            except Exception as e:
                log.warning(f"Page failed: {e}")
                items = []
            total_seen += len(items)

            rows = []
            skipped_not_sold = 0
            for it in items:
                # Clean eBay's "Opens in a new window or tab" appendage and any newlines.
                raw_title = it["title"] or ""
                title = re.sub(r"\s*Opens in a new window or tab\s*$", "", raw_title, flags=re.I).strip()
                title = re.sub(r"\s+", " ", title).strip()
                if not is_valid_2025_f1(title):
                    continue
                # Require "Sold" marker in eBay's date text — protects against
                # active auctions sneaking in if eBay's Sold filter ever leaks.
                date_txt = (it.get("date_text") or "").lower()
                if "sold" not in date_txt:
                    skipped_not_sold += 1
                    continue
                price = parse_price(it["price"])
                if price <= 0:
                    continue
                parallel = parallel_from_title(title)
                if parallel == "Base":
                    continue  # non-base only
                item_id = extract_ebay_item_id(it["url"])
                if not item_id:
                    continue
                rows.append((
                    item_id,
                    title[:500],
                    driver_from_title(title),
                    parallel,
                    grade_from_title(title),
                    "Used",
                    price,
                    parse_sale_date(it["date_text"]),
                    it["image"] or None,
                    it["url"],
                    False,  # is_auction — always False; this table is sold only
                    "F1",
                ))

            if rows:
                added = upsert_sold(conn, rows)
                total_added += added
                log.info(f"  → {added} sold rows upserted (skipped {skipped_not_sold} non-sold)")
            elif skipped_not_sold:
                log.info(f"  → 0 rows (skipped {skipped_not_sold} non-sold)")
            time.sleep(2)  # polite gap between queries

        browser.close()

    conn.close()
    log.info(f"DONE: {total_seen} listings seen, {total_added} rows upserted")


if __name__ == "__main__":
    main()
