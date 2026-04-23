import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query as QueryParam, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
import asyncio
import json
import httpx
from datetime import datetime, timedelta

from database import create_tables, get_db, Auction, Card, engine
from routers import cards, auctions, portfolio, alerts, analytics, wishlist, sales, psa_data, push, graded
from routers import race_calendar, shared_watchlists, watch_rules, checklist, sealed
from routers import ai_grader, discord as discord_router
from routers import verdict_accuracy, sellers as sellers_router, snapshots, ai_advisor
from routers import today as today_router
from routers import digest as digest_router
from routers import predictions as predictions_router
from routers import sniper as sniper_router
from routers import comps
from routers import cleanup as cleanup_router
from routers import click_events
from scheduler import start_scheduler
from ebay_api import has_real_credentials

app = FastAPI(title="F1 Chrome Crest", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cards.router)
app.include_router(auctions.router)
app.include_router(portfolio.router)
app.include_router(alerts.router)
app.include_router(analytics.router)
app.include_router(wishlist.router)
app.include_router(sales.router)
app.include_router(psa_data.router)
app.include_router(push.router)
app.include_router(graded.router)
app.include_router(race_calendar.router)
app.include_router(shared_watchlists.router)
app.include_router(watch_rules.router)
app.include_router(checklist.router)
app.include_router(sealed.router)
app.include_router(ai_grader.router)
app.include_router(discord_router.router)
app.include_router(verdict_accuracy.router)
app.include_router(sellers_router.router)
app.include_router(snapshots.router)
app.include_router(ai_advisor.router)
app.include_router(today_router.router)
app.include_router(digest_router.router)
app.include_router(predictions_router.router)
app.include_router(sniper_router.router)
app.include_router(comps.router)
app.include_router(cleanup_router.router)
app.include_router(click_events.router)


@app.post("/api/admin/migrate-shared-watchlists")
def migrate_shared_watchlists():
    """Create shared_watchlists table (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS shared_watchlists (
            id SERIAL PRIMARY KEY,
            token VARCHAR NOT NULL UNIQUE,
            name VARCHAR,
            items_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            view_count INTEGER DEFAULT 0
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_shared_watchlists_token ON shared_watchlists (token)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"ok": True})
                except Exception as e:
                    results.append({"ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.post("/api/admin/migrate-watch-rules")
def migrate_watch_rules():
    """Create watch_rules table (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS watch_rules (
            id SERIAL PRIMARY KEY,
            name VARCHAR,
            driver_filter VARCHAR,
            parallel_filter VARCHAR,
            grade_filter VARCHAR,
            max_price FLOAT NOT NULL,
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"ok": True})
                except Exception as e:
                    results.append({"ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.post("/api/admin/migrate-bid-intents")
def migrate_bid_intents():
    """Create bid_intents table (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS bid_intents (
            id SERIAL PRIMARY KEY,
            auction_id INTEGER NOT NULL,
            ebay_item_id VARCHAR,
            max_bid FLOAT NOT NULL,
            executed BOOLEAN DEFAULT FALSE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_bid_intents_auction_id ON bid_intents (auction_id)",
        "CREATE INDEX IF NOT EXISTS ix_bid_intents_ebay_item_id ON bid_intents (ebay_item_id)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"ok": True})
                except Exception as e:
                    results.append({"ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.post("/api/admin/migrate-scraper-runs")
def migrate_scraper_runs():
    """Create scraper_runs table (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS scraper_runs (
            id SERIAL PRIMARY KEY,
            source VARCHAR NOT NULL,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            queries_attempted INTEGER DEFAULT 0,
            queries_succeeded INTEGER DEFAULT 0,
            rows_seen INTEGER DEFAULT 0,
            rows_inserted INTEGER DEFAULT 0,
            rows_updated INTEGER DEFAULT 0,
            rows_skipped_dup INTEGER DEFAULT 0,
            blocked BOOLEAN DEFAULT FALSE,
            error_message TEXT,
            run_id VARCHAR
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_scraper_runs_source ON scraper_runs (source)",
        "CREATE INDEX IF NOT EXISTS ix_scraper_runs_started_at ON scraper_runs (started_at)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"ok": True})
                except Exception as e:
                    results.append({"ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.get("/api/admin/scraper-health")
def scraper_health(db: Session = Depends(get_db)):
    """Last 14d of scraper_runs per source — success rate, latency, last success."""
    from database import ScraperRun
    from sqlalchemy import desc as _desc
    cutoff = datetime.utcnow() - timedelta(days=14)

    rows = db.query(ScraperRun).filter(ScraperRun.started_at >= cutoff)\
        .order_by(_desc(ScraperRun.started_at)).all()

    by_source: dict = {}
    for r in rows:
        src = r.source or "Unknown"
        bucket = by_source.setdefault(src, {
            "source": src,
            "runs": 0,
            "succeeded": 0,
            "blocked": 0,
            "total_new_rows": 0,
            "total_rows_seen": 0,
            "last_started": None,
            "last_success_at": None,
            "last_error": None,
        })
        bucket["runs"] += 1
        bucket["total_new_rows"] += int(r.rows_inserted or 0)
        bucket["total_rows_seen"] += int(r.rows_seen or 0)
        if r.blocked:
            bucket["blocked"] += 1
        if r.error_message and not bucket["last_error"]:
            bucket["last_error"] = (r.error_message or "")[:160]
        if not bucket["last_started"] and r.started_at:
            bucket["last_started"] = r.started_at.isoformat()
        # "succeeded" = finished without error, inserted >=1 row OR rows_seen>=1
        if not r.error_message and not r.blocked:
            bucket["succeeded"] += 1
            if not bucket["last_success_at"] and r.started_at:
                bucket["last_success_at"] = r.started_at.isoformat()

    out = []
    for src, b in by_source.items():
        runs = b["runs"] or 1
        b["success_rate"] = round(b["succeeded"] / runs * 100, 1)
        b["avg_new_rows"] = round(b["total_new_rows"] / runs, 1)
        # Simple status flag used by the dashboard strip
        if b["last_success_at"]:
            hrs = (datetime.utcnow() - datetime.fromisoformat(b["last_success_at"])).total_seconds() / 3600
            if hrs < 6:
                b["status"] = "ok"
            elif hrs < 24:
                b["status"] = "warn"
            else:
                b["status"] = "stale"
        elif b["blocked"]:
            b["status"] = "blocked"
        else:
            b["status"] = "stale"
        out.append(b)
    out.sort(key=lambda x: x["source"])
    return {"sources": out, "total_runs": len(rows), "window_days": 14}


@app.get("/api/time")
def server_time():
    """
    Authoritative server UTC clock for timer sync.

    Frontend fetches this once on first card mount, computes
    `offset = server_ms - Date.now()` and applies it to countdown
    math so timers match eBay/server reality instead of drifting
    with a skewed local clock.
    """
    now = datetime.utcnow()
    return {
        "server_time": now.isoformat() + "Z",
        "server_ms": int(now.timestamp() * 1000),
    }


@app.post("/api/auctions/{auction_id}/bid-intent")
def save_bid_intent(auction_id: int, body: dict, db: Session = Depends(get_db)):
    """Record a planned max bid even if we can't auto-execute."""
    from database import BidIntent
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        from fastapi import HTTPException
        raise HTTPException(404, "Auction not found")
    max_bid = float(body.get("max_bid", 0))
    if max_bid <= 0:
        from fastapi import HTTPException
        raise HTTPException(400, "max_bid must be > 0")
    intent = BidIntent(
        auction_id=auction_id,
        ebay_item_id=a.ebay_listing_id,
        max_bid=max_bid,
        notes=body.get("notes") or "",
        executed=False,
    )
    db.add(intent)
    db.commit()
    # Build intent eBay URL
    item_id = a.ebay_listing_id.split("|")[1] if a.ebay_listing_id and "|" in a.ebay_listing_id else (a.ebay_listing_id or "")
    bid_url = f"https://www.ebay.com/itm/{item_id}?intent=BID" if item_id else (a.ebay_url or "")
    return {
        "status": "saved",
        "intent_id": intent.id,
        "auction_id": auction_id,
        "max_bid": max_bid,
        "ebay_bid_url": bid_url,
        "ebay_url": a.ebay_url,
    }


@app.get("/api/auctions/{auction_id}/bid-intents")
def list_bid_intents(auction_id: int, db: Session = Depends(get_db)):
    """Return saved bid intents for this auction."""
    from database import BidIntent
    rows = db.query(BidIntent).filter(BidIntent.auction_id == auction_id)\
        .order_by(BidIntent.created_at.desc()).all()
    return {
        "auction_id": auction_id,
        "intents": [
            {
                "id": r.id,
                "max_bid": r.max_bid,
                "executed": r.executed,
                "notes": r.notes,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@app.get("/api/watchlist/changes")
def watchlist_changes(since: str = QueryParam(...), db: Session = Depends(get_db)):
    """
    Return watchlist items whose current price differs from the last snapshot
    before `since` (ISO). Used by dashboard "what's changed" strip.
    """
    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "").replace("+00:00", ""))
    except Exception:
        return {"items": [], "error": "bad_since"}

    items = db.query(Auction).filter(Auction.status == "watchlist").all()
    # Without price snapshots we approximate "changed" via last_updated > since.
    moved = []
    for a in items:
        lu = a.last_updated or a.created_at
        if not lu or lu < since_dt:
            continue
        moved.append({
            "id": a.id,
            "title": (a.title or "")[:140],
            "current_price": a.current_price,
            "driver": a.card.driver_name if a.card else None,
            "parallel": a.card.parallel if a.card else None,
            "last_updated": lu.isoformat() if lu else None,
        })
    return {"items": moved, "total_watchlist": len(items)}


@app.post("/api/admin/migrate-sold-source")
def migrate_sold_source():
    """Add source column to sold_cards + backfill existing rows to 'eBay'."""
    from sqlalchemy import text
    statements = [
        "ALTER TABLE sold_cards ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'eBay'",
        "UPDATE sold_cards SET source = 'eBay' WHERE source IS NULL",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_source ON sold_cards (source)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"stmt": stmt[:70], "ok": True})
                except Exception as e:
                    results.append({"stmt": stmt[:70], "ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.post("/api/admin/migrate-dedup-flag")
def migrate_dedup_flag():
    """Add is_duplicate column to sold_cards (idempotent) + index."""
    from sqlalchemy import text
    statements = [
        "ALTER TABLE sold_cards ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT FALSE",
        "UPDATE sold_cards SET is_duplicate = FALSE WHERE is_duplicate IS NULL",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_is_duplicate ON sold_cards (is_duplicate)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"stmt": stmt[:80], "ok": True})
                except Exception as e:
                    results.append({"stmt": stmt[:80], "ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.post("/api/admin/backfill-dedup")
def backfill_dedup():
    """Sweep sold_cards, compute fuzzy fingerprints, mark soft duplicates."""
    try:
        from dedup import backfill_duplicates
        return {"status": "done", **backfill_duplicates()}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[-500:]}


@app.post("/api/admin/migrate-push-subscriptions")
def migrate_push_subscriptions():
    """Create push_subscriptions table on Neon Postgres (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            endpoint VARCHAR NOT NULL UNIQUE,
            p256dh VARCHAR NOT NULL,
            auth VARCHAR NOT NULL,
            user_agent VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_endpoint ON push_subscriptions (endpoint)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass
    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"ok": True})
                except Exception as e:
                    results.append({"ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.get("/api/psa/timeseries")
def psa_timeseries(driver: str, days: int = 90, db: Session = Depends(get_db)):
    """Graded sales grouped by week for the given driver. Returns MEDIAN per grade per week.
    Excludes SportsCardsPro synthetic rows and non-2025 bleed-through. Drops weeks with <2
    samples in a grade bucket to kill single-sale noise spikes."""
    from database import SoldCard
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.query(SoldCard).filter(
        SoldCard.driver_name == driver,
        SoldCard.sale_date >= since,
        SoldCard.sale_price > 0,
        (SoldCard.source != "SportsCardsPro") | (SoldCard.source.is_(None)),
        SoldCard.title.ilike("%2025%"),
    ).all()

    # Group by (week_start, grade) -> list of prices; median later
    buckets: dict = {}
    for r in rows:
        if not r.sale_date:
            continue
        g = (r.grade or "").strip().upper()
        if g.startswith("PSA 10"):
            grade = "PSA 10"
        elif g.startswith("PSA 9"):
            grade = "PSA 9"
        elif g.startswith("PSA 8"):
            grade = "PSA 8"
        elif g.startswith("BGS") or g.startswith("SGC"):
            grade = g.split()[0] if g else "Other"
        else:
            grade = "Raw"
        week_start = (r.sale_date - timedelta(days=r.sale_date.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        key = (week_start.isoformat(), grade)
        buckets.setdefault(key, []).append(float(r.sale_price or 0))

    def _median(vals):
        v = sorted(vals)
        n = len(v)
        return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2

    out = []
    for (week, grade), vals in buckets.items():
        if len(vals) < 2:
            continue  # single-sale weeks create phantom spikes
        out.append({
            "week_start": week,
            "grade": grade,
            "count": len(vals),
            "avg_price": round(_median(vals), 2),
        })
    out.sort(key=lambda x: (x["week_start"], x["grade"]))
    return {"driver": driver, "days": days, "total_points": len(rows), "series": out}


@app.post("/api/admin/migrate-sold-cards")
def migrate_sold_cards():
    """Create the sold_cards table and its index on Neon Postgres (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS sold_cards (
            id SERIAL PRIMARY KEY,
            ebay_item_id VARCHAR NOT NULL UNIQUE,
            title VARCHAR NOT NULL,
            driver_name VARCHAR,
            parallel VARCHAR,
            grade VARCHAR,
            condition VARCHAR,
            sale_price FLOAT NOT NULL,
            sale_date TIMESTAMP NOT NULL,
            image_url VARCHAR,
            ebay_url VARCHAR,
            shipping_cost FLOAT,
            is_auction BOOLEAN DEFAULT FALSE,
            series VARCHAR DEFAULT 'F1',
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_ebay_item_id ON sold_cards (ebay_item_id)",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_driver_name ON sold_cards (driver_name)",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_parallel ON sold_cards (parallel)",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_sale_date ON sold_cards (sale_date)",
        "CREATE INDEX IF NOT EXISTS ix_sold_cards_driver_parallel_date ON sold_cards (driver_name, parallel, sale_date)",
    ]
    # Also run SQLAlchemy create_all for local SQLite dev
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass

    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"stmt": stmt[:60], "ok": True})
                except Exception as e:
                    results.append({"stmt": stmt[:60], "ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.post("/api/admin/migrate-psa-tables")
def migrate_psa_tables():
    """Create psa_pop and psa_sales tables on Neon Postgres (idempotent)."""
    from sqlalchemy import text
    statements = [
        """
        CREATE TABLE IF NOT EXISTS psa_pop (
            id SERIAL PRIMARY KEY,
            set_year INTEGER,
            set_name VARCHAR,
            card_num VARCHAR,
            driver_name VARCHAR,
            parallel VARCHAR,
            grade VARCHAR,
            pop_count INTEGER DEFAULT 0,
            pop_higher INTEGER DEFAULT 0,
            source_url VARCHAR,
            last_scraped TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_psa_pop_driver_name ON psa_pop (driver_name)",
        "CREATE INDEX IF NOT EXISTS ix_psa_pop_parallel ON psa_pop (parallel)",
        "CREATE INDEX IF NOT EXISTS ix_psa_pop_grade ON psa_pop (grade)",
        "CREATE INDEX IF NOT EXISTS ix_psa_pop_driver_parallel_grade ON psa_pop (driver_name, parallel, grade)",
        """
        CREATE TABLE IF NOT EXISTS psa_sales (
            id SERIAL PRIMARY KEY,
            driver_name VARCHAR,
            parallel VARCHAR,
            grade VARCHAR,
            price FLOAT,
            sale_date TIMESTAMP,
            source VARCHAR,
            auction_house VARCHAR,
            image_url VARCHAR,
            listing_url VARCHAR UNIQUE,
            title VARCHAR,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_psa_sales_driver_name ON psa_sales (driver_name)",
        "CREATE INDEX IF NOT EXISTS ix_psa_sales_grade ON psa_sales (grade)",
        "CREATE INDEX IF NOT EXISTS ix_psa_sales_sale_date ON psa_sales (sale_date)",
        "CREATE INDEX IF NOT EXISTS ix_psa_sales_driver_grade_date ON psa_sales (driver_name, grade, sale_date)",
    ]
    try:
        from database import Base, engine as _engine
        Base.metadata.create_all(bind=_engine)
    except Exception:
        pass

    results = []
    try:
        from database import engine as _engine
        with _engine.connect() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    results.append({"stmt": stmt[:60].strip(), "ok": True})
                except Exception as e:
                    results.append({"stmt": stmt[:60].strip(), "ok": False, "error": str(e)[:200]})
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    return {"status": "done", "results": results}


@app.get("/api/admin/debug-finding-api")
async def debug_finding_api():
    """Diagnose why the Finding API returns 0 items."""
    from ebay_finding_api import _find_completed_items, _app_id
    import os as _os
    app_id = _app_id()
    result = {
        "app_id_present": bool(app_id),
        "app_id_len": len(app_id) if app_id else 0,
        "ebay_app_id_env": bool(_os.getenv("EBAY_APP_ID")),
    }
    try:
        items = await _find_completed_items("2025 Topps Chrome F1 Verstappen", page=1)
        result["items_returned"] = len(items)
        result["sample"] = items[:2] if items else []
    except Exception as e:
        result["error"] = str(e)[:300]

    # Raw call to see eBay's actual response
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://svcs.ebay.com/services/search/FindingService/v1",
                params={
                    "OPERATION-NAME": "findCompletedItems",
                    "SERVICE-VERSION": "1.0.0",
                    "SECURITY-APPNAME": app_id,
                    "RESPONSE-DATA-FORMAT": "JSON",
                    "REST-PAYLOAD": "",
                    "keywords": "2025 Topps Chrome F1 Verstappen",
                    "paginationInput.entriesPerPage": "5",
                    "itemFilter(0).name": "SoldItemsOnly",
                    "itemFilter(0).value": "true",
                },
            )
            result["http_status"] = resp.status_code
            result["body_preview"] = resp.text[:800]
    except Exception as e:
        result["raw_error"] = str(e)[:300]
    return result


@app.post("/api/admin/ingest-sold")
async def admin_ingest_sold():
    """Pull sold listings from eBay Finding API and upsert non-base 2025 Chrome F1."""
    from sold_ingest import ingest_all_drivers
    try:
        result = await ingest_all_drivers()
        return {"status": "ok", **result}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[:800]}


@app.post("/api/admin/scrape-card-images")
async def trigger_card_image_scrape():
    """Manually trigger a card image scrape from eBay public search."""
    asyncio.create_task(_scrape_card_images())
    return {"status": "scraping started — check logs"}


@app.post("/api/admin/scrape-130point")
async def admin_scrape_130point():
    """Scrape 130point.com sold comps and upsert into SoldCard."""
    from scrape_130point import ingest_130point
    try:
        result = await ingest_130point()
        return {"status": "ok", **result}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[:800]}


@app.post("/api/admin/scrape-ebay-html")
async def admin_scrape_ebay_html(mode: str = QueryParam("sold")):
    """Scrape eBay search HTML (mode=sold|auction) — no Browse API quota used."""
    try:
        if mode == "auction":
            from scrape_ebay_html import ingest_ebay_html_auction
            result = await ingest_ebay_html_auction()
        else:
            from scrape_ebay_html import ingest_ebay_html_sold
            result = await ingest_ebay_html_sold()
        return {"status": "ok", **result}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[:800]}


@app.post("/api/admin/ingest-finding-api-all")
async def admin_ingest_finding_api_all():
    """Aggressive Finding API ingest: driver × parallel matrix, sold + active."""
    from sold_ingest import ingest_finding_api_all
    try:
        result = await ingest_finding_api_all()
        return {"status": "ok", **result}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[:800]}


@app.get("/api/drivers/photo")
async def driver_photo(name: str = QueryParam(...), redirect: bool = True):
    """Return Wikipedia headshot for a driver. By default 302-redirects to the
    actual image so <img src=...> works directly. Pass ?redirect=false to get
    the JSON body instead."""
    from driver_photos import get_photo
    from fastapi.responses import RedirectResponse, Response
    url = await get_photo(name)
    if not url:
        # 1x1 transparent pixel so <img onError> still fires sensibly
        return Response(status_code=404)
    if redirect:
        return RedirectResponse(url=url, status_code=302)
    return {"driver": name, "photo_url": url}


@app.post("/api/drivers/refresh-photos")
async def refresh_driver_photos():
    """Re-fetch all driver photos from Wikipedia in parallel and persist to DB."""
    from database import SessionLocal, Card
    from driver_photos import DRIVER_WIKIPEDIA, fetch_driver_photo
    names = list(DRIVER_WIKIPEDIA.keys())
    results = await asyncio.gather(*[fetch_driver_photo(n) for n in names], return_exceptions=True)
    db = SessionLocal()
    updated = 0
    try:
        for name, url in zip(names, results):
            if isinstance(url, str) and url:
                cards = db.query(Card).filter(Card.driver_name == name).all()
                for c in cards:
                    c.image_url = url
                updated += len(cards)
        db.commit()
    finally:
        db.close()
    return {"status": "done", "updated": updated}


_ALLOWED_HOSTS = {
    "i.ebayimg.com", "ir.ebaystatic.com", "thumbs.ebaystatic.com",
    "upload.wikimedia.org", "commons.wikimedia.org",
}


@app.get("/api/proxy/image")
async def proxy_image(url: str = QueryParam(...)):
    """Proxy eBay CDN images server-side to avoid hotlink/CORS blocks."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).netloc.lstrip("www.")
        if host not in _ALLOWED_HOSTS:
            return Response(status_code=403)
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            r = await client.get(url, headers={"Referer": "https://www.ebay.com/"})
            if r.status_code != 200:
                return Response(status_code=r.status_code)
            content_type = r.headers.get("content-type", "image/jpeg")
            return Response(
                content=r.content,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception:
        return Response(status_code=502)


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect(d)


manager = ConnectionManager()

# Wire scheduler broadcast to our WS manager
from scheduler import set_broadcast
set_broadcast(manager.broadcast)


@app.get("/api/cards/{card_id}/psa-pop")
async def psa_pop_report(card_id: int, db: Session = Depends(get_db)):
    from database import PriceHistory
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(404, "Card not found")

    driver_name = card.driver_name or ""
    # eBay sold search for PSA-graded versions of this card
    ebay_psa_url = (
        f"https://www.ebay.com/sch/i.html?_nkw=2025+Topps+Chrome+Formula+1+"
        f"{driver_name.replace(' ', '+')}+PSA&LH_Complete=1&LH_Sold=1"
    )
    psa_pop_url = "https://www.psacard.com/pop/"

    # Pull eBay sold records that include PSA grading info from our scraper
    # condition field contains grade info scraped from eBay titles ("PSA 10", "PSA 9", etc.)
    from sqlalchemy import or_
    graded_sales = db.query(PriceHistory).filter(
        PriceHistory.card_id == card_id,
        or_(
            PriceHistory.source == "PSA Auction",
            PriceHistory.condition.ilike("PSA%"),
            PriceHistory.condition.ilike("BGS%"),
            PriceHistory.condition.ilike("SGC%"),
        )
    ).order_by(PriceHistory.sale_date.desc()).limit(50).all()

    # Also pull all raw sales for price context
    all_sales = db.query(PriceHistory).filter(
        PriceHistory.card_id == card_id,
    ).order_by(PriceHistory.sale_date.desc()).limit(100).all()

    sales_by_grade: dict = {}
    for s in graded_sales:
        grade = s.condition or "Unknown"
        if grade not in sales_by_grade:
            sales_by_grade[grade] = []
        sales_by_grade[grade].append({"price": s.price, "date": s.sale_date.isoformat()})

    raw_prices = [s.price for s in all_sales if not (s.condition or "").startswith(("PSA", "BGS", "SGC"))]
    avg_raw = sum(raw_prices) / len(raw_prices) if raw_prices else None

    return {
        "card_id": card_id,
        "driver": driver_name,
        "parallel": card.parallel,
        "grade": card.grade,
        "ebay_psa_url": ebay_psa_url,
        "psa_pop_url": psa_pop_url,
        "psa_sales": sales_by_grade,
        "total_graded_sales": len(graded_sales),
        "total_raw_sales": len(raw_prices),
        "avg_raw_price": round(avg_raw, 2) if avg_raw else None,
        "psa_not_indexed": True,  # PSA hasn't catalogued this 2025 set yet
    }


@app.post("/api/auctions/{auction_id}/watch")
def toggle_watch(auction_id: int, db: Session = Depends(get_db)):
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        from fastapi import HTTPException
        raise HTTPException(404, "Auction not found")
    a.status = "active" if a.status == "watchlist" else "watchlist"
    db.commit()
    return {"watching": a.status == "watchlist", "id": auction_id}


@app.get("/api/auctions/watchlist")
def get_watchlist(db: Session = Depends(get_db)):
    items = db.query(Auction).filter(Auction.status == "watchlist").all()
    import json
    return {"items": [{"id": a.id, "title": a.title, "current_price": a.current_price,
                       "ebay_url": a.ebay_url, "image_url": a.image_url,
                       "end_time": a.end_time.isoformat() if a.end_time else None,
                       "buying_options": json.loads(a.buying_options) if a.buying_options else []} for a in items]}


@app.post("/api/auctions/{auction_id}/execute-snipe")
async def execute_snipe(auction_id: int, body: dict, db: Session = Depends(get_db)):
    """Execute a snipe bid on eBay. Requires max_bid in body."""
    a = db.query(Auction).filter(Auction.id == auction_id).first()
    if not a:
        from fastapi import HTTPException
        raise HTTPException(404, "Auction not found")

    max_bid = float(body.get("max_bid", 0))
    if max_bid <= 0:
        from fastapi import HTTPException
        raise HTTPException(400, "max_bid must be > 0")

    # Check for eBay user OAuth token (Trading API)
    user_token = os.getenv("EBAY_USER_TOKEN", "")
    if not user_token:
        return {
            "status": "no_credentials",
            "message": "EBAY_USER_TOKEN not set. Add your eBay OAuth user token to place real bids.",
            "auction_id": auction_id,
            "ebay_url": a.ebay_url,
            "max_bid": max_bid,
        }

    # Call eBay Trading API PlaceBid
    import httpx
    item_id = a.ebay_listing_id.split("|")[1] if "|" in a.ebay_listing_id else a.ebay_listing_id
    xml_body = f"""<?xml version="1.0" encoding="utf-8"?>
<PlaceOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>{user_token}</eBayAuthToken></RequesterCredentials>
  <ItemID>{item_id}</ItemID>
  <Offer>
    <Action>Bid</Action>
    <MaxBid currencyID="USD">{max_bid:.2f}</MaxBid>
    <Quantity>1</Quantity>
  </Offer>
</PlaceOfferRequest>"""
    headers = {
        "X-EBAY-API-CALL-NAME": "PlaceOffer",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-APP-NAME": os.getenv("EBAY_APP_ID", ""),
        "X-EBAY-API-DEV-NAME": os.getenv("EBAY_DEV_ID", ""),
        "X-EBAY-API-CERT-NAME": os.getenv("EBAY_CERT_ID", ""),
        "Content-Type": "text/xml",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post("https://api.ebay.com/ws/api.dll", content=xml_body, headers=headers, timeout=15)

    success = "Success" in resp.text or "BidPlaced" in resp.text
    return {
        "status": "bid_placed" if success else "bid_failed",
        "auction_id": auction_id,
        "item_id": item_id,
        "max_bid": max_bid,
        "ebay_response_snippet": resp.text[:300],
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            from database import SessionLocal
            db = SessionLocal()
            try:
                active = db.query(Auction).filter(Auction.status == "active").order_by(
                    Auction.snipe_score.desc()
                ).limit(30).all()
                now = datetime.utcnow()
                auctions_data = []
                for a in active:
                    time_left = max(0, (a.end_time - now).total_seconds())
                    auctions_data.append({
                        "id": a.id,
                        "title": a.title[:70],
                        "current_price": a.current_price,
                        "time_left": int(time_left),
                        "bid_count": a.bid_count,
                        "snipe_eligible": a.snipe_eligible,
                        "snipe_score": a.snipe_score,
                        "is_real_ebay": a.is_real_ebay,
                        "ebay_url": a.ebay_url or "",
                    })

                # Recent snipe alerts — only from the last 2 minutes so the
                # Layout banner doesn't keep re-showing old alerts every 5s.
                from database import Alert
                from datetime import timedelta
                cutoff = now - timedelta(minutes=2)
                recent_alerts = db.query(Alert).filter(
                    Alert.alert_type == "snipe_opportunity",
                    Alert.triggered == True,
                    Alert.created_at >= cutoff,
                ).order_by(Alert.created_at.desc()).limit(5).all()

                await websocket.send_json({
                    "type": "auction_update",
                    "data": auctions_data,
                    "alerts": [{"message": a.message, "urgency": a.urgency} for a in recent_alerts],
                    "ebay_connected": has_real_credentials(),
                    "timestamp": now.isoformat(),
                })
            finally:
                db.close()
            await asyncio.sleep(8)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


@app.get("/api/dashboard")
def dashboard_bundle(db: Session = Depends(get_db)):
    """Return everything the dashboard needs in one DB connection."""
    from routers.auctions import auction_to_dict
    from sqlalchemy import func
    from database import Alert as AlertModel

    # Top 100 active auctions sorted by snipe score
    auctions = db.query(Auction).filter(Auction.status == "active")\
        .order_by(Auction.snipe_score.desc()).limit(100).all()

    # Analytics summary
    total_cards = db.query(func.count(Card.id)).scalar() or 0
    active_count = db.query(func.count(Auction.id)).filter(Auction.status == "active").scalar() or 0
    snipe_count = db.query(func.count(Auction.id)).filter(
        Auction.status == "active", Auction.snipe_eligible == True
    ).scalar() or 0
    avg_price = db.query(func.avg(Auction.current_price)).filter(Auction.status == "active").scalar()

    # Recent alerts
    alerts = db.query(AlertModel).filter(AlertModel.triggered == True)\
        .order_by(AlertModel.created_at.desc()).limit(5).all()

    return {
        "auctions": [auction_to_dict(a) for a in auctions],
        "stats": {
            "total_cards": total_cards,
            "active_auctions": active_count,
            "snipe_targets": snipe_count,
            "avg_price": float(avg_price) if avg_price else 0,
        },
        "alerts": [{"id": a.id, "message": a.message, "urgency": a.urgency, "created_at": a.created_at.isoformat()} for a in alerts],
        "ebay_connected": has_real_credentials(),
    }


@app.get("/api/cron/sync")
async def cron_sync(db: Session = Depends(get_db)):
    """Called by Vercel cron — seeds DB, syncs live listings, batches price history."""
    from seed_data import seed_all
    try:
        seed_all(db)
    except Exception as e:
        return {"ok": False, "stage": "seed", "error": str(e)[:200]}
    if not has_real_credentials():
        return {"ok": False, "reason": "no_credentials"}
    from scraper import sync_real_ebay_listings
    from price_history_sync import sync_price_history_batch
    added = 0
    ph = None
    ebay_error = None
    ph_error = None
    try:
        added = await sync_real_ebay_listings(db)
    except Exception as e:
        ebay_error = str(e)[:200]
    try:
        ph = await sync_price_history_batch(db)
    except Exception as e:
        ph_error = str(e)[:200]

    # Non-blocking sold-card ingest — runs in background, never blocks the cron.
    sold_error = None
    try:
        from sold_ingest import ingest_all_drivers, ingest_finding_api_all
        asyncio.create_task(ingest_all_drivers())
        # Aggressive driver x parallel matrix (sold + active via Finding API)
        asyncio.create_task(ingest_finding_api_all())
    except Exception as e:
        sold_error = str(e)[:200]

    # Free scrapers — bypass eBay Browse API entirely.
    # Awaited (not fire-and-forget) so they actually run to completion each
    # cron tick on Vercel serverless — tasks spawned with create_task get
    # killed when the response returns.
    scraper_errors = []
    try:
        from scrape_130point import ingest_130point
        await ingest_130point()
    except Exception as e:
        scraper_errors.append(f"130point: {str(e)[:120]}")
    try:
        from scrape_ebay_html import ingest_ebay_html_sold, ingest_ebay_html_auction
        await ingest_ebay_html_sold()
        await ingest_ebay_html_auction()
    except Exception as e:
        scraper_errors.append(f"ebay_html: {str(e)[:120]}")

    # Smart watch rules — auto-move matching auctions to watchlist
    rules_auto_watched = 0
    try:
        from routers.watch_rules import apply_rules_to_auctions
        rules_auto_watched = apply_rules_to_auctions(db)
    except Exception as _re:
        import logging as _log
        _log.getLogger("rules").warning(f"rules apply failed: {_re}")

    # Sweep expired auctions — flip status to 'ended' for listings past end_time.
    # Runs inline here so every /api/cron/sync + /api/ebay/refresh cron call
    # cleans up stale rows without adding a third cron job.
    expired_swept = 0
    try:
        now = datetime.utcnow()
        expired_swept = (
            db.query(Auction)
            .filter(Auction.status == "active", Auction.end_time != None, Auction.end_time <= now)
            .update({"status": "ended"}, synchronize_session=False)
        )
        db.commit()
    except Exception as _se:
        import logging as _log
        _log.getLogger("sweep").warning(f"expire sweep failed: {_se}")

    # Feature 1: enhanced snipe alert generation — never blocks sync
    snipe_alerts_created = 0
    snipe_alert_error = None
    push_sent = 0
    strong_buy_created = 0
    wishlist_match_created = 0
    auto_watchlisted = 0
    try:
        from scraper import run_enhanced_snipe_alerts, run_strong_buy_alerts
        created = run_enhanced_snipe_alerts(db)
        snipe_alerts_created = len(created)

        # Strong-buy + wishlist auto-add (Features 3 & 4)
        sb_result = run_strong_buy_alerts(db)
        sb_alerts = sb_result["strong_buy_alerts"]
        wm_alerts = sb_result["wishlist_alerts"]
        strong_buy_created = len(sb_alerts)
        wishlist_match_created = len(wm_alerts)
        auto_watchlisted = sb_result["auto_added_to_watchlist"]

        # Web Push fan-out
        try:
            from routers.push import send_push_to_all
            # Snipe alerts (existing behaviour: critical OR snipe_score>=90)
            for al in created:
                au = db.query(Auction).filter(Auction.id == al.auction_id).first() if al.auction_id else None
                is_critical = al.urgency == "critical"
                high_score = au and (au.snipe_score or 0) >= 90
                if is_critical or high_score:
                    url = (au.ebay_url if au else "/") or "/"
                    title = "SNIPE" + ("" if al.urgency == "normal" else f" · {al.urgency.upper()}")
                    push_sent += send_push_to_all(
                        db,
                        title=title,
                        body=(al.message or "")[:180],
                        url=url,
                        tag=f"snipe-{al.auction_id}",
                    )
            # Strong-buy alerts always push (high-value, low-frequency)
            for al in sb_alerts:
                au = db.query(Auction).filter(Auction.id == al.auction_id).first() if al.auction_id else None
                url = (au.ebay_url if au else "/") or "/"
                push_sent += send_push_to_all(
                    db,
                    title="STRONG BUY",
                    body=(al.message or "")[:180],
                    url=url,
                    tag=f"strongbuy-{al.auction_id}",
                )
            # Wishlist matches always push
            for al in wm_alerts:
                au = db.query(Auction).filter(Auction.id == al.auction_id).first() if al.auction_id else None
                url = (au.ebay_url if au else "/wishlist") or "/wishlist"
                push_sent += send_push_to_all(
                    db,
                    title="WISHLIST MATCH",
                    body=(al.message or "")[:180],
                    url=url,
                    tag=f"wish-{al.auction_id}-{al.card_id}",
                )
        except Exception as _pe:
            import logging as _log
            _log.getLogger("push").warning(f"push fanout failed: {_pe}")
    except Exception as e:
        snipe_alert_error = str(e)[:200]

    total = db.query(Auction).filter(Auction.status == "active").count()

    # Daily snapshot — runs once per day, skipped if today's already captured.
    snapshot_taken = False
    snapshot_error = None
    try:
        from routers.snapshots import maybe_take_snapshot
        snapshot_taken = maybe_take_snapshot(db)
    except Exception as _se:
        snapshot_error = str(_se)[:200]

    return {
        "ok": ebay_error is None,
        "added": added,
        "total_active": total,
        "price_history": ph,
        "snapshot_taken": snapshot_taken,
        "snapshot_error": snapshot_error,
        "ebay_error": ebay_error,
        "price_history_error": ph_error,
        "sold_ingest_started": sold_error is None,
        "sold_ingest_error": sold_error,
        "scraper_errors": scraper_errors,
        "snipe_alerts_created": snipe_alerts_created,
        "snipe_alert_error": snipe_alert_error,
        "push_sent": push_sent,
        "strong_buy_alerts_created": strong_buy_created,
        "wishlist_match_alerts_created": wishlist_match_created,
        "auto_watchlisted": auto_watchlisted,
        "rules_auto_watched": rules_auto_watched,
    }


@app.api_route("/api/ebay/refresh", methods=["GET", "POST"])
async def ebay_refresh(request: Request, db: Session = Depends(get_db)):
    """
    Admin-gated live-refresh via eBay Browse API.
    Runs on a 15-minute Vercel cron to keep bid counts + end times fresh.
    Auth: ?token=<ADMIN_TOKEN>, X-Admin-Token header, or Vercel cron (vercel-cron/1.0 UA).
    """
    import os as _os
    admin_token = _os.getenv("ADMIN_TOKEN", "")
    qtoken = request.query_params.get("token", "")
    header_token = request.headers.get("x-admin-token", "")
    ua = request.headers.get("user-agent", "").lower()
    is_cron = "vercel-cron" in ua
    if not is_cron:
        if not admin_token or (qtoken != admin_token and header_token != admin_token):
            return {"ok": False, "error": "unauthorized"}

    if not has_real_credentials():
        return {"ok": False, "error": "no_credentials"}

    from scraper import sync_real_ebay_listings
    from ebay_api import SEARCH_QUERIES
    try:
        added = await sync_real_ebay_listings(db)
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}

    # Priority pass: re-fetch each auction ending in <1h individually so the
    # ending-soon list has the freshest price/bid_count/end_time possible.
    # Capped at 50 to stay well under the daily Browse API budget.
    priority_refreshed = 0
    try:
        from ebay_api import get_item_details as _get_item_details
        soon_cutoff = datetime.utcnow() + timedelta(hours=1)
        ending_soon = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.ebay_listing_id.isnot(None),
            Auction.end_time.isnot(None),
            Auction.end_time > datetime.utcnow(),
            Auction.end_time <= soon_cutoff,
        ).order_by(Auction.end_time.asc()).limit(50).all()

        for _a in ending_soon:
            try:
                _item = await _get_item_details(_a.ebay_listing_id)
                if not _item:
                    continue
                _a.current_price = _item.get("current_price", _a.current_price)
                _a.bid_count = _item.get("bid_count", _a.bid_count)
                _a.end_time = _item.get("end_time", _a.end_time)
                priority_refreshed += 1
            except Exception:
                # One bad listing shouldn't break the whole priority pass.
                continue
        if priority_refreshed:
            db.commit()
    except Exception:
        # Priority pass is best-effort — never fail the overall refresh over it.
        pass

    # Sweep expired auctions so the active list stays clean between refreshes.
    expired_swept = 0
    try:
        now = datetime.utcnow()
        expired_swept = (
            db.query(Auction)
            .filter(Auction.status == "active", Auction.end_time != None, Auction.end_time <= now)
            .update({"status": "ended"}, synchronize_session=False)
        )
        db.commit()
    except Exception:
        pass

    total_active = db.query(Auction).filter(Auction.status == "active").count()
    return {
        "ok": True,
        "searches": len(SEARCH_QUERIES),
        "listings_added": added,
        "total_active": total_active,
        "priority_refreshed": priority_refreshed,
    }


@app.api_route("/api/cron/scrape-free", methods=["GET", "POST"])
async def cron_scrape_free(request: Request):
    """
    Dedicated high-frequency (every 10 min) tick that runs ONLY the free HTML
    scrapers — no eBay Browse API quota burned. Scoped separately from
    /api/cron/sync so we can hammer the cheap scrapers without tripping the
    expensive paths.

    Auth: same pattern as /api/ebay/refresh — ADMIN_TOKEN or vercel-cron UA.
    """
    import os as _os
    admin_token = _os.getenv("ADMIN_TOKEN", "")
    qtoken = request.query_params.get("token", "")
    header_token = request.headers.get("x-admin-token", "")
    ua = request.headers.get("user-agent", "").lower()
    is_cron = "vercel-cron" in ua
    if not is_cron:
        if not admin_token or (qtoken != admin_token and header_token != admin_token):
            return {"ok": False, "error": "unauthorized"}

    results = {"130point": None, "ebay_html_sold": None, "ebay_html_auction": None}
    errors = {}
    try:
        from scrape_130point import ingest_130point
        results["130point"] = await ingest_130point()
    except Exception as e:
        errors["130point"] = str(e)[:200]
    try:
        from scrape_ebay_html import ingest_ebay_html_sold, ingest_ebay_html_auction
        results["ebay_html_sold"] = await ingest_ebay_html_sold()
    except Exception as e:
        errors["ebay_html_sold"] = str(e)[:200]
    try:
        from scrape_ebay_html import ingest_ebay_html_auction
        results["ebay_html_auction"] = await ingest_ebay_html_auction()
    except Exception as e:
        errors["ebay_html_auction"] = str(e)[:200]

    return {"ok": True, "results": results, "errors": errors}


@app.get("/api/debug/ebay")
async def debug_ebay():
    """Quota-free diagnostic: reads eBay rate-limit analytics (no search calls)."""
    from ebay_api import get_oauth_token
    import ebay_api as _ebay_api
    import httpx as _httpx
    token = await get_oauth_token()
    if not token:
        app_id = os.getenv("EBAY_APP_ID", "")
        has_cert = bool(os.getenv("EBAY_CERT_ID"))
        has_secret = bool(os.getenv("EBAY_APP_SECRET"))
        return {
            "error": "OAuth failed — credentials rejected by eBay",
            "ebay_response": _ebay_api._last_oauth_error,
            "app_id_prefix": app_id[:20] if app_id else "",
            "has_cert_id": has_cert,
            "has_app_secret": has_secret,
        }

    async with _httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                "https://api.ebay.com/developer/analytics/v1_beta/rate_limit",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                return {"token_obtained": True, "error": f"HTTP {resp.status_code}",
                        "body": resp.text[:400]}
            data = resp.json()
            limits = []
            for api in data.get("rateLimits", []):
                for res in api.get("resources", []):
                    for rate in res.get("rates", []):
                        limits.append({
                            "api": f"{api.get('apiContext','')}.{api.get('apiName','')}",
                            "resource": res.get("name"),
                            "used": rate.get("count"),
                            "limit": rate.get("limit"),
                            "remaining": rate.get("remaining"),
                            "reset": rate.get("reset"),
                        })
            # Sort most-critical first (lowest remaining %)
            limits.sort(key=lambda x: (x["remaining"] or 0) / max(x["limit"] or 1, 1))
            return {"token_obtained": True, "limits": limits[:15]}
        except Exception as e:
            return {"token_obtained": True, "error": str(e)[:200]}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "F1 Chrome Crest v2",
        "ebay_connected": has_real_credentials(),
    }


@app.post("/api/sync")
async def manual_sync(db: Session = Depends(get_db)):
    """Synchronously fetch live eBay listings. Seeds cards first if needed."""
    if not has_real_credentials():
        return {"success": False, "message": "No eBay credentials configured"}
    from seed_data import seed_all
    seed_all(db)
    from scraper import sync_real_ebay_listings
    added = await sync_real_ebay_listings(db)
    total = db.query(Auction).filter(Auction.status == "active").count()
    cards = db.query(Card).count()
    return {"success": True, "added": added, "total_active": total, "cards_in_db": cards}


@app.post("/api/sync/price-history")
async def manual_price_history_sync(db: Session = Depends(get_db)):
    """Trigger one batch of price history sync (5 drivers, ~300 sold comps each)."""
    if not has_real_credentials():
        return {"success": False, "message": "No eBay credentials"}
    from price_history_sync import sync_price_history_batch
    result = await sync_price_history_batch(db)
    from database import PriceHistory
    total_ph = db.query(PriceHistory).count()
    return {"success": True, **result, "total_price_history_records": total_ph}


@app.post("/api/admin/seed-all-drivers")
def seed_all_drivers(db: Session = Depends(get_db)):
    """Add inline column migrations + seed F2/F3/Legends drivers + tag series on existing F1 drivers."""
    from sqlalchemy import text
    # Inline column migrations (safe to run multiple times)
    for stmt in [
        "ALTER TABLE cards ADD COLUMN series VARCHAR(20) DEFAULT 'F1'",
        "ALTER TABLE cards ADD COLUMN is_rookie BOOLEAN DEFAULT FALSE",
    ]:
        try:
            with engine.connect() as conn:
                conn.execute(text(stmt))
                conn.commit()
        except Exception:
            pass
    from seed_data import seed_missing_drivers
    added = seed_missing_drivers(db)
    return {"added": added, "status": "done"}


@app.post("/api/admin/seed-auto-variants")
def seed_auto_variants(db: Session = Depends(get_db)):
    """Add missing auto variant cards to existing drivers without wiping data."""
    from seed_data import F1_DRIVERS, GRADE_MULT, BASE_PRICE
    AUTO_VARIANTS = [
        {"name": "Auto Blue /150",      "mult": 14.0},
        {"name": "Auto Green /99",       "mult": 20.0},
        {"name": "Auto Gold /50",        "mult": 30.0},
        {"name": "Auto Orange /25",      "mult": 50.0},
        {"name": "Auto Red /5",          "mult": 100.0},
        {"name": "Auto SuperFractor 1/1","mult": 250.0},
        {"name": "Speed Wheels Auto",    "mult": 10.0},
        {"name": "Neon Nations Auto",    "mult": 10.0},
        {"name": "Floor It Auto",        "mult": 10.0},
        {"name": "Vegas at Night Auto",  "mult": 12.0},
        {"name": "Diamond 75th Auto",    "mult": 11.0},
    ]
    added = 0
    for driver in F1_DRIVERS:
        for variant in AUTO_VARIANTS:
            for grade in ["Raw", "PSA 10"]:
                exists = db.query(Card).filter(
                    Card.driver_name == driver["name"],
                    Card.parallel == variant["name"],
                    Card.grade == grade,
                ).first()
                if exists:
                    continue
                base_val = round(BASE_PRICE * driver["multiplier"] * variant["mult"] * GRADE_MULT[grade], 2)
                db.add(Card(
                    driver_name=driver["name"],
                    year=2025,
                    set_name="Topps Chrome F1",
                    card_number=driver["card_num"],
                    parallel=variant["name"],
                    grade=grade,
                    image_url=f"https://placehold.co/200x280/{driver['team_color'].lstrip('#')}/FFFFFF?text={driver['name'].split()[-1]}",
                    base_value=base_val,
                    investment_score=float(driver["score"]),
                    team=driver["team"],
                    team_color=driver["team_color"],
                    nationality=driver["nationality"],
                    career_wins=driver["wins"],
                    championships=driver["championships"],
                ))
                added += 1
    db.commit()
    return {"added": added}


@app.post("/api/admin/reset-price-history-sync")
def reset_price_history_sync(db: Session = Depends(get_db)):
    """Clear all sync logs so every driver is due on the next cron/sync."""
    from database import PriceHistorySyncLog
    deleted = db.query(PriceHistorySyncLog).delete()
    db.commit()
    return {"reset": deleted}


@app.post("/api/admin/fix-stale-endtimes")
def fix_stale_endtimes(db: Session = Depends(get_db)):
    """
    Repair BIN listings whose synthetic 30-day end_time has rolled off.
    These were inserted with `utcnow() + 30 days` and now appear as 'ending
    now' even though they're still active BIN listings on eBay. Push their
    end_times 1 year into the future so the UI stops auto-expiring them.
    """
    from datetime import timedelta as _td
    now = datetime.utcnow()
    future = now + _td(days=365)
    fixed = 0
    candidates = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time < now + _td(days=2),
    ).all()
    for a in candidates:
        bo = a.buying_options or ""
        # Only repair non-AUCTION listings (real auctions should expire naturally)
        if "AUCTION" not in bo:
            a.end_time = future
            fixed += 1
    db.commit()
    return {"fixed": fixed, "total_candidates": len(candidates)}


@app.post("/api/admin/fix-parallel-names")
def fix_parallel_names(db: Session = Depends(get_db)):
    """Rename old parallel print-run names to correct 2025 values: Gold /10→/50, Orange /50→/25, Red /25→/5."""
    renames = {"Gold /10": "Gold /50", "Orange /50": "Orange /25", "Red /25": "Red /5"}
    card_updated = 0
    for old, new in renames.items():
        rows = db.query(Card).filter(Card.parallel == old).all()
        for c in rows:
            c.parallel = new
        card_updated += len(rows)
    db.commit()
    return {"card_rows_updated": card_updated}


@app.post("/api/admin/seed-missing-parallels")
def seed_missing_parallels(db: Session = Depends(get_db)):
    """Add Autograph / Gold /10 / Prism Refractor cards that weren't in original seed."""
    from seed_data import F1_DRIVERS, PARALLELS, GRADE_MULT, BASE_PRICE
    added = 0
    for driver in F1_DRIVERS:
        for parallel in PARALLELS:
            for grade in ["Raw", "PSA 10"]:
                exists = db.query(Card).filter(
                    Card.driver_name == driver["name"],
                    Card.parallel == parallel["name"],
                    Card.grade == grade,
                ).first()
                if exists:
                    continue
                base_val = round(BASE_PRICE * driver["multiplier"] * parallel["mult"] * GRADE_MULT[grade], 2)
                db.add(Card(
                    driver_name=driver["name"],
                    year=2025,
                    set_name="Topps Chrome F1",
                    card_number=driver["card_num"],
                    parallel=parallel["name"],
                    grade=grade,
                    image_url=f"https://placehold.co/200x280/{driver['team_color'].lstrip('#')}/FFFFFF?text={driver['name'].split()[-1]}",
                    base_value=base_val,
                    investment_score=float(driver["score"]),
                    team=driver["team"],
                    team_color=driver["team_color"],
                    nationality=driver["nationality"],
                    career_wins=driver["wins"],
                    championships=driver["championships"],
                ))
                added += 1
    db.commit()
    return {"added": added}


@app.post("/api/admin/scrape-card-images")
async def trigger_card_image_scrape_sync(db: Session = Depends(get_db)):
    """Synchronously scrape eBay public search for card catalog images."""
    from card_image_scraper import scrape_all_missing
    updated = await scrape_all_missing(db)
    return {"status": "done", "updated": updated}


@app.post("/api/admin/rebuild")
async def rebuild_auctions(db: Session = Depends(get_db)):
    """Delete all active auctions and re-sync from eBay with correct parallel matching."""
    from seed_data import seed_all
    seed_all(db)
    deleted = db.query(Auction).filter(Auction.status == "active").delete()
    db.commit()
    from scraper import sync_real_ebay_listings
    added = await sync_real_ebay_listings(db)
    total = db.query(Auction).filter(Auction.status == "active").count()
    return {"deleted": deleted, "added": added, "total_active": total}


@app.get("/api/ebay-status")
def ebay_status():
    connected = has_real_credentials()
    return {
        "connected": connected,
        "message": "Live eBay Browse API active" if connected else "No credentials — add EBAY_APP_ID + EBAY_APP_SECRET to backend/.env",
    }


_OG_DRIVERS = [
    # F1 2024-25 grid
    'Max Verstappen', 'Yuki Tsunoda', 'Charles Leclerc', 'Lewis Hamilton',
    'Lando Norris', 'Oscar Piastri', 'George Russell', 'Andrea Kimi Antonelli',
    'Fernando Alonso', 'Lance Stroll', 'Liam Lawson', 'Isack Hadjar',
    'Esteban Ocon', 'Oliver Bearman', 'Franco Colapinto', 'Alexander Albon',
    'Carlos Sainz', 'Nico Hulkenberg', 'Gabriel Bortoleto', 'Pierre Gasly',
    'Jack Doohan', 'Sergio Perez', 'Valtteri Bottas', 'Zhou Guanyu',
    'Daniel Ricciardo',
    # Legends
    'Michael Schumacher', 'Ayrton Senna', 'Alain Prost', 'Nigel Mansell',
    'Sebastian Vettel', 'Kimi Raikkonen', 'Niki Lauda',
]
_OG_PARALLELS = [
    'Refractor', 'Prism Refractor', 'Aqua /199', 'Blue /150',
    'Green /99', 'Gold /50', 'Orange /25', 'Autograph',
]


def _og_kebab(s: str) -> str:
    import re as _re
    s = (s or '').lower()
    s = _re.sub(r'[^a-z0-9]+', '-', s)
    return _re.sub(r'^-+|-+$', '', s)


def _og_parse_slug(slug: str):
    """Mirror frontend parseSlug — longest driver match, then parallel."""
    clean = _og_kebab(slug)
    for d in sorted(_OG_DRIVERS, key=len, reverse=True):
        dk = _og_kebab(d)
        if clean == dk or clean.startswith(dk + '-'):
            rest = clean[len(dk):].lstrip('-')
            for p in sorted(_OG_PARALLELS, key=len, reverse=True):
                pk = _og_kebab(p)
                if rest == pk or rest.startswith(pk):
                    return d, p
            # fallback — title-case the leftover tokens
            rest_human = ' '.join(w.capitalize() for w in rest.split('-') if w)
            return d, (rest_human or 'Base')
    return None, None


@app.get("/og/card/{slug}")
def og_card(slug: str, db: Session = Depends(get_db)):
    """Dynamic 1200x630 OG image for a card slug — black background with
    driver, parallel, median price + verdict. Cached for 1h."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return Response(
            content=b"PIL not installed - add pillow to requirements.txt",
            media_type="text/plain",
            status_code=503,
        )

    from datetime import timedelta as _td
    from database import SoldCard as _SoldCard

    driver, parallel = _og_parse_slug(slug)
    title_line = f"{driver} {parallel}" if driver and parallel else (slug or "Unknown card")

    median_total = None
    n_comps = 0
    verdict = "—"
    if driver and parallel:
        cutoff = datetime.utcnow() - _td(days=90)
        q = db.query(_SoldCard).filter(
            _SoldCard.driver_name == driver,
            _SoldCard.parallel == parallel,
            _SoldCard.sale_date >= cutoff,
            _SoldCard.sale_price > 0,
            _SoldCard.is_duplicate == False,  # noqa: E712
            _SoldCard.grade.is_(None),
        )
        totals = [
            (s.sale_price or 0) + (s.shipping_cost or 0) for s in q.all()
        ]
        totals = [t for t in totals if t > 0]
        n_comps = len(totals)
        if totals:
            srt = sorted(totals)
            mid = len(srt) // 2
            median_total = srt[mid] if len(srt) % 2 else (srt[mid - 1] + srt[mid]) / 2

        # crude verdict: cheapest active / median
        try:
            active = db.query(Auction).filter(
                Auction.status == "active",
            ).all()
            pl = parallel.lower()
            matches = [
                ((a.current_price or 0) + (a.shipping_cost or 0))
                for a in active
                if a.card and a.card.driver_name == driver and (
                    (a.card.parallel or '').lower() == pl
                    or pl in (a.title or '').lower()
                )
            ]
            matches = [m for m in matches if m > 0]
            if matches and median_total:
                ratio = min(matches) / median_total
                if ratio <= 0.6:
                    verdict = "STRONG BUY"
                elif ratio <= 0.8:
                    verdict = "GOOD BUY"
                elif ratio <= 1.1:
                    verdict = "FAIR"
                else:
                    verdict = "OVERPRICED"
        except Exception:
            pass

    # Build 1200x630 image
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), color=(8, 8, 12))
    draw = ImageDraw.Draw(img)

    def _font(size):
        for path in (
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
        return ImageFont.load_default()

    f_brand = _font(30)
    f_title = _font(72)
    f_sub = _font(40)
    f_price = _font(110)
    f_label = _font(26)
    f_verdict = _font(60)

    # Red accent stripe
    draw.rectangle([(0, 0), (W, 8)], fill=(220, 40, 40))

    # Brand
    draw.text((60, 40), "F1 CARD VAULT", font=f_brand, fill=(220, 40, 40))

    # Title (driver)
    driver_text = (driver or "Card").upper()
    draw.text((60, 110), driver_text[:22], font=f_title, fill=(255, 255, 255))

    # Parallel subtitle
    if parallel:
        draw.text((60, 210), parallel, font=f_sub, fill=(180, 180, 200))

    # Median price block
    draw.text((60, 310), "90-DAY MEDIAN", font=f_label, fill=(140, 140, 160))
    if median_total:
        draw.text((60, 345), f"${median_total:,.0f}", font=f_price, fill=(80, 220, 120))
        draw.text((60, 480), f"n={n_comps} recent comps", font=f_label, fill=(140, 140, 160))
    else:
        draw.text((60, 345), "—", font=f_price, fill=(140, 140, 160))
        draw.text((60, 480), "no recent comps", font=f_label, fill=(140, 140, 160))

    # Verdict badge (top right)
    if verdict and verdict != "—":
        color = (16, 185, 129) if verdict == "STRONG BUY" else \
                (34, 197, 94) if verdict == "GOOD BUY" else \
                (107, 114, 128) if verdict == "FAIR" else (239, 68, 68)
        bbox = draw.textbbox((0, 0), verdict, font=f_verdict)
        tw = bbox[2] - bbox[0]
        pad = 24
        x1 = W - 60 - tw - 2 * pad
        y1 = 110
        draw.rounded_rectangle([(x1, y1), (W - 60, y1 + 90)], radius=12, fill=color)
        draw.text((x1 + pad, y1 + 14), verdict, font=f_verdict, fill=(0, 0, 0))

    # Footer
    draw.text((60, H - 60), "f1cardvault.com  ·  live eBay prices", font=f_label, fill=(100, 100, 120))

    from io import BytesIO as _BytesIO
    buf = _BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/feed.xml")
def rss_strong_buys(db: Session = Depends(get_db)):
    """RSS 2.0 feed of the 20 most recent STRONG BUY active listings."""
    from scraper import median_comp_price, _extract_grade_from_title
    from xml.sax.saxutils import escape as _xe

    SITE = "https://www.f1cardvault.com"
    now = datetime.utcnow()

    rows = db.query(Auction).filter(
        Auction.status == "active",
    ).order_by(Auction.id.desc()).limit(300).all()

    items_xml = []
    cache: dict = {}
    count = 0
    for a in rows:
        if count >= 20:
            break
        if not a.card:
            continue
        driver = a.card.driver_name or ""
        parallel = a.card.parallel or ""
        grade = _extract_grade_from_title(a.title or "")
        key = (driver, parallel, grade)
        if key not in cache:
            cache[key] = median_comp_price(db, driver, parallel, grade)
        median, n = cache[key]
        if not (median and n >= 3):
            continue
        total = (a.current_price or 0) + (a.shipping_cost or 0)
        if median <= 0 or total / median > 0.6:
            continue

        title = f"STRONG BUY: {driver} {parallel} — ${total:.0f} (vs ${median:.0f} median)"
        link = a.ebay_url or f"{SITE}/auctions"
        desc = (
            f"<p><b>{_xe(driver)} {_xe(parallel)}</b> listed at "
            f"<b>${total:.2f}</b> vs {n}-sale median <b>${median:.2f}</b> "
            f"({(total / median * 100):.0f}% of median — {((median - total) / median * 100):.0f}% discount).</p>"
            f"<p>{_xe((a.title or '')[:180])}</p>"
        )
        pub = (a.last_updated or a.created_at or now)
        pub_str = pub.strftime("%a, %d %b %Y %H:%M:%S GMT")
        guid = f"{SITE}/auction/{a.id}"
        items_xml.append(
            f"<item>"
            f"<title>{_xe(title)}</title>"
            f"<link>{_xe(link)}</link>"
            f"<guid isPermaLink=\"false\">{_xe(guid)}</guid>"
            f"<description>{_xe(desc)}</description>"
            f"<pubDate>{pub_str}</pubDate>"
            f"</item>"
        )
        count += 1

    build_date = now.strftime("%a, %d %b %Y %H:%M:%S GMT")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel>'
        '<title>F1 Card Vault — Strong Buys</title>'
        f'<link>{SITE}</link>'
        '<description>Active eBay listings priced ≤60% of their 90-day sold median. 2025 Topps Chrome Formula 1.</description>'
        '<language>en-us</language>'
        f'<lastBuildDate>{build_date}</lastBuildDate>'
        + "".join(items_xml) +
        '</channel></rss>'
    )
    return Response(content=xml, media_type="application/rss+xml; charset=utf-8")


# Serve frontend
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        return FileResponse(os.path.join(frontend_dist, "index.html"))


@app.on_event("startup")
async def startup_event():
    # Always ensure schema + tables exist (idempotent, fast on subsequent calls)
    create_tables()

    # Add new columns if missing — handles both SQLite (local) and Postgres (Vercel).
    try:
        from database import engine as _engine, DATABASE_URL as _db_url
        _sa_text = __import__("sqlalchemy").text
        with _engine.connect() as conn:
            migrations = [
                ("auctions", "buying_options", "TEXT"),
                ("auctions", "extra_images", "TEXT"),
                ("price_history", "ebay_item_id", "VARCHAR(64)"),
                ("sold_cards", "source", "VARCHAR DEFAULT 'eBay'"),
            ]
            for table, col, typedef in migrations:
                try:
                    conn.execute(_sa_text(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}"))
                    conn.commit()
                except Exception:
                    pass  # Column already exists
    except Exception:
        pass

    import os
    is_vercel = bool(os.environ.get("VERCEL"))

    if is_vercel:
        # On Vercel: seed cards only. Do NOT kick off an eBay sync on every
        # cold start — each cold start triggered 16 API calls, exhausting the
        # Browse API daily quota (5,000/day) within hours. The scheduled cron
        # at /api/cron/sync is the single source of live-data refresh.
        try:
            from database import SessionLocal
            from seed_data import seed_all
            db = SessionLocal()
            try:
                seed_all(db)
            finally:
                db.close()
        except Exception as _e:
            print(f"startup seed skipped: {_e}")
    else:
        # Local dev: full startup including scheduler and initial sync
        try:
            from database import SessionLocal
            from seed_data import seed_all
            db = SessionLocal()
            try:
                seed_all(db)
            finally:
                db.close()
        except Exception:
            pass
        start_scheduler()
        # Scrape real card images from eBay public search (no API key needed)
        asyncio.create_task(_scrape_card_images())
        if has_real_credentials():
            print("F1 Chrome Crest — LIVE eBay API connected. Running initial sync...")
            asyncio.create_task(_initial_ebay_sync())
        else:
            print("F1 Chrome Crest — WARNING: No eBay credentials found.")


async def _scrape_card_images():
    """Scrape eBay public search for real card images and persist to DB."""
    await asyncio.sleep(2)  # Let startup settle
    from card_image_scraper import scrape_all_missing
    from database import SessionLocal
    db = SessionLocal()
    try:
        updated = await scrape_all_missing(db)
        print(f"Card images scraped: {updated} cards updated with real photos")
    except Exception as e:
        print(f"Card image scrape failed: {e}")
    finally:
        db.close()


async def _initial_ebay_sync():
    """Run first eBay sync immediately on startup."""
    await asyncio.sleep(2)
    from database import SessionLocal
    from scraper import sync_real_ebay_listings
    db = SessionLocal()
    try:
        added = await sync_real_ebay_listings(db)
        print(f"Initial eBay sync complete — {added} listings loaded")
    except Exception as e:
        print(f"Initial eBay sync failed: {e}")
    finally:
        db.close()
