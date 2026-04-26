"""
Historical year backfill — pulls sold listings for a given (year, set_id) via
the eBay Finding API and writes them into sold_cards_archive.

Isolated by design:
  - Writes only to sold_cards_archive (NOT sold_cards) so nothing leaks into
    UI queries that target sold_cards.
  - No frontend code touches sold_cards_archive.
  - No Vercel cron is wired to this script.

Usage:
    python scripts/backfill/scrape_historical_year.py --year 2024 --set-id topps-chrome-2024
    python scripts/backfill/scrape_historical_year.py --year 2023 --set-id topps-chrome-2023 --pages 3

Env:
    EBAY_APP_ID         (required)
    DATABASE_URL        (Postgres) or default SQLite path
"""
import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime
from typing import Optional

# Allow running from repo root: add backend/ to sys.path
_THIS = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_THIS, "..", ".."))
sys.path.insert(0, os.path.join(_REPO, "backend"))

from database import SessionLocal, SoldCardArchive, CardSet, create_tables  # noqa: E402
from ebay_finding_api import fetch_sold_for_query  # noqa: E402
from sold_ingest import _grade_from_title, _parallel_from_title, _match_driver  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill")


# Per-year driver rosters — drives the driver × parallel matrix.
DRIVER_ROSTERS = {
    2020: ["Hamilton", "Bottas", "Verstappen", "Albon", "Leclerc", "Vettel", "Sainz",
           "Norris", "Ricciardo", "Ocon", "Gasly", "Kvyat", "Stroll", "Perez",
           "Hulkenberg", "Magnussen", "Grosjean", "Raikkonen", "Giovinazzi",
           "Russell", "Latifi"],
    2021: ["Hamilton", "Bottas", "Verstappen", "Perez", "Leclerc", "Sainz", "Norris",
           "Ricciardo", "Alonso", "Ocon", "Gasly", "Tsunoda", "Stroll", "Vettel",
           "Mazepin", "Schumacher", "Raikkonen", "Giovinazzi", "Russell", "Latifi"],
    2022: ["Hamilton", "Russell", "Verstappen", "Perez", "Leclerc", "Sainz", "Norris",
           "Ricciardo", "Alonso", "Ocon", "Gasly", "Tsunoda", "Stroll", "Vettel",
           "Schumacher", "Bottas", "Zhou", "Albon", "Latifi", "Hulkenberg"],
    2023: ["Verstappen", "Perez", "Hamilton", "Russell", "Leclerc", "Sainz", "Norris",
           "Piastri", "Alonso", "Stroll", "Gasly", "Ocon", "Bottas", "Zhou", "Tsunoda",
           "Lawson", "Ricciardo", "Magnussen", "Hulkenberg", "Albon", "Sargeant"],
    2024: ["Verstappen", "Perez", "Hamilton", "Russell", "Leclerc", "Sainz", "Bearman",
           "Norris", "Piastri", "Alonso", "Stroll", "Gasly", "Ocon", "Bottas", "Zhou",
           "Tsunoda", "Ricciardo", "Lawson", "Magnussen", "Hulkenberg", "Albon",
           "Sargeant", "Colapinto"],
    2025: ["Verstappen", "Hamilton", "Leclerc", "Norris", "Piastri", "Alonso", "Sainz",
           "Russell", "Antonelli", "Bearman", "Bortoleto", "Lawson", "Hadjar", "Doohan",
           "Tsunoda", "Hulkenberg", "Albon", "Stroll", "Gasly", "Ocon", "Colapinto"],
}

# Parallel queries — broad coverage of the chase parallels collectors search for.
PARALLEL_QUERIES = [
    "Refractor", "Auto", "Autograph", "Superfractor", "Red", "Orange", "Gold",
    "Green", "Blue", "Aqua", "Pink", "X-Fractor", "Sapphire", "Ray Wave",
    "Prism", "Negative",
]


def _set_query_prefix(set_id: str, year: int) -> str:
    """Map set_id to the eBay search prefix that best targets that product."""
    if "sapphire" in set_id:
        return f"{year} Topps Chrome Sapphire F1"
    if "finest" in set_id:
        return f"{year} Topps Finest Formula 1"
    if "flagship" in set_id:
        return f"{year} Topps Formula 1"
    return f"{year} Topps Chrome Formula 1"


def _validate_listing_for_year(title: str, year: int) -> bool:
    """Lighter validator than _is_valid_2025_f1_listing — just checks year + brand fit."""
    t = title.lower()
    if str(year) not in title:
        return False
    if "topps" not in t:
        return False
    # Reject obvious non-F1 noise
    bad = ["nfl", "nba", "mlb", "soccer", "hockey", "wwe", "ufc", "pokemon"]
    if any(b in t for b in bad):
        return False
    return True


async def backfill_year(year: int, set_id: str, pages: int = 2, sleep_between: float = 1.0,
                         max_queries: Optional[int] = None) -> dict:
    """Run sold-listing backfill for one (year, set_id). Returns counters."""
    db = SessionLocal()
    create_tables()  # ensure card_sets + sold_cards_archive exist locally

    # Verify set_id is registered
    cs = db.query(CardSet).filter(CardSet.id == set_id).first()
    if not cs:
        return {"error": f"unknown set_id: {set_id}"}
    if cs.year != year:
        return {"error": f"set_id {set_id} year={cs.year} but --year={year}"}

    drivers = DRIVER_ROSTERS.get(year, [])
    if not drivers:
        return {"error": f"no driver roster for year {year}"}

    prefix = _set_query_prefix(set_id, year)
    added = 0
    skipped_dupe = 0
    skipped_invalid = 0
    skipped_zero = 0
    queries_run = 0
    errors: list[str] = []

    try:
        for driver_last in drivers:
            for parallel_q in PARALLEL_QUERIES:
                if max_queries and queries_run >= max_queries:
                    break
                q = f"{prefix} {driver_last} {parallel_q}".strip()
                queries_run += 1
                try:
                    items = await fetch_sold_for_query(q, pages=pages)
                except Exception as e:
                    errors.append(f"{q}: {str(e)[:80]}")
                    items = []

                for item in items:
                    title = item.get("title", "")
                    if not _validate_listing_for_year(title, year):
                        skipped_invalid += 1
                        continue

                    ebay_item_id = item.get("ebay_item_id", "")
                    if not ebay_item_id:
                        continue

                    price = float(item.get("price") or 0)
                    if price <= 0:
                        skipped_zero += 1
                        continue

                    if db.query(SoldCardArchive).filter(
                        SoldCardArchive.ebay_item_id == ebay_item_id
                    ).first():
                        skipped_dupe += 1
                        continue

                    parallel = _parallel_from_title(title)
                    grade = _grade_from_title(title)
                    matched_driver = _match_driver(title) or driver_last
                    sale_date = item.get("sale_date") or datetime.utcnow()

                    raw_id = ebay_item_id.split("|")[1] if "|" in ebay_item_id else ebay_item_id
                    db.add(SoldCardArchive(
                        set_id=set_id,
                        year=year,
                        ebay_item_id=ebay_item_id,
                        title=title,
                        driver_name=matched_driver,
                        parallel=parallel,
                        grade=grade,
                        condition=item.get("condition"),
                        sale_price=price,
                        sale_date=sale_date,
                        ebay_url=f"https://www.ebay.com/itm/{raw_id}",
                        is_auction=False,
                        series="F1",
                        source="eBay",
                        is_duplicate=False,
                        scraped_at=datetime.utcnow(),
                    ))
                    added += 1

                # Commit every 5 queries so partial progress survives interrupts
                if queries_run % 5 == 0:
                    try:
                        db.commit()
                    except Exception as e:
                        errors.append(f"commit: {str(e)[:80]}")
                        db.rollback()

                await asyncio.sleep(sleep_between)
            if max_queries and queries_run >= max_queries:
                break

        try:
            db.commit()
        except Exception as e:
            errors.append(f"final commit: {str(e)[:80]}")
            db.rollback()
    finally:
        db.close()

    return {
        "year": year,
        "set_id": set_id,
        "queries_run": queries_run,
        "added": added,
        "skipped_dupe": skipped_dupe,
        "skipped_invalid": skipped_invalid,
        "skipped_zero": skipped_zero,
        "errors": errors[:10],
    }


def main():
    parser = argparse.ArgumentParser(description="Historical year backfill (sold cards)")
    parser.add_argument("--year", type=int, required=True, help="Set year e.g. 2024")
    parser.add_argument("--set-id", required=True, help="card_sets.id e.g. topps-chrome-2024")
    parser.add_argument("--pages", type=int, default=2, help="Pages per query (default 2 = 200 items)")
    parser.add_argument("--sleep", type=float, default=1.0, help="Sleep seconds between queries")
    parser.add_argument("--max-queries", type=int, default=None, help="Cap query count (smoke test)")
    args = parser.parse_args()

    if not os.getenv("EBAY_APP_ID"):
        logger.error("EBAY_APP_ID not set — aborting")
        sys.exit(1)

    result = asyncio.run(backfill_year(
        year=args.year,
        set_id=args.set_id,
        pages=args.pages,
        sleep_between=args.sleep,
        max_queries=args.max_queries,
    ))
    logger.info(f"backfill result: {result}")
    if result.get("error"):
        sys.exit(2)


if __name__ == "__main__":
    main()
