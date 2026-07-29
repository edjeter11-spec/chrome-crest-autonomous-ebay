"""
sportscardspro.com sold-comp scraper — PRIMARY sold-data source.

Runs on GitHub Actions (Playwright + stealth), writes straight to Neon,
reusing scrape_runner's parsers + upsert_sold (ON CONFLICT dedupe, SSL-drop
healing, reconnect-retry) so both scrapers share one code path.

WHY THIS EXISTS (2026-07-29) — every direct-eBay sold path is dead:
  * eBay /sch sold search: blocked. Probed 8 URL/param/mobile/fresh-context
    variants FROM THE RUNNER — all returned "Security Measure" / "Sign in or
    Register", while an ACTIVE-listing control in the same session returned
    136 results. eBay specifically gates completed listings.
  * eBay Finding API (findCompletedItems): HTTP 503 from eBay's own
    infrastructure.
  * eBay Marketplace Insights (official sold data): "invalid_scope" — it's
    Limited Release and not granted to our keyset.
  * eBay Browse API: works, but has no sold data and its daily quota is
    separately exhausted.
  * 130point.com: Cloudflare challenge, zero cookies pre-solve. 59/59 runs
    blocked, 0 rows ever.

sportscardspro (PriceCharting's sports-card sister site) republishes eBay
sold comps AND exposes the original eBay item id per row — so rows dedupe
cleanly against sold_cards.ebay_item_id alongside the legacy pipelines.

It sits behind Cloudflare, which is why this MUST run here and not on
Vercel: verified that curl passes while Python httpx gets 403
(`Cf-Mitigated: challenge`) on the identical URL/headers/moment — a TLS
fingerprint check that Vercel's Python runtime cannot beat. A real browser
does pass it; probe confirmed 150 card links + 56 sold rows off 4 cards.

robots.txt permits /console/ and /game/ (only /buy, /stripe-connect,
/publish-offer are disallowed). Paced politely regardless.
"""
import logging
import os
import re
import sys
import time
from datetime import datetime

from playwright.sync_api import sync_playwright

try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

# Reuse scrape_runner's title parsers + DB layer — single source of truth.
from scrape_runner import (  # noqa: E402
    get_conn,
    upsert_sold,
    is_valid_2025_f1,
    parallel_from_title,
    driver_from_title,
    grade_from_title,
    write_telemetry,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scp")

BASE = "https://www.sportscardspro.com"

# Verified via /search-products. Do NOT guess slugs — plausible-looking
# ones ("...-autographs", "...-sapphire-edition") both 404.
SET_SLUGS = [
    "racing-cards-2025-topps-chrome-formula-1",
    "racing-cards-2025-topps-chrome-sapphire-formula-1",
    "racing-cards-2025-topps-chrome-formula-1-neon-nations",
    "racing-cards-2025-topps-chrome-formula-1-vegas-at-night",
    "racing-cards-2025-topps-chrome-formula-1-top-speed",
    "racing-cards-2025-topps-chrome-formula-1-ace-of-trades",
    "racing-cards-2025-topps-chrome-formula-1-diamond-75th-anniversary",
    "racing-cards-2025-topps-chrome-formula-1-futuro",
    "racing-cards-2025-topps-chrome-formula-1-speed-demons",
    "racing-cards-2025-topps-chrome-formula-1-helmet-collection",
    "racing-cards-2025-topps-chrome-formula-1-1975-speed-wheels",
    "racing-cards-2025-topps-chrome-formula-1-diamond-drives",
    "racing-cards-2025-topps-chrome-formula-1-floor-it",
]

CHALLENGE_MARKERS = ("just a moment", "attention required", "checking your browser")

# Budget: the workflow allows 25 min total and the eBay auction/BIN passes
# in scrape_runner need their share. Cards are ~1.5-2s each here.
MAX_CARDS_PER_RUN = int(os.environ.get("SCP_MAX_CARDS", "120"))
# Rotate which set we start from each run so the whole catalog gets covered
# over successive runs instead of re-scraping the base set head every time.
SET_OFFSET = int(os.environ.get("SCP_SET_OFFSET", "0"))


def _blocked(title: str) -> bool:
    return any(m in (title or "").lower() for m in CHALLENGE_MARKERS)


def _goto(page, url: str, tries: int = 2) -> bool:
    """Navigate, waiting out a Cloudflare interstitial if one appears."""
    for attempt in range(tries):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            log.warning(f"nav fail ({str(e)[:60]}) {url[-60:]}")
            time.sleep(2)
            continue
        title = page.title() or ""
        if not _blocked(title):
            return True
        # Managed challenge usually auto-solves in a few seconds.
        for _ in range(5):
            page.wait_for_timeout(4000)
            if not _blocked(page.title() or ""):
                return True
        log.warning(f"challenge persisted: {url[-60:]}")
        time.sleep(3)
    return False


def _price(s: str) -> float:
    m = re.search(r"[\d,]+\.?\d*", (s or "").replace("$", ""))
    if not m:
        return 0.0
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return 0.0


def _date(s: str):
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def card_links(page) -> list:
    return page.evaluate(
        """() => Array.from(new Set(
            Array.from(document.querySelectorAll('a[href^="/game/"]'))
                 .map(a => a.getAttribute('href'))
        ))"""
    ) or []


def sold_rows(page) -> list:
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('tr[id^="ebay-"]')).map(tr => ({
            id: tr.id.replace('ebay-',''),
            date: (tr.querySelector('td.date')||{}).innerText || '',
            title: (tr.querySelector('td.title')||{}).innerText || '',
            price: (tr.querySelector('td.numeric')||{}).innerText || ''
        }))"""
    ) or []


def main():
    started_at = datetime.utcnow()
    conn = get_conn()
    total_seen = 0
    total_added = 0
    cards_done = 0
    blocked_pages = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        ctx = browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
        )
        page = ctx.new_page()
        if HAS_STEALTH:
            try:
                stealth_sync(page)
                log.info("stealth active")
            except Exception as e:
                log.warning(f"stealth init failed: {e}")

        ordered = SET_SLUGS[SET_OFFSET % len(SET_SLUGS):] + SET_SLUGS[:SET_OFFSET % len(SET_SLUGS)]

        for slug in ordered:
            if cards_done >= MAX_CARDS_PER_RUN:
                break
            set_url = f"{BASE}/console/{slug}"
            log.info(f"=== set: {slug}")
            if not _goto(page, set_url):
                blocked_pages += 1
                continue
            links = card_links(page)
            log.info(f"  {len(links)} card links")
            if not links:
                continue

            for href in links:
                if cards_done >= MAX_CARDS_PER_RUN:
                    break
                time.sleep(1.2)  # polite pacing
                if not _goto(page, BASE + href, tries=1):
                    blocked_pages += 1
                    continue
                cards_done += 1
                raw = sold_rows(page)
                total_seen += len(raw)

                batch = []
                for r in raw:
                    title = re.sub(r"\s+", " ", (r.get("title") or "")).strip()
                    if not title or not is_valid_2025_f1(title):
                        continue
                    price = _price(r.get("price"))
                    if price <= 0:
                        continue
                    parallel = parallel_from_title(title)
                    if parallel == "Base":
                        continue  # non-base only, matches the eBay pipeline
                    item_id = (r.get("id") or "").strip()
                    if not item_id:
                        continue
                    batch.append((
                        item_id,
                        title[:500],
                        driver_from_title(title),
                        parallel,
                        grade_from_title(title),
                        "Used",
                        price,
                        _date(r.get("date")) or datetime.utcnow(),
                        None,                                   # image_url
                        f"https://www.ebay.com/itm/{item_id}",  # ebay_url
                        False,                                  # is_auction
                        "F1",                                   # series
                        None,                                   # shipping_cost
                    ))
                if batch:
                    added, conn = upsert_sold(conn, batch)
                    total_added += added
                    log.info(f"  [{cards_done}] {href.split('/')[-1][:38]:40s} "
                             f"seen={len(raw)} kept={len(batch)} upserted={added}")

        browser.close()

    write_telemetry(
        conn, "sportscardspro", started_at,
        cards_done, cards_done - blocked_pages,
        total_seen, total_added,
        blocked=(total_added == 0 and total_seen == 0),
    )
    conn.close()
    log.info(f"DONE: cards={cards_done} rows_seen={total_seen} upserted={total_added} "
             f"blocked_pages={blocked_pages}")


if __name__ == "__main__":
    main()
