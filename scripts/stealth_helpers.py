"""
Shared stealth/warm-up helpers for all Playwright scrapers.

Used to defeat (or clearly diagnose) Cloudflare, Akamai, DataDome etc. across
Goldin / PWCC / MySlabs / Fanatics / Heritage / etc. When a site is truly
blocking us, we dump the first 500 chars of response body + screenshot to the
logs so we can SEE what's happening instead of guessing.
"""
import os
import random
import logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger("stealth")

ARTIFACTS_DIR = Path(os.environ.get("GITHUB_WORKSPACE", ".")) / "scrape_artifacts"
ARTIFACTS_DIR.mkdir(exist_ok=True)

# Mac Chrome UAs tend to pass cf_chl_jschl_tk challenges better than Linux ones.
UA_STRINGS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
]

DEFAULT_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}


def build_stealth_context(browser, user_agent: str | None = None):
    """Return a new browsing context with our standard stealth profile."""
    return browser.new_context(
        user_agent=user_agent or random.choice(UA_STRINGS),
        viewport={"width": 1440 + random.randint(-40, 40), "height": 900 + random.randint(-30, 30)},
        locale="en-US",
        timezone_id="America/New_York",
        extra_http_headers=DEFAULT_HEADERS,
        color_scheme="light",
        device_scale_factor=2,
        has_touch=False,
        is_mobile=False,
    )


def human_dwell(page, seconds: float = 5.0):
    """Simulate a real person landing on a page: random mouse move, scroll, dwell."""
    try:
        page.mouse.move(random.randint(100, 800), random.randint(100, 600), steps=random.randint(5, 15))
        page.wait_for_timeout(int(seconds * 300))
        page.evaluate("window.scrollBy(0, document.body.scrollHeight/3)")
        page.wait_for_timeout(int(seconds * 300))
        page.mouse.move(random.randint(200, 1200), random.randint(300, 700), steps=random.randint(5, 15))
        page.evaluate("window.scrollBy(0, document.body.scrollHeight/3)")
        page.wait_for_timeout(int(seconds * 400))
    except Exception as e:
        log.debug(f"dwell failed: {e}")


def warm_up(page, home_url: str, source_name: str):
    """Visit the homepage, accept cookies, dwell — helps with Cloudflare."""
    try:
        page.goto(home_url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        # Common cookie accept buttons
        for sel in [
            'button:has-text("Accept")', 'button:has-text("Agree")',
            'button:has-text("Allow all")', 'button:has-text("Got it")',
            '[aria-label*="accept"i]', '#onetrust-accept-btn-handler',
        ]:
            try:
                btn = page.locator(sel).first
                if btn and btn.is_visible(timeout=1000):
                    btn.click(timeout=2000)
                    log.info(f"{source_name}: accepted cookies via {sel}")
                    page.wait_for_timeout(1200)
                    break
            except Exception:
                continue
        human_dwell(page, 2.5)
        log.info(f"{source_name} warm-up OK: {(page.title() or '')[:60]}")
        return True
    except Exception as e:
        log.warning(f"{source_name} warm-up failed: {e}")
        return False


def detect_block(page, source_name: str):
    """Return (is_blocked: bool, reason: str). Dumps evidence on block."""
    try:
        title = (page.title() or "").strip()
        url = page.url
        tl = title.lower()
        status = None
        # Approximate HTTP status check via response body signals (Playwright doesn't easily expose last status after nav)
        body_text = ""
        try:
            body_text = page.evaluate("() => document.body ? document.body.innerText.slice(0, 800) : ''") or ""
        except Exception:
            pass
        bl = body_text.lower()

        reasons = []
        if "just a moment" in tl or "just a moment" in bl or "checking your browser" in bl:
            reasons.append("Cloudflare JS challenge")
        if "access denied" in tl or "access denied" in bl:
            reasons.append("Access denied (WAF)")
        if "attention required" in tl or "attention required" in bl:
            reasons.append("Cloudflare Attention Required")
        if "captcha" in bl or "unusual traffic" in bl:
            reasons.append("CAPTCHA / unusual traffic")
        if "are you a robot" in bl or "please verify" in bl:
            reasons.append("Bot challenge")
        if "please log in" in bl or "sign in to continue" in bl:
            reasons.append("Login wall")
        if "403 forbidden" in bl or "error 1020" in bl:
            reasons.append("403 / CF firewall")

        is_blocked = bool(reasons)
        if is_blocked:
            # Dump evidence
            ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            fname = ARTIFACTS_DIR / f"{source_name}_block_{ts}.png"
            try:
                page.screenshot(path=str(fname), full_page=False)
                log.warning(f"{source_name} BLOCKED: {', '.join(reasons)} | title={title[:80]} | url={url[:100]}")
                log.warning(f"  body[:500]: {body_text[:500]!r}")
                log.warning(f"  screenshot: {fname}")
            except Exception as e:
                log.warning(f"{source_name} BLOCKED but screenshot failed: {e}")
            return True, ", ".join(reasons)
        return False, ""
    except Exception as e:
        return False, f"detect_block error: {e}"


def apply_stealth(page):
    """Apply tf-playwright-stealth if present. Returns True if applied."""
    try:
        from tf_playwright_stealth import stealth_sync
        stealth_sync(page)
        return True
    except ImportError:
        return False
    except Exception as e:
        log.debug(f"stealth init failed: {e}")
        return False
