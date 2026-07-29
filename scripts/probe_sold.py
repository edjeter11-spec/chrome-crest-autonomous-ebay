"""
TEMP diagnostic (2026-07-29): find ANY request shape that returns real eBay
SOLD results from a GitHub Actions runner.

Why this exists: the runner's IP is blocked on sold searches (page titles
"Security Measure" / "Sign in or Register") while auction/BIN searches from
the SAME runner succeed — so it is not a blanket IP ban, it is specific to
the sold/completed filters. The dev machine can't test this: its own IP is
fully challenged by eBay (/splashui/challenge on the bare homepage), so
local results are meaningless for this question.

Probes a matrix of variants and prints a table. Delete once resolved.
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

KW = "2025 Topps Chrome F1 Verstappen"
KW_Q = KW.replace(" ", "+")

# (label, url) — ordered cheapest/most-likely-first
VARIANTS = [
    ("baseline sold _ipg=240",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&_ipg=240&LH_Complete=1&LH_Sold=1"),
    ("sold _ipg=60",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&_ipg=60&LH_Complete=1&LH_Sold=1"),
    ("sold no _ipg",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&LH_Complete=1&LH_Sold=1"),
    ("sold LH_Sold only (no LH_Complete)",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&LH_Sold=1"),
    ("sold + rt=nc",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&LH_Complete=1&LH_Sold=1&rt=nc"),
    ("sold + _fsrp=1",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&LH_Complete=1&LH_Sold=1&_fsrp=1"),
    ("sold via category path /b/",
     f"https://www.ebay.com/sch/212/i.html?_nkw={KW_Q}&LH_Complete=1&LH_Sold=1"),
    ("MOBILE m.ebay sold",
     f"https://m.ebay.com/sch/i.html?_nkw={KW_Q}&LH_Complete=1&LH_Sold=1"),
    ("ACTIVE control (known-good)",
     f"https://www.ebay.com/sch/i.html?_nkw={KW_Q}&_ipg=240&LH_Auction=1&_sop=1"),
]

RESULT_SEL = "li.s-item, .s-item__wrapper, .srp-results, .su-card-container, .s-card"
CHALLENGE_TITLES = ("pardon", "interruption", "security measure", "sign in or register", "error page")


def count_results(page) -> int:
    try:
        return page.evaluate(
            """() => document.querySelectorAll(
                'li.s-item, .s-item__wrapper, .s-card, .su-card-container'
            ).length"""
        )
    except Exception:
        return -1


def probe(page, label, url, warm_first=False):
    if warm_first:
        try:
            page.goto("https://www.ebay.com/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2500)
        except Exception:
            pass
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        return {"label": label, "title": f"NAV-FAIL {str(e)[:50]}", "results": -1, "ok": False}
    title = (page.title() or "")[:60]
    blocked = any(t in title.lower() for t in CHALLENGE_TITLES)
    n = 0
    if not blocked:
        try:
            page.wait_for_selector(RESULT_SEL, timeout=12000)
        except Exception:
            pass
        n = count_results(page)
    return {"label": label, "title": title, "results": n, "ok": (not blocked and n > 0)}


def main():
    rows = []
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
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
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

        # Warm once so we have a normal-looking session for the whole run.
        try:
            page.goto("https://www.ebay.com/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)
            print(f"homepage warm: {page.title()[:60]}")
        except Exception as e:
            print(f"homepage warm failed: {e}")

        for label, url in VARIANTS:
            r = probe(page, label, url)
            rows.append(r)
            print(f"  [{'OK ' if r['ok'] else 'BLK'}] {r['label']:38s} n={r['results']:<4} {r['title']}")
            time.sleep(3)

        # If everything blocked, try one pass with a fresh context per request
        # (new fingerprint/session each time) on the baseline sold URL.
        if not any(r["ok"] for r in rows if "ACTIVE control" not in r["label"]):
            print("\nall sold variants blocked — retrying baseline with a FRESH context")
            ctx2 = browser.new_context(
                user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                            "(KHTML, like Gecko) Version/17.4 Safari/605.1.15"),
                viewport={"width": 1512, "height": 982},
                locale="en-US",
            )
            p2 = ctx2.new_page()
            if HAS_STEALTH:
                try:
                    stealth_sync(p2)
                except Exception:
                    pass
            r = probe(p2, "FRESH-CTX safari sold", VARIANTS[2][1], warm_first=True)
            rows.append(r)
            print(f"  [{'OK ' if r['ok'] else 'BLK'}] {r['label']:38s} n={r['results']:<4} {r['title']}")

        browser.close()

    print("\n==== SUMMARY ====")
    winners = [r for r in rows if r["ok"]]
    for r in rows:
        print(f"{'OK ' if r['ok'] else 'BLK'}  n={r['results']:<4} {r['label']}  |  {r['title']}")
    if winners:
        print(f"\nWORKING VARIANTS: {[w['label'] for w in winners]}")
    else:
        print("\nNO WORKING SOLD VARIANT from this runner IP.")
    sys.exit(0)


if __name__ == "__main__":
    main()
