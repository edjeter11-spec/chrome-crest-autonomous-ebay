"""
One-shot runner that executes the foundation-layer DB ops against the remote
Neon Postgres (DATABASE_URL loaded from .env.production):

  1. migrate-dedup-flag  (ALTER TABLE ... ADD COLUMN IF NOT EXISTS is_duplicate ...)
  2. backfill-dedup      (mark all-but-earliest in each fingerprint group)
  3. run_enhanced_snipe_alerts  (tick the alert engine once)
  4. sample /api/sales/stats-equivalent output (median vs mean for top parallel)

Safe to re-run — every step is idempotent.
"""
import os
import sys
import json
from pathlib import Path


# Load env from .env.production
ENV_FILE = Path(__file__).resolve().parent.parent / ".env.production"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v.strip('"'))

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text  # noqa: E402
from database import engine, SessionLocal, SoldCard  # noqa: E402


def migrate():
    print("=== MIGRATE ===")
    stmts = [
        "ALTER TABLE sold_cards ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT FALSE",
        "UPDATE sold_cards SET is_duplicate = FALSE WHERE is_duplicate IS NULL",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_is_duplicate ON sold_cards (is_duplicate)",
    ]
    with engine.connect() as conn:
        for s in stmts:
            try:
                conn.execute(text(s))
                conn.commit()
                print(f"  OK  {s[:80]}")
            except Exception as e:
                print(f"  ERR {s[:80]}  -> {e}")


def backfill():
    print("=== BACKFILL DEDUP ===")
    from dedup import backfill_duplicates
    r = backfill_duplicates()
    print(json.dumps(r, indent=2))
    return r


def alert_tick():
    print("=== RUN_ENHANCED_SNIPE_ALERTS ===")
    from scraper import run_enhanced_snipe_alerts
    db = SessionLocal()
    try:
        created = run_enhanced_snipe_alerts(db)
        print(f"  Alerts created: {len(created)}")
        for i, a in enumerate(created[:5]):
            print(f"  [{i+1}] urgency={a.urgency}")
            print(f"      {a.message}")
        return len(created), created[0].message if created else None
    finally:
        db.close()


def sample_median_vs_mean():
    print("=== MEDIAN VS MEAN SAMPLE ===")
    db = SessionLocal()
    try:
        # Pick the top parallel by volume for Lewis Hamilton (if present) else
        # the top parallel overall.
        from sqlalchemy import func
        row = db.query(
            SoldCard.driver_name, SoldCard.parallel,
            func.count(SoldCard.id).label("c"),
        ).filter(
            SoldCard.is_duplicate == False,  # noqa: E712
            SoldCard.driver_name.isnot(None),
            SoldCard.parallel.isnot(None),
        ).group_by(SoldCard.driver_name, SoldCard.parallel).order_by(
            func.count(SoldCard.id).desc()
        ).first()
        if not row:
            print("  No data")
            return
        driver, parallel, _cnt = row
        rows = db.query(SoldCard).filter(
            SoldCard.driver_name == driver,
            SoldCard.parallel == parallel,
            SoldCard.is_duplicate == False,  # noqa: E712
            SoldCard.sale_price > 0,
        ).all()
        vals = sorted(float(r.sale_price) + float(r.shipping_cost or 0) for r in rows)
        n = len(vals)
        mean = sum(vals) / n if n else 0
        median = vals[n // 2] if n and n % 2 else ((vals[n // 2 - 1] + vals[n // 2]) / 2 if n else 0)
        print(json.dumps({
            "driver": driver,
            "parallel": parallel,
            "n": n,
            "min": round(vals[0], 2) if vals else None,
            "max": round(vals[-1], 2) if vals else None,
            "mean": round(mean, 2),
            "median": round(median, 2),
            "skew_ratio_mean_over_median": round(mean / median, 2) if median else None,
        }, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
    r = backfill()
    sample_median_vs_mean()
    n_alerts, sample_msg = alert_tick()
    print("\n=== SUMMARY ===")
    print(json.dumps({
        "rows_marked_duplicate": r.get("rows_marked_duplicate"),
        "fingerprint_groups": r.get("fingerprint_groups"),
        "duplicate_groups": r.get("duplicate_groups"),
        "alerts_created_this_tick": n_alerts,
        "sample_alert": sample_msg,
    }, indent=2))
