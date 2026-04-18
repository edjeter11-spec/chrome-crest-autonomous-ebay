"""
One-shot data quality sweep against production Neon DB.

Requires DATABASE_URL in env (pull via `vercel env pull .env.prod` first, then
`set -a; . .env.prod; set +a`).

Actions:
  1. Delete sold_cards rows where sale_price < 0.50 AND grade IS NULL.
  2. Delete sold_cards rows where sale_price > 50000 (outliers).
  3. Backfill driver_name on sold_cards rows where it's NULL, using the
     65-driver list + team fallbacks from scrape_runner.py.
  4. Mark auctions.status='ended' where status='active' AND end_time < NOW().
  5. Leave seller='ebay_seller' placeholder rows as-is.
  6. Print before/after counts.
"""
import os
import re
import sys
import psycopg2

sys.path.insert(0, os.path.dirname(__file__))
from scrape_runner import DRIVERS, TEAMS  # noqa: E402

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    print("DATABASE_URL not set — abort")
    sys.exit(1)


def driver_from_title(title: str):
    t = (title or "").lower()
    for d in DRIVERS:
        if d.lower() in t:
            return d
        last = d.split()[-1].lower()
        if len(last) > 4 and re.search(rf"\b{re.escape(last)}\b", t):
            return d
    for canonical, aliases in TEAMS:
        if any(a in t for a in aliases):
            return f"{canonical} (Team)"
    return None


def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    print("=== DATA QUALITY SWEEP ===")

    # Before snapshot
    cur.execute("SELECT COUNT(*) FROM sold_cards")
    sold_before = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM auctions")
    auc_before = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sold_cards WHERE driver_name IS NULL")
    null_drv_before = cur.fetchone()[0]
    print(f"Before: sold_cards={sold_before} auctions={auc_before} null_driver={null_drv_before}")

    # 1. Delete cheap noise
    cur.execute("DELETE FROM sold_cards WHERE sale_price < 0.50 AND grade IS NULL")
    deleted_cheap = cur.rowcount
    print(f"[1] Deleted sold_cards < $0.50 & ungraded: {deleted_cheap}")

    # 2. Delete impossible outliers
    cur.execute("DELETE FROM sold_cards WHERE sale_price > 50000")
    deleted_outliers = cur.rowcount
    print(f"[2] Deleted sold_cards > $50k outliers: {deleted_outliers}")

    conn.commit()

    # 3. Driver backfill
    cur.execute("SELECT id, title FROM sold_cards WHERE driver_name IS NULL")
    rows = cur.fetchall()
    print(f"[3] Attempting driver backfill on {len(rows)} rows...")
    backfilled = 0
    for rid, title in rows:
        drv = driver_from_title(title or "")
        if drv:
            cur.execute("UPDATE sold_cards SET driver_name=%s WHERE id=%s", (drv, rid))
            backfilled += 1
    conn.commit()
    print(f"[3] Backfilled driver_name: {backfilled}")

    # 4. Mark stale active auctions as ended
    cur.execute("UPDATE auctions SET status='ended' WHERE status='active' AND end_time < NOW()")
    ended = cur.rowcount
    print(f"[4] Marked auctions ended: {ended}")

    # 5. Placeholder sellers — leave as-is, just report
    cur.execute("SELECT COUNT(*) FROM auctions WHERE seller='ebay_seller'")
    placeholder = cur.fetchone()[0]
    print(f"[5] Placeholder-seller rows left untouched: {placeholder}")

    conn.commit()

    # After snapshot
    cur.execute("SELECT COUNT(*) FROM sold_cards")
    sold_after = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM auctions")
    auc_after = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sold_cards WHERE driver_name IS NULL")
    null_drv_after = cur.fetchone()[0]

    print("=== SUMMARY ===")
    print(f"sold_cards: {sold_before} -> {sold_after} (-{sold_before - sold_after})")
    print(f"auctions:   {auc_before} -> {auc_after}")
    print(f"null driver: {null_drv_before} -> {null_drv_after}")
    print(f"deleted_cheap={deleted_cheap} deleted_outliers={deleted_outliers}")
    print(f"backfilled_drivers={backfilled} ended_auctions={ended}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
