"""
TEMP diagnostic (2026-07-29): can a GitHub Actions runner + Playwright get
sold-comp data from sportscardspro.com?

Background: every direct-eBay sold path is dead (see scrape_sportscardspro
docstring). sportscardspro republishes eBay sold comps WITH the original
eBay item id, but sits behind a Cloudflare challenge (`Cf-Mitigated:
challenge`) that plain httpx cannot pass — verified: curl gets 200 while
httpx gets 403 on the same URL/headers/moment, so it's TLS-fingerprint
based, and Vercel (Python/httpx) would be blocked the same way.

A real browser CAN pass a Cloudflare managed challenge. GH Actions already
runs Playwright+stealth for the auction/BIN scraper, so if this works the
whole sold pipeline can live there for free.

Probes: set page -> card links -> per-card sold rows. Prints what it finds.
Delete once the answer is known.
"""
import re
import sys
import time

from playwright.sync_api import sync_playwright

try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

BASE = "https://www.sportscardspro.com"
SET_URL = f"{BASE}/console/racing-cards-2025-topps-chrome-formula-1"
CHALLENGE_MARKERS = ("just a moment", "attention required", "checking your browser")


def blocked(title: str) -> bool:
    return any(m in (title or "").lower() for m in CHALLENGE_MARKERS)


def main():
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
                print("stealth: ACTIVE")
            except Exception as e:
                print(f"stealth: FAILED {e}")
        else:
            print("stealth: NOT INSTALLED")

        # --- set page ---
        print(f"\n=== GET {SET_URL}")
        page.goto(SET_URL, wait_until="domcontentloaded", timeout=60000)
        title = page.title() or ""
        print(f"title: {title[:70]}")
        if blocked(title):
            # Cloudflare interstitials usually auto-resolve within ~5-10s.
            print("challenge detected — waiting up to 25s for auto-solve...")
            for _ in range(5):
                page.wait_for_timeout(5000)
                title = page.title() or ""
                print(f"  ...title now: {title[:60]}")
                if not blocked(title):
                    break
        if blocked(title):
            print("RESULT: BLOCKED — Cloudflare challenge not solved by browser+stealth")
            browser.close()
            sys.exit(0)

        links = page.evaluate(
            """() => Array.from(new Set(
                Array.from(document.querySelectorAll('a[href^="/game/"]'))
                     .map(a => a.getAttribute('href'))
            ))"""
        )
        print(f"RESULT: PASSED challenge. card links found: {len(links)}")
        if not links:
            print("no card links — selector or page shape changed")
            browser.close()
            sys.exit(0)

        # --- a few card pages ---
        total = 0
        for href in links[:4]:
            url = BASE + href
            time.sleep(1.5)
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                print(f"  {href[:50]} NAV-FAIL {str(e)[:40]}")
                continue
            t = page.title() or ""
            if blocked(t):
                print(f"  {href[:50]} BLOCKED on card page")
                continue
            rows = page.evaluate(
                """() => Array.from(document.querySelectorAll('tr[id^="ebay-"]')).map(tr => ({
                    id: tr.id.replace('ebay-',''),
                    date: (tr.querySelector('td.date')||{}).innerText || '',
                    title: (tr.querySelector('td.title')||{}).innerText || '',
                    price: (tr.querySelector('td.numeric')||{}).innerText || ''
                }))"""
            )
            total += len(rows)
            print(f"  {href.split('/')[-1][:40]:42s} rows={len(rows)}")
            for r in rows[:2]:
                print(f"      {r['date'].strip()} {r['price'].strip():>10} | {r['title'].strip()[:58]}")

        print(f"\nTOTAL sold rows from 4 cards: {total}")
        print("VERDICT: sportscardspro via Playwright on GH Actions = WORKS" if total
              else "VERDICT: pages load but no sold rows parsed — check selectors")
        browser.close()


if __name__ == "__main__":
    main()
