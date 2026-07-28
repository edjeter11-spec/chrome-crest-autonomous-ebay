"""
Daily snapshot system — captures DB state once per day for long-term trend charts.

Table: daily_snapshots
  id                   SERIAL PK
  snapshot_date        DATE UNIQUE
  total_sold_cards     INT
  total_active_auctions INT
  median_card_value    FLOAT
  total_market_value   FLOAT
  top_driver_by_value  TEXT
  snapshot_json        TEXT  (arbitrary metrics)
"""
import json
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from database import get_db, engine, Auction, SoldCard, Card
from lib.auth import require_admin

router = APIRouter(tags=["snapshots"])


@router.post("/api/admin/migrate-snapshots")
def migrate_snapshots(_admin=Depends(require_admin)):
    """Create daily_snapshots table + index (idempotent, Postgres + SQLite safe)."""
    statements = [
        """
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id SERIAL PRIMARY KEY,
            snapshot_date DATE NOT NULL UNIQUE,
            total_sold_cards INTEGER DEFAULT 0,
            total_active_auctions INTEGER DEFAULT 0,
            median_card_value FLOAT DEFAULT 0,
            total_market_value FLOAT DEFAULT 0,
            top_driver_by_value TEXT,
            snapshot_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_daily_snapshots_date ON daily_snapshots (snapshot_date)",
    ]
    # SQLite doesn't understand SERIAL — fall back to INTEGER PRIMARY KEY AUTOINCREMENT
    sqlite_stmt = """
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date DATE NOT NULL UNIQUE,
            total_sold_cards INTEGER DEFAULT 0,
            total_active_auctions INTEGER DEFAULT 0,
            median_card_value FLOAT DEFAULT 0,
            total_market_value FLOAT DEFAULT 0,
            top_driver_by_value TEXT,
            snapshot_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    results = []
    with engine.connect() as conn:
        dialect = conn.dialect.name
        for stmt in statements:
            try:
                if dialect == "sqlite" and "SERIAL" in stmt:
                    conn.execute(text(sqlite_stmt))
                else:
                    conn.execute(text(stmt))
                conn.commit()
                results.append({"ok": True})
            except Exception as e:
                results.append({"ok": False, "error": str(e)[:200]})
    return {"status": "done", "results": results, "dialect": dialect}


def _compute_today_metrics(db: Session) -> dict:
    total_sold = db.query(func.count(SoldCard.id)).scalar() or 0
    total_active = db.query(func.count(Auction.id)).filter(Auction.status == "active").scalar() or 0

    # median of current active auction prices
    active_prices = [p[0] for p in db.query(Auction.current_price).filter(
        Auction.status == "active", Auction.current_price > 0
    ).all() if p[0] is not None]
    active_prices.sort()
    median_card = 0.0
    if active_prices:
        n = len(active_prices)
        median_card = active_prices[n // 2] if n % 2 else (active_prices[n // 2 - 1] + active_prices[n // 2]) / 2

    total_market = sum(active_prices)

    # Top driver by total market value
    driver_vals: dict = {}
    rows = db.query(Card.driver_name, Auction.current_price).join(Auction, Auction.card_id == Card.id).filter(
        Auction.status == "active",
        Auction.current_price > 0,
    ).all()
    for driver, price in rows:
        if not driver:
            continue
        driver_vals[driver] = driver_vals.get(driver, 0) + (price or 0)
    top_driver = max(driver_vals.items(), key=lambda x: x[1])[0] if driver_vals else None

    return {
        "total_sold_cards": int(total_sold),
        "total_active_auctions": int(total_active),
        "median_card_value": round(median_card, 2),
        "total_market_value": round(total_market, 2),
        "top_driver_by_value": top_driver,
        "snapshot_json": json.dumps({
            "distinct_sellers": db.query(func.count(func.distinct(Auction.seller))).filter(
                Auction.status == "active"
            ).scalar() or 0,
            "top_driver_value": round(max(driver_vals.values()) if driver_vals else 0, 2),
        }),
    }


@router.post("/api/admin/take-snapshot")
def take_snapshot(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Compute today's metrics and upsert a row into daily_snapshots."""
    today = date.today().isoformat()
    metrics = _compute_today_metrics(db)

    with engine.connect() as conn:
        dialect = conn.dialect.name
        # Upsert
        if dialect == "postgresql":
            stmt = text("""
                INSERT INTO daily_snapshots
                (snapshot_date, total_sold_cards, total_active_auctions, median_card_value,
                 total_market_value, top_driver_by_value, snapshot_json)
                VALUES (:d, :s, :a, :m, :t, :td, :j)
                ON CONFLICT (snapshot_date) DO UPDATE SET
                    total_sold_cards = EXCLUDED.total_sold_cards,
                    total_active_auctions = EXCLUDED.total_active_auctions,
                    median_card_value = EXCLUDED.median_card_value,
                    total_market_value = EXCLUDED.total_market_value,
                    top_driver_by_value = EXCLUDED.top_driver_by_value,
                    snapshot_json = EXCLUDED.snapshot_json
            """)
        else:  # SQLite
            stmt = text("""
                INSERT OR REPLACE INTO daily_snapshots
                (snapshot_date, total_sold_cards, total_active_auctions, median_card_value,
                 total_market_value, top_driver_by_value, snapshot_json)
                VALUES (:d, :s, :a, :m, :t, :td, :j)
            """)
        conn.execute(stmt, {
            "d": today,
            "s": metrics["total_sold_cards"],
            "a": metrics["total_active_auctions"],
            "m": metrics["median_card_value"],
            "t": metrics["total_market_value"],
            "td": metrics["top_driver_by_value"],
            "j": metrics["snapshot_json"],
        })
        conn.commit()

    return {"status": "ok", "date": today, **metrics}


def maybe_take_snapshot(db: Session) -> bool:
    """Take today's snapshot if one doesn't already exist. Returns True if created."""
    today = date.today().isoformat()
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT 1 FROM daily_snapshots WHERE snapshot_date = :d"), {"d": today}
            ).fetchone()
            if row:
                return False
    except Exception:
        # Table doesn't exist yet — attempt migration + create
        migrate_snapshots()
    take_snapshot(db)
    return True


@router.get("/api/snapshots")
def list_snapshots(days: int = Query(90, ge=1, le=730)):
    """Return snapshot rows for charting."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT snapshot_date, total_sold_cards, total_active_auctions, "
                "median_card_value, total_market_value, top_driver_by_value "
                "FROM daily_snapshots WHERE snapshot_date >= :c ORDER BY snapshot_date ASC"
            ), {"c": cutoff}).fetchall()
    except Exception as e:
        return {"snapshots": [], "error": str(e)[:200]}
    return {
        "snapshots": [
            {
                "date": r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]),
                "total_sold_cards": r[1],
                "total_active_auctions": r[2],
                "median_card_value": r[3],
                "total_market_value": r[4],
                "top_driver_by_value": r[5],
            }
            for r in rows
        ]
    }
