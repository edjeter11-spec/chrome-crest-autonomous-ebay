"""
Bulk eBay sold-listings scraper using Playwright.
Pulls 90 days of completed sales for all 20 F1 drivers and writes them
directly into the price_history table.

Usage (run from backend/):
    python scrape_ebay_sold.py

Requires:
    pip install playwright
    playwright install chromium
"""
import os, re, time, asyncio
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ── DB setup ──────────────────────────────────────────────────────────────────
from database import SessionLocal, create_tables, Card, PriceHistory, engine
from sqlalchemy import text as _sa_text

create_tables()

# Ensure ebay_item_id column exists (local SQLite migration)
with engine.connect() as _conn:
    try:
        _conn.execute(_sa_text("ALTER TABLE price_history ADD COLUMN ebay_item_id VARCHAR(64)"))
        _conn.commit()
    except Exception:
        pass

F1_DRIVERS = [
    "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
    "Fernando Alonso", "Oscar Piastri", "Carlos Sainz", "George Russell",
    "Sergio Perez", "Lance Stroll", "Valtteri Bottas", "Esteban Ocon",
    "Pierre Gasly", "Yuki Tsunoda", "Nico Hulkenberg", "Kevin Magnussen",
    "Zhou Guanyu", "Alexander Albon", "Gabriel Bortoleto", "Liam Lawson",
]

PAGES_PER_DRIVER = 5   # 5 × ~50 items ≈ 250 sold listings per driver


def _parse_price(text: str) -> float:
    m = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    return float(m.group()) if m else 0.0


def _parse_date(text: str) -> datetime | None:
    # eBay shows e.g. "Apr 15, 2025" or "Apr 15"
    text = re.sub(r"^(Sold|sold)\s*", "", text.strip())
    for fmt in ("%b %d, %Y", "%b %d"):
        try:
            d = datetime.strptime(text, fmt)
            if d.year == 1900:
                d = d.replace(year=datetime.utcnow().year)
            return d
        except ValueError:
            continue
    return None


def _grade_from_title(title: str) -> str | None:
    t = title.upper()
    for g in ("PSA 10", "PSA 9", "PSA 8", "PSA 7", "BGS 9.5", "BGS 9", "CGC 10", "CGC 9.5"):
        if g in t:
            return g
    return None


def _parallel_from_title(title: str) -> str:
    t = title.upper()
    if "1/1" in t or "SUPERFRACTOR" in t: return "Superfractor 1/1"
    if "/5"  in t and "RED"    in t: return "Red /5"
    if "/25" in t and "ORANGE" in t: return "Orange /25"
    if "/50" in t and "GOLD"   in t: return "Gold /50"
    if "/99" in t and "GREEN"  in t: return "Green /99"
    if "/150" in t and "BLUE"  in t: return "Blue /150"
    if "PRISM" in t or "PRIZM" in t:  return "Prism Refractor"
    # Only tag as Autograph if it's clearly an autograph card, not e.g. "CAC-" or "AUTO REFRACTOR"
    if " AUTO " in t or t.endswith(" AUTO") or "AUTOGRAPH" in t or "#CAC-" in t: return "Autograph"
    if "REFRACTOR" in t:              return "Refractor"
    return "Base"


def scrape_driver(driver_name: str) -> list[dict]:
    """Scrape completed eBay listings for one driver. Returns list of sale dicts."""
    from playwright.sync_api import sync_playwright

    # Some last names are too generic — use full name for those
    FULL_NAME_DRIVERS = {"Sergio Perez", "Alexander Albon", "Valtteri Bottas",
                         "Kevin Magnussen", "Zhou Guanyu", "Oliver Bearman"}
    if driver_name in FULL_NAME_DRIVERS:
        query = f"2025 Topps Chrome F1 {driver_name}"
    else:
        last = driver_name.split()[-1]
        query = f"2025 Topps Chrome F1 {last}"
    results = []
    seen = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.new_page()

        for pg in range(1, PAGES_PER_DRIVER + 1):
            url = (
                f"https://www.ebay.com/sch/i.html"
                f"?_nkw={query.replace(' ', '+')}"
                f"&LH_Complete=1&LH_Sold=1&_sop=13"   # _sop=13 = end date recent
                f"&_pgn={pg}&_ipg=60"
            )
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                # Wait for listings to render
                page.wait_for_selector("li[id^='item']", timeout=15_000)
            except Exception as e:
                print(f"  [{driver_name}] page {pg} load error: {e}")
                break

            items = page.query_selector_all("li[id^='item']")
            if not items:
                break

            page_count = 0
            for item in items:
                try:
                    # Item ID from data-listingid attribute
                    item_id = item.get_attribute("data-listingid") or ""
                    if not item_id or item_id in seen:
                        continue

                    title_el = item.query_selector(".s-card__title")
                    price_el = item.query_selector(".s-card__price")
                    date_el  = item.query_selector(".su-styled-text.positive")

                    if not title_el or not price_el:
                        continue

                    title = title_el.inner_text().split("\n")[0].strip()
                    if not title or "2025" not in title.lower():
                        continue

                    price_text = price_el.inner_text().strip().split(" to ")[0]
                    price = _parse_price(price_text)
                    if price <= 0:
                        continue

                    date_text = date_el.inner_text().strip() if date_el else ""
                    sale_date = _parse_date(date_text) or datetime.utcnow()

                    seen.add(item_id)

                    condition_el = item.query_selector(".s-card__secondary-info")
                    condition = condition_el.inner_text().strip() if condition_el else "Used"

                    results.append({
                        "ebay_item_id": item_id,
                        "title": title,
                        "price": price,
                        "sale_date": sale_date,
                        "condition": _grade_from_title(title) or condition,
                        "parallel": _parallel_from_title(title),
                    })
                    page_count += 1
                except Exception:
                    continue

            print(f"  [{driver_name}] page {pg}: {page_count} items")
            if page_count < 10:  # sparse page = no more results
                break
            time.sleep(1.5)  # polite delay between pages

        browser.close()

    return results


def write_to_db(driver_name: str, sales: list[dict]) -> int:
    db = SessionLocal()
    added = 0
    try:
        for s in sales:
            # Skip if already stored
            if db.query(PriceHistory).filter(
                PriceHistory.ebay_item_id == s["ebay_item_id"]
            ).first():
                continue

            # Match card
            card = (
                db.query(Card).filter(
                    Card.driver_name == driver_name,
                    Card.parallel == s["parallel"],
                ).first()
                or db.query(Card).filter(Card.driver_name == driver_name).first()
            )
            if not card:
                continue

            db.add(PriceHistory(
                card_id=card.id,
                price=s["price"],
                sale_date=s["sale_date"],
                source="eBay Sold",
                condition=s["condition"],
                ebay_item_id=s["ebay_item_id"],
            ))
            added += 1

        if added:
            db.commit()
    finally:
        db.close()
    return added


def scrape_driver_psa(driver_name: str) -> list[dict]:
    """Extra pass: search specifically for PSA-graded sold listings."""
    from playwright.sync_api import sync_playwright

    last = driver_name.split()[-1]
    query = f"2025 Topps Chrome F1 {last} PSA"
    results = []
    seen = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.new_page()

        for pg in range(1, 4):  # 3 pages × 60 ≈ 180 PSA graded sold
            url = (
                f"https://www.ebay.com/sch/i.html"
                f"?_nkw={query.replace(' ', '+')}"
                f"&LH_Complete=1&LH_Sold=1&_sop=13"
                f"&_pgn={pg}&_ipg=60"
            )
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                page.wait_for_selector("li[id^='item']", timeout=15_000)
            except Exception:
                break

            items = page.query_selector_all("li[id^='item']")
            if not items:
                break

            page_count = 0
            for item in items:
                try:
                    item_id = item.get_attribute("data-listingid") or ""
                    if not item_id or item_id in seen:
                        continue

                    title_el = item.query_selector(".s-card__title")
                    price_el = item.query_selector(".s-card__price")
                    date_el  = item.query_selector(".su-styled-text.positive")

                    if not title_el or not price_el:
                        continue

                    title = title_el.inner_text().split("\n")[0].strip()
                    if not title or "2025" not in title.lower():
                        continue

                    grade = _grade_from_title(title)
                    if not grade:
                        continue  # PSA pass only stores graded records

                    price_text = price_el.inner_text().strip().split(" to ")[0]
                    price = _parse_price(price_text)
                    if price <= 0:
                        continue

                    date_text = date_el.inner_text().strip() if date_el else ""
                    sale_date = _parse_date(date_text) or datetime.utcnow()

                    seen.add(item_id)
                    results.append({
                        "ebay_item_id": item_id,
                        "title": title,
                        "price": price,
                        "sale_date": sale_date,
                        "condition": grade,
                        "parallel": _parallel_from_title(title),
                    })
                    page_count += 1
                except Exception:
                    continue

            print(f"  [PSA {driver_name}] page {pg}: {page_count} graded items")
            if page_count < 5:
                break
            time.sleep(1.5)

        browser.close()
    return results


def run():
    total_added = 0
    for i, driver in enumerate(F1_DRIVERS):
        print(f"\n[{i+1}/{len(F1_DRIVERS)}] Scraping: {driver}")
        try:
            sales = scrape_driver(driver)
            print(f"  scraped {len(sales)} sales")
            added = write_to_db(driver, sales)
            print(f"  wrote {added} new records to DB")
            total_added += added
        except Exception as e:
            print(f"  ERROR: {e}")
        if i < len(F1_DRIVERS) - 1:
            time.sleep(3)

    print(f"\nDone. Total new price_history records: {total_added}")


def run_psa():
    """Dedicated PSA graded pass — searches [driver] PSA to surface graded sold listings."""
    total_added = 0
    for i, driver in enumerate(F1_DRIVERS):
        print(f"\n[PSA {i+1}/{len(F1_DRIVERS)}] {driver}")
        try:
            sales = scrape_driver_psa(driver)
            print(f"  scraped {len(sales)} PSA graded sales")
            added = write_to_db(driver, sales)
            print(f"  wrote {added} new records to DB")
            total_added += added
        except Exception as e:
            print(f"  ERROR: {e}")
        if i < len(F1_DRIVERS) - 1:
            time.sleep(2)
    print(f"\nPSA pass done. Total new records: {total_added}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "psa":
        run_psa()
    else:
        run()
