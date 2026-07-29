"""
One-shot recovery: migrate sold_cards stranded in the OLD Supabase DB into
the live Neon DB.

Background: the app migrated Supabase -> Neon on 2026-06-08, but the GitHub
Actions DATABASE_URL secret (set 2026-04-17) was never updated. For seven
weeks every scheduled scrape connected to Supabase, reported thousands of
successful upserts, and wrote into a database the site no longer reads.
Nothing errored. The Sales page silently froze at 2026-06-08 while the
scrapers "succeeded" 8x/day.

Those writes are real, valid sold comps — 36,912 rows scraped after the
migration. This moves them into Neon.

Safety:
  * READ-only against Supabase; never mutates the old DB.
  * ON CONFLICT (ebay_item_id) DO NOTHING — cannot create duplicates and
    cannot clobber anything Neon already has.
  * Batched with execute_values; commits per batch so a mid-run failure
    still leaves progress behind.
  * Idempotent: safe to re-run.

Usage (from repo root):
    SOURCE_URL=<supabase-url> TARGET_URL=<neon-url> python scripts/recover_orphaned_sold.py
Falls back to reading .env.prod (Supabase) and .env.neon (Neon) if the env
vars aren't set.
"""
import os
import re
import sys

import psycopg2
from psycopg2.extras import execute_values

# Only rows scraped after the migration are "orphaned". Anything older than
# this already exists in Neon (it was copied during the original migration).
CUTOFF = "2026-06-09"
BATCH = 1000

COLS = [
    "ebay_item_id", "title", "driver_name", "parallel", "grade", "condition",
    "sale_price", "sale_date", "image_url", "ebay_url", "is_auction", "series",
    "shipping_cost", "source", "scraped_at", "is_duplicate",
]


def _from_env_file(path: str):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = re.match(r'\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?', line)
                if m:
                    return m.group(1).strip()
    except FileNotFoundError:
        pass
    return None


def _host(url: str) -> str:
    try:
        return url.split("@", 1)[1].split("/", 1)[0]
    except Exception:
        return "<unparseable>"


def main():
    src = os.environ.get("SOURCE_URL") or _from_env_file(".env.prod")
    dst = os.environ.get("TARGET_URL") or _from_env_file(".env.neon")
    if not src or not dst:
        print("need SOURCE_URL (old Supabase) and TARGET_URL (Neon)")
        sys.exit(1)

    # Guard against running this backwards and pushing stale data around.
    if "supabase" not in _host(src):
        print(f"refusing: SOURCE {_host(src)} is not the old Supabase DB")
        sys.exit(1)
    if "neon.tech" not in _host(dst):
        print(f"refusing: TARGET {_host(dst)} is not the live Neon DB")
        sys.exit(1)

    print(f"source (read-only): {_host(src)}")
    print(f"target (write)    : {_host(dst)}")

    sconn = psycopg2.connect(src, connect_timeout=20)
    dconn = psycopg2.connect(dst, connect_timeout=20)

    with dconn.cursor() as c:
        c.execute("SELECT COUNT(*) FROM sold_cards")
        before = c.fetchone()[0]
    print(f"neon sold_cards before: {before}")

    sql = f"""
        INSERT INTO sold_cards ({", ".join(COLS)}) VALUES %s
        ON CONFLICT (ebay_item_id) DO NOTHING
    """

    moved = 0
    scanned = 0
    # Server-side cursor so 36k rows don't all land in memory at once.
    with sconn.cursor(name="orphan_cur") as sc:
        sc.itersize = BATCH
        sc.execute(
            f"SELECT {', '.join(COLS)} FROM sold_cards "
            f"WHERE scraped_at > %s ORDER BY scraped_at",
            (CUTOFF,),
        )
        batch = []
        for row in sc:
            batch.append(row)
            if len(batch) >= BATCH:
                scanned += len(batch)
                with dconn.cursor() as dc:
                    execute_values(dc, sql, batch)
                    moved += dc.rowcount
                dconn.commit()
                print(f"  scanned={scanned} inserted={moved}")
                batch = []
        if batch:
            scanned += len(batch)
            with dconn.cursor() as dc:
                execute_values(dc, sql, batch)
                moved += dc.rowcount
            dconn.commit()
            print(f"  scanned={scanned} inserted={moved}")

    with dconn.cursor() as c:
        c.execute("SELECT COUNT(*), MAX(sale_date), MAX(scraped_at) FROM sold_cards")
        after, newest_sale, newest_scrape = c.fetchone()

    print(f"\nDONE scanned={scanned} inserted={moved} (skipped dupes={scanned - moved})")
    print(f"neon sold_cards: {before} -> {after}")
    print(f"newest sale_date : {newest_sale}")
    print(f"newest scraped_at: {newest_scrape}")

    sconn.close()
    dconn.close()


if __name__ == "__main__":
    main()
