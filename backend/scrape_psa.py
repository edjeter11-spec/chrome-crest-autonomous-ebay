"""
PSA auction price scraper.
Pulls graded card sale prices from PSA's auction results pages and stores
them in price_history. Best run after the set has 60+ days on market.

Usage:
    python scrape_psa.py

PSA URL format:
    https://www.psacard.com/auctionprices/trading-card-singles/
        2025-topps-chrome-formula-1/{driver-slug}/values/0
"""
import re, time
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

from database import SessionLocal, create_tables, Card, PriceHistory
create_tables()

# PSA driver slugs — must match PSA's URL format exactly
# These are guesses; PSA may not have all drivers yet for a new set
PSA_DRIVER_SLUGS = {
    "Max Verstappen":    "max-verstappen",
    "Lewis Hamilton":    "lewis-hamilton",
    "Charles Leclerc":  "charles-leclerc",
    "Lando Norris":     "lando-norris",
    "Fernando Alonso":  "fernando-alonso",
    "Oscar Piastri":    "oscar-piastri",
    "Carlos Sainz":     "carlos-sainz",
    "George Russell":   "george-russell",
    "Sergio Perez":     "sergio-perez",
    "Pierre Gasly":     "pierre-gasly",
}

PSA_BASE = "https://www.psacard.com/auctionprices/trading-card-singles/2025-topps-chrome-formula-1"


def _parse_psa_price(text: str) -> float:
    m = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    return float(m.group()) if m else 0.0


def _parse_psa_date(text: str) -> datetime | None:
    for fmt in ("%m/%d/%Y", "%b %Y", "%Y"):
        try:
            return datetime.strptime(text.strip(), fmt)
        except ValueError:
            continue
    return None


def scrape_psa_driver(driver_name: str, slug: str) -> list[dict]:
    from playwright.sync_api import sync_playwright
    results = []
    seen = set()

    url = f"{PSA_BASE}/{slug}/values/0"
    print(f"  Fetching: {url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            # PSA uses server-side rendering — wait for table
            page.wait_for_selector("table", timeout=15_000)
        except Exception as e:
            print(f"  PSA load error for {driver_name}: {e}")
            browser.close()
            return []

        # Find all table rows with sale data
        rows = page.query_selector_all("tbody tr")
        for row in rows:
            try:
                cells = row.query_selector_all("td")
                if len(cells) < 4:
                    continue

                grade_text = cells[0].inner_text().strip()   # e.g. "PSA 10"
                sale_text  = cells[2].inner_text().strip()   # e.g. "$125.00"
                date_text  = cells[3].inner_text().strip()   # e.g. "03/15/2025"
                lot_text   = cells[1].inner_text().strip()   # lot/title description

                price = _parse_psa_price(sale_text)
                sale_date = _parse_psa_date(date_text)
                if not price or not sale_date:
                    continue

                # Build a pseudo item ID from grade + price + date to dedup
                pseudo_id = f"psa_{slug}_{grade_text}_{date_text}_{price}"
                if pseudo_id in seen:
                    continue
                seen.add(pseudo_id)

                results.append({
                    "ebay_item_id": pseudo_id,
                    "title": f"2025 Topps Chrome F1 {driver_name} {lot_text}",
                    "price": price,
                    "sale_date": sale_date,
                    "condition": grade_text,
                    "source": "PSA Auction",
                })
            except Exception:
                continue

        browser.close()

    return results


def write_to_db(driver_name: str, sales: list[dict]) -> int:
    db = SessionLocal()
    added = 0
    try:
        for s in sales:
            if db.query(PriceHistory).filter(
                PriceHistory.ebay_item_id == s["ebay_item_id"]
            ).first():
                continue

            card = db.query(Card).filter(Card.driver_name == driver_name).first()
            if not card:
                continue

            db.add(PriceHistory(
                card_id=card.id,
                price=s["price"],
                sale_date=s["sale_date"],
                source=s["source"],
                condition=s["condition"],
                ebay_item_id=s["ebay_item_id"],
            ))
            added += 1

        if added:
            db.commit()
    finally:
        db.close()
    return added


def run():
    total = 0
    for driver, slug in PSA_DRIVER_SLUGS.items():
        print(f"\nPSA: {driver}")
        try:
            sales = scrape_psa_driver(driver, slug)
            print(f"  scraped {len(sales)} PSA sales")
            added = write_to_db(driver, sales)
            print(f"  wrote {added} new records")
            total += added
        except Exception as e:
            print(f"  ERROR: {e}")
        time.sleep(2)

    print(f"\nPSA done. Total new records: {total}")


if __name__ == "__main__":
    run()
