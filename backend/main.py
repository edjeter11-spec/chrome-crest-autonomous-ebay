import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

# Initialize Sentry early (before other imports) for comprehensive error capture
import sentry_sdk
SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.getenv("ENVIRONMENT", "development"),
        release=os.getenv("APP_VERSION", "unknown"),
        traces_sample_rate=0.1 if os.getenv("ENVIRONMENT") == "production" else 1.0,
        integrations=[
            sentry_sdk.integrations.fastapi.FastApiIntegration(),
            sentry_sdk.integrations.sqlalchemy.SqlalchemyIntegration(),
        ]
    )

# Production DB guard: warn loudly on Vercel if DATABASE_URL isn't Postgres.
# (Was raise RuntimeError but that crashes the entire serverless function on
# import — turning data-safety guard into a total outage. Now logs a warning
# and lets the app boot; SQLite fallback is risky but better than 500 on every
# request while Eddie sets the env var.)
_DB_URL = os.getenv("DATABASE_URL", "")
if os.getenv("VERCEL") == "1" and not _DB_URL.startswith("postgres"):
    # Refuse to boot on Vercel without Postgres. The previous "warn and
    # continue" path silently fell through to SQLite at /tmp/f1cards.db,
    # which is ephemeral per lambda instance — every write would be lost
    # on the next cold start, masquerading as data corruption. Better to
    # 500 every request loudly until DATABASE_URL is set correctly.
    raise RuntimeError(
        "[DB GUARD] DATABASE_URL must be a postgres:// URL on Vercel. "
        f"Got: {_DB_URL[:30]!r}. Refusing to boot to prevent silent data loss."
    )

# UTC helper. All model defaults in database.py currently store naive UTC via
# datetime.utcnow; frontend appends Z via parseUtc() to interpret as UTC.
# Long-term fix: migrate routers to emit timezone-aware ISO (follow-up).
from datetime import datetime as _dt_utc, timezone as _tz_utc
def utcnow():
    """Always returns naive UTC for compatibility, but ensures it IS UTC."""
    return _dt_utc.now(_tz_utc.utc).replace(tzinfo=None)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query as QueryParam, Request, Body
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
from routers import email_alerts
from routers import weekly_digest as weekly_digest_router
from routers import index as indices_router
from routers import seo_pages as seo_pages_router
from routers import seo as seo_router
from routers import affiliate_roi as affiliate_roi_router
from routers import sold as sold_router
from routers import feedback as feedback_router
from ebay_api import has_real_credentials

app = FastAPI(title="F1 Chrome Crest", version="2.0.0")

# Per-IP rate-limit dict for /api/sniper/refresh-imminent (user-triggered).
# Keyed by client IP; value is the unix timestamp of last successful call.
# Module-level so it survives across requests within a single process.
_refresh_imminent_rate: dict = {}

# --- CORS lockdown (security) ---------------------------------------------
# Previously `allow_origins=["*"]` with credentials — unsafe. Then loosened to
# any *.vercel.app preview URL with credentials=True — still unsafe (CSRF-with-
# cookies if an attacker guesses a preview URL). Now: credentials=TRUE only for
# the prod hosts + the canonical Vercel deployment. Preview deploys must hit
# the API without credentials (they don't need cookies for testing). Localhost
# stays in the allowlist for dev.
ALLOWED_ORIGINS = [
    "https://f1cardvault.com",
    "https://www.f1cardvault.com",
    "https://chrome-crest-autonomous-ebay.vercel.app",
]

# Dev-only: when not running on Vercel, allow local dev origins.
if os.getenv("VERCEL") != "1":
    ALLOWED_ORIGINS += ["http://localhost:3000", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Preview wildcard regex removed deliberately — keeps credentials=True safe.
    # Preview deploys can still call the API without cookies (browser will just
    # CORS-block credentialed requests to a preview URL, which is what we want).
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# --- Global error handler -------------------------------------------------
# Hard rule: NO unhandled 500s ever reach the browser. Every API route either
# returns its real shape or a graceful empty/degraded version.
# This is the structural guard that keeps the site rendering the shell even
# when a backend bug or schema drift breaks one endpoint. Without it, a
# single broken router crashes every page that fetches from it.
import logging as _root_log
from fastapi.responses import JSONResponse as _JSONResp
from fastapi.requests import Request as _ReqType

# Module-level logger — several call sites below reference `logger.warning(...)`
# and `logger.error(...)` (e.g. line ~1819, ~2261) but it was never defined.
# Those would raise NameError if reached, but the surrounding `try/except` swallowed
# them, hiding the bug. Defining it here makes those existing log lines work AND
# powers the new visibility logging added to previously-silent except blocks.
logger = _root_log.getLogger("main")

@app.exception_handler(Exception)
async def _graceful_500_handler(request: _ReqType, exc: Exception):
    _root_log.getLogger("api").exception(f"unhandled error on {request.url.path}: {exc}")
    # Capture exception in Sentry for monitoring
    if SENTRY_DSN:
        sentry_sdk.capture_exception(exc)
    path = request.url.path or ""
    # Cron endpoints self-report their partial-failure state in the JSON body
    # (errors[]/ok flags). Returning 200 keeps Vercel's cron dashboard from
    # marking the run failed when only one of many sub-tasks died. Everything
    # else returns 502 so Sentry/uptime/devtools surface the real failure
    # while the friendly degraded body still keeps the UI from crashing.
    is_cron = "/api/cron/" in path
    status = 200 if is_cron else 502
    # Choose an empty shape that matches what the frontend expects so it
    # renders an empty list rather than a crashing JSON parse.
    if "/auctions" in path:
        return _JSONResp({"total": 0, "auctions": [], "verdict_counts": {"STRONG_BUY": 0, "GOOD_BUY": 0, "with_comps": 0}, "_degraded": True}, status_code=status)
    if "/sales" in path:
        return _JSONResp({"sales": [], "total": 0, "_degraded": True}, status_code=status)
    if "/indices" in path:
        return _JSONResp({"indices": [], "_degraded": True}, status_code=status)
    if "/snipe" in path or "/sniper" in path:
        return _JSONResp({"targets": [], "snipes": [], "_degraded": True}, status_code=status)
    if "/alerts" in path:
        return _JSONResp({"alerts": [], "_degraded": True}, status_code=status)
    if "/portfolio" in path or "/wishlist" in path:
        return _JSONResp([], status_code=status)
    # Default: generic error JSON instead of opaque 500. Never echo str(exc)
    # to clients — exception text can leak connection strings, file paths,
    # or SQL. Full detail goes to the logger + Sentry capture above only.
    return _JSONResp({"error": "internal error", "path": path, "_degraded": True}, status_code=status)


# --- Admin auth gate -------------------------------------------------------
# Every `/api/admin/*` route requires a matching ADMIN_TOKEN. If the env var
# isn't set, the routes return 503 (admin disabled) so there's no blanket
# open-mode fallback. Header-only (X-Admin-Token) — the old `?token=` query
# param was removed (query strings leak into logs/analytics/referrers).
# Cron endpoints accept Vercel's `Authorization: Bearer <CRON_SECRET>` OR the
# admin header via require_cron_or_admin. Both use constant-time compares.
# Implementations live in lib/auth.py so routers can share them without a
# circular import on main.
from lib.auth import require_admin, require_cron_or_admin, client_ip as _client_ip

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
app.include_router(verdict_accuracy.public_router)
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
app.include_router(email_alerts.router)
app.include_router(weekly_digest_router.router)
app.include_router(indices_router.router)
app.include_router(seo_pages_router.router)
app.include_router(seo_router.router)
app.include_router(affiliate_roi_router.router)
app.include_router(sold_router.router)
app.include_router(feedback_router.router)


@app.post("/api/admin/migrate-shared-watchlists")
def migrate_shared_watchlists(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real
        # work. Common to fail on perms/conflicts; safe to swallow.
        logger.warning(f"shared_watchlists create_all skipped: {_e}")
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
def migrate_watch_rules(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"watch_rules create_all skipped: {_e}")
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
def migrate_bid_intents(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"bid_intents create_all skipped: {_e}")
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
def migrate_scraper_runs(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"scraper_runs create_all skipped: {_e}")
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


@app.post("/api/admin/clean-null-driver-sold")
def clean_null_driver_sold(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """One-shot data cleanup: delete sold_cards rows whose driver_name is NULL.
    Audit found ~5% of sold_cards have no driver_name attached — they never
    aggregate into anything useful and dilute medians on edge queries.

    Idempotent: safe to call multiple times. Second call deletes 0 rows and
    returns the current totals. Returns {deleted, remaining} so Eddie can
    sanity-check the diff against the pre-cleanup count.
    """
    from database import SoldCard
    try:
        # Count first so the response includes the size of the operation, even
        # if the delete itself returns rowcount via the ORM.
        to_delete = db.query(SoldCard).filter(SoldCard.driver_name.is_(None)).count()
        deleted = 0
        if to_delete:
            # synchronize_session=False — we don't reuse the session after this,
            # and it dramatically speeds up bulk delete on Postgres.
            deleted = db.query(SoldCard).filter(
                SoldCard.driver_name.is_(None)
            ).delete(synchronize_session=False)
            db.commit()
        remaining = db.query(SoldCard).count()
        return {"ok": True, "deleted": int(deleted), "remaining": int(remaining)}
    except Exception as e:
        db.rollback()
        logger.exception(f"clean-null-driver-sold failed: {e}")
        return {"ok": False, "error": str(e)[:200]}


@app.get("/api/health/data-freshness")
def data_freshness(response: Response = None, db: Session = Depends(get_db)):
    """Is the data actually FRESH? Public, cheap, no auth.

    Exists because /api/admin/scraper-health tracks whether scrapers RAN,
    not whether their writes ever reached this database — and that's the
    exact blind spot that hid a 7-week outage: after the 2026-06-08
    Supabase->Neon migration, the GitHub Actions DATABASE_URL secret still
    pointed at the dead Supabase DB. Every run reported thousands of
    successful upserts into a database the site doesn't read. Telemetry
    looked healthy; the Sales page was frozen.

    This measures the only thing users actually feel: how old is the
    newest row. Status is degraded/stale purely on age, so a silently
    misrouted pipeline shows up here within a day.
    """
    from database import SoldCard
    from sqlalchemy import func as _func

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=300"

    now = datetime.utcnow()
    out = {"checked_at": now.isoformat()}

    try:
        newest_sale, newest_scrape, total = (
            db.query(
                _func.max(SoldCard.sale_date),
                _func.max(SoldCard.scraped_at),
                _func.count(SoldCard.id),
            ).first()
        )
        age_h = (now - newest_scrape).total_seconds() / 3600 if newest_scrape else None
        # Scrapers run every 3h; 48h of silence means something is broken.
        if age_h is None:
            status = "unknown"
        elif age_h <= 12:
            status = "ok"
        elif age_h <= 48:
            status = "degraded"
        else:
            status = "stale"
        out["sold_cards"] = {
            "status": status,
            "total_rows": int(total or 0),
            "newest_sale_date": newest_sale.isoformat() if newest_sale else None,
            "newest_scraped_at": newest_scrape.isoformat() if newest_scrape else None,
            "hours_since_last_write": round(age_h, 1) if age_h is not None else None,
        }
    except Exception as e:
        out["sold_cards"] = {"status": "error", "error": str(e)[:160]}

    try:
        active = db.query(Auction).filter(Auction.status == "active").count()
        newest_auction = db.query(_func.max(Auction.last_updated)).scalar()
        a_age = (now - newest_auction).total_seconds() / 3600 if newest_auction else None
        out["auctions"] = {
            "status": ("ok" if (a_age is not None and a_age <= 6)
                       else "degraded" if (a_age is not None and a_age <= 24)
                       else "stale" if a_age is not None else "unknown"),
            "active_rows": int(active or 0),
            "newest_updated_at": newest_auction.isoformat() if newest_auction else None,
            "hours_since_last_write": round(a_age, 1) if a_age is not None else None,
        }
    except Exception as e:
        out["auctions"] = {"status": "error", "error": str(e)[:160]}

    worst = [v.get("status") for v in out.values() if isinstance(v, dict)]
    out["ok"] = all(s in ("ok", "degraded") for s in worst if s)
    return out


@app.get("/api/admin/scraper-health")
def scraper_health(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
def migrate_sold_source(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"sold_cards.source create_all skipped: {_e}")
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
def migrate_dedup_flag(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"sold_cards.is_duplicate create_all skipped: {_e}")
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
def backfill_dedup(_admin=Depends(require_admin)):
    """Sweep sold_cards, compute fuzzy fingerprints, mark soft duplicates."""
    try:
        from dedup import backfill_duplicates
        return {"status": "done", **backfill_duplicates()}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[-500:]}


@app.post("/api/admin/migrate-push-subscriptions")
def migrate_push_subscriptions(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"push_subscriptions create_all skipped: {_e}")
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
def migrate_sold_cards(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort dev-parity create_all — explicit SQL below is the real work.
        logger.warning(f"sold_cards create_all skipped: {_e}")

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
def migrate_psa_tables(_admin=Depends(require_admin)):
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
    except Exception as _e:
        # Best-effort SQLAlchemy create_all — explicit SQL below is the real work.
        logger.warning(f"psa_sales create_all skipped: {_e}")

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
async def debug_finding_api(_admin=Depends(require_admin)):
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
async def admin_ingest_sold(_admin=Depends(require_admin)):
    """Pull sold listings from eBay Finding API and upsert non-base 2025 Chrome F1."""
    from sold_ingest import ingest_all_drivers
    try:
        result = await ingest_all_drivers()
        return {"status": "ok", **result}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[:800]}


@app.post("/api/admin/scrape-card-images")
async def trigger_card_image_scrape(_admin=Depends(require_admin)):
    """Manually trigger a card image scrape from eBay public search."""
    asyncio.create_task(_scrape_card_images())
    return {"status": "scraping started — check logs"}


@app.post("/api/admin/clean-bin-end-times")
def admin_clean_bin_end_times(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """One-shot: BIN listings with end_time > now+60 days are leftover
    placeholders from old scraper code that was never updated. eBay BINs
    are GTC-renewed every 30 days, so anything past that is stale —
    clamp to now+30d so they sort correctly and the ending-soon view
    isn't crowded with future-dated junk."""
    from database import Auction
    cutoff = datetime.utcnow() + timedelta(days=60)
    new_end = datetime.utcnow() + timedelta(days=30)
    updated = (
        db.query(Auction)
        .filter(
            Auction.status == "active",
            Auction.end_time > cutoff,
            Auction.buying_options.like('%FIXED_PRICE%'),
        )
        .update({"end_time": new_end, "last_updated": datetime.utcnow()},
                synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "rows_clamped": updated}


@app.post("/api/admin/scrape-130point")
async def admin_scrape_130point(_admin=Depends(require_admin)):
    """Scrape 130point.com sold comps and upsert into SoldCard."""
    from scrape_130point import ingest_130point
    try:
        result = await ingest_130point()
        return {"status": "ok", **result}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e)[:300], "trace": traceback.format_exc()[:800]}


@app.post("/api/admin/scrape-ebay-html")
async def admin_scrape_ebay_html(mode: str = QueryParam("sold"), _admin=Depends(require_admin)):
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
async def admin_ingest_finding_api_all(_admin=Depends(require_admin)):
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
        # Short CDN cache on misses: transient DB/Wikipedia failures shouldn't
        # pin a 404 for long, but bursts also shouldn't hammer the function.
        return Response(status_code=404, headers={"Cache-Control": "public, s-maxage=300"})
    if redirect:
        # Cache the redirect at the CDN for a day. The in-memory photo cache
        # dies with every serverless instance, so without this header every
        # avatar on a page load hit a cold function (DB query + possible 8s
        # Wikipedia fetch) — the intermittent blank-avatar bug.
        return RedirectResponse(
            url=url,
            status_code=302,
            headers={"Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800"},
        )
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


@app.get("/api/drivers/{driver_name}/news")
def driver_news(driver_name: str, response: Response = None, db: Session = Depends(get_db)):
    """Auto-generate per-driver news facts from existing data sources.
    Returns up to 5 most-relevant facts ordered by recency / impact."""
    from database import SoldCard, RaceResult
    from datetime import datetime as _dt, timedelta as _td
    from sqlalchemy import func, desc

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=600, stale-while-revalidate=3600"

    facts = []
    now = _dt.utcnow()

    # 1. Latest race result (last 30 days)
    last_race = (
        db.query(RaceResult)
        .filter(
            RaceResult.driver_name.ilike(driver_name),
            RaceResult.race_date >= now - _td(days=30),
        )
        .order_by(desc(RaceResult.race_date))
        .first()
    )
    if last_race:
        if last_race.position == 1:
            facts.append({
                "kind": "win",
                "icon": "\U0001F3C6",
                "headline": f"Won {last_race.race_name}",
                "date": last_race.race_date.isoformat(),
                "impact": "high",
            })
        elif last_race.position and last_race.position <= 3:
            facts.append({
                "kind": "podium",
                "icon": "\U0001F949",
                "headline": f"Podium ({last_race.position}) at {last_race.race_name}",
                "date": last_race.race_date.isoformat(),
                "impact": "medium",
            })
        elif last_race.position and last_race.position <= 10:
            facts.append({
                "kind": "points",
                "icon": "\U0001F4CA",
                "headline": f"P{last_race.position} at {last_race.race_name}",
                "date": last_race.race_date.isoformat(),
                "impact": "low",
            })
        elif last_race.status in ("DNF", "DSQ"):
            facts.append({
                "kind": "dnf",
                "icon": "❌",
                "headline": f"{last_race.status} at {last_race.race_name}",
                "date": last_race.race_date.isoformat(),
                "impact": "low",
            })

    # 2. Sales velocity — last 7d avg vs prior 7d avg
    last_7d_cut = now - _td(days=7)
    prior_7d_cut = now - _td(days=14)
    last7 = db.query(func.avg(SoldCard.sale_price)).filter(
        SoldCard.driver_name.ilike(driver_name),
        SoldCard.sale_date >= last_7d_cut,
        SoldCard.is_duplicate == False,  # noqa: E712
        SoldCard.sale_price > 0,
    ).scalar()
    prior7 = db.query(func.avg(SoldCard.sale_price)).filter(
        SoldCard.driver_name.ilike(driver_name),
        SoldCard.sale_date >= prior_7d_cut,
        SoldCard.sale_date < last_7d_cut,
        SoldCard.is_duplicate == False,  # noqa: E712
        SoldCard.sale_price > 0,
    ).scalar()
    if last7 and prior7 and prior7 > 0:
        pct = round((float(last7) - float(prior7)) / float(prior7) * 100)
        if abs(pct) >= 8:  # only surface meaningful moves
            facts.append({
                "kind": "velocity",
                "icon": "\U0001F4C8" if pct > 0 else "\U0001F4C9",
                "headline": f"Avg sale price {'up' if pct > 0 else 'down'} {abs(pct)}% week-over-week",
                "date": now.isoformat(),
                "impact": "medium" if abs(pct) >= 20 else "low",
            })

    # 3. Recent big sale (>=$200, last 14d)
    big = (
        db.query(SoldCard)
        .filter(
            SoldCard.driver_name.ilike(driver_name),
            SoldCard.sale_date >= now - _td(days=14),
            SoldCard.sale_price >= 200,
            SoldCard.is_duplicate == False,  # noqa: E712
        )
        .order_by(desc(SoldCard.sale_price))
        .first()
    )
    if big:
        days_ago = max(1, (now - big.sale_date).days)
        facts.append({
            "kind": "big_sale",
            "icon": "\U0001F4B0",
            "headline": f"${int(big.sale_price)} {big.parallel or 'card'} sold {days_ago}d ago",
            "date": big.sale_date.isoformat(),
            "impact": "medium",
        })

    # 4. Sales count this week vs last week (volume)
    cnt7 = db.query(func.count(SoldCard.id)).filter(
        SoldCard.driver_name.ilike(driver_name),
        SoldCard.sale_date >= last_7d_cut,
        SoldCard.is_duplicate == False,  # noqa: E712
    ).scalar() or 0
    if cnt7 >= 20:
        facts.append({
            "kind": "volume",
            "icon": "\U0001F525",
            "headline": f"{cnt7} sales in the last 7 days — high market activity",
            "date": now.isoformat(),
            "impact": "low",
        })

    return {"driver": driver_name, "facts": facts[:5]}


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

# Scheduler broadcast wiring is deferred to startup (local-dev only). Importing
# `scheduler` here pulled in scraper/ebay_api on every Vercel cold start for a
# WS broadcast path that never fires on serverless.


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
    """DISABLED 2026-06-08 — unauth bid-placing endpoint. Reads EBAY_USER_TOKEN
    env and calls eBay PlaceOffer, but has NO per-user auth, so any visitor
    could place bids paid by the operator's eBay account the moment that env
    var gets set. Returning 503 until proper auth is implemented per the
    checklist documented in routers/auctions.py:464-476 (Supabase JWT verify
    + per-user eBay OAuth linkage + ownership check). Comment-only fix; the
    handler signature stays so frontend stubs / monitoring don't 404."""
    from fastapi import HTTPException
    raise HTTPException(503, "execute-snipe disabled: needs per-user auth + eBay OAuth linking; see routers/auctions.py:464")


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
async def cron_sync(db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
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
    logger.info("cron_sync: stage=browse_sync start")
    try:
        added = await sync_real_ebay_listings(db)
    except Exception as e:
        ebay_error = str(e)[:200]
    logger.info(f"cron_sync: stage=browse_sync done added={added} error={ebay_error}")
    # Hard deadline: fetch_sold_for_driver does up to 3 sequential 15s-capped
    # Finding-API pages per driver. At BATCH_SIZE drivers that's a real risk
    # of blowing the whole route's time budget when eBay is slow/rate-
    # limited — confirmed live 2026-07-29 (this stage alone hung 2min50s+,
    # no response ever sent, nothing downstream ran). On timeout, bail the
    # WHOLE route immediately rather than keep using `db` afterward — a
    # cancelled-mid-query session isn't safe to reuse for the remaining
    # sync/scraper stages below.
    try:
        ph = await asyncio.wait_for(sync_price_history_batch(db), timeout=90)
    except asyncio.TimeoutError:
        ph_error = "sync_price_history_batch timed out (90s) — will retry next tick"
        logger.error(f"cron_sync: stage=price_history TIMEOUT — aborting rest of route")
        return {"ok": False, "stage": "price_history_timeout", "added": added, "ebay_error": ebay_error, "price_history_error": ph_error}
    except Exception as e:
        ph_error = str(e)[:200]
    logger.info(f"cron_sync: stage=price_history done error={ph_error}")

    # Sold-card ingest moved OUT of this route to its own cron
    # (/api/cron/sold-ingest, see below) — this route was already stacking
    # browse_sync + price_history + 2 free scrapers, and measured live
    # 2026-07-29 each eBay-dependent stage costs ~35-40s/item right now
    # (eBay Finding/Browse APIs are just slow, not erroring). Cramming
    # sold_ingest in here too pushed the combined route past whatever
    # Vercel's function-duration ceiling is on every test — no response,
    # nothing committed, indistinguishable from a hang. Splitting the work
    # across two independently-scheduled routes fixes it without needing
    # to guess at the exact ceiling.
    sold_result = None
    finding_result = None
    sold_error = None

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

    # Recompute snipe_eligible for every active auction so the dashboard
    # "Active Snipes" counter catches up even when the original scrape missed.
    snipe_recompute = None
    try:
        from scraper import recompute_snipe_eligibility
        snipe_recompute = recompute_snipe_eligibility(db)
    except Exception as _re:
        import logging as _log
        _log.getLogger("sniper").warning(f"snipe recompute failed: {_re}")

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
        "sold_ingest": sold_result,
        "sold_ingest_finding_api": finding_result,
        "sold_ingest_error": sold_error,
        "scraper_errors": scraper_errors,
        "snipe_alerts_created": snipe_alerts_created,
        "snipe_alert_error": snipe_alert_error,
        "push_sent": push_sent,
        "strong_buy_alerts_created": strong_buy_created,
        "wishlist_match_alerts_created": wishlist_match_created,
        "auto_watchlisted": auto_watchlisted,
        "rules_auto_watched": rules_auto_watched,
        "snipe_recompute": snipe_recompute,
    }


@app.get("/api/cron/sold-ingest")
async def cron_sold_ingest(_auth: None = Depends(require_cron_or_admin)):
    """Sold-card ingest — split out of /api/cron/sync (see comment there).

    Previously dispatched via asyncio.create_task() (fire-and-forget) from
    inside cron_sync, which Vercel serverless kills mid-flight the instant
    the HTTP response returns — so this silently ran ~never and sold_cards
    went 7+ weeks stale. Awaiting it properly inside cron_sync worked
    functionally but pushed that already-loaded route past its time budget
    (measured live: ~35-40s per eBay-dependent unit of work right now).
    Own cron schedule = own time budget, no competition with browse_sync/
    price_history/free-scrapers.

    Each ingest fn is called with its own db session (db=None) and wrapped
    in wait_for so a slow tick degrades to 'try again next tick' instead of
    an unbounded hang — batch sizes in sold_ingest.py are tuned so the
    common case finishes well inside these deadlines.
    """
    sold_result = None
    finding_result = None
    sold_error = None
    logger.info("cron_sold_ingest: stage=all_drivers start")
    try:
        from sold_ingest import ingest_all_drivers
        sold_result = await asyncio.wait_for(ingest_all_drivers(None), timeout=60)
    except asyncio.TimeoutError:
        sold_error = "ingest_all_drivers timed out (60s) — will retry next tick"
    except Exception as e:
        sold_error = str(e)[:200]
    logger.info(f"cron_sold_ingest: stage=all_drivers done result={sold_result} error={sold_error}")
    try:
        from sold_ingest import ingest_finding_api_all
        finding_result = await asyncio.wait_for(ingest_finding_api_all(None), timeout=60)
    except asyncio.TimeoutError:
        sold_error = (sold_error + " | " if sold_error else "") + "ingest_finding_api_all timed out (60s) — will retry next tick"
    except Exception as e:
        sold_error = (sold_error + " | " if sold_error else "") + str(e)[:200]
    logger.info(f"cron_sold_ingest: stage=finding_api done result={finding_result} error={sold_error}")
    return {
        "ok": sold_error is None,
        "sold_ingest": sold_result,
        "sold_ingest_finding_api": finding_result,
        "sold_ingest_error": sold_error,
    }


# ---------------------------------------------------------------------------
# Imminent-window cron: fills the "blind window" between full hourly syncs.
# Background: /api/cron/sync now runs every 2h. Auctions that are listed AND
# end within those 2h would never appear in our DB. This cron pulls only
# auctions ending in the next 90 minutes, every 15 min, so the gap closes.
# ---------------------------------------------------------------------------

async def _do_imminent_sync(db: Session, window_min: int = 90) -> dict:
    """Shared implementation for both the cron and the user-triggered refresh.
    Pulls 2025 F1 auctions ending in the next `window_min` minutes (server-side
    filtered via itemEndDate), then upserts via scraper._upsert_listings.

    Coverage strategy (May 2026 fix — Eddie's "missing ending-soon" report):
    Loops EVERY query in SEARCH_QUERIES (not just the long-form one) and
    paginates each up to 5 pages × 200 = 1000 items. Pagination breaks early
    on partial / empty pages so realistic API spend stays low — typical fire
    hits ~2-3 calls (one page per query, both empty after the first batch).
    Worst case: len(SEARCH_QUERIES) × 5 = 10 calls/fire × 96 fires/day = 960
    calls/day, but the early-break + 90-min window keeps real spend ~150-300.

    Returns {fetched, added, updated, ending_in_30m, api_calls}."""
    from ebay_api import (
        search_f1_cards,
        parse_ebay_item,
        _is_valid_2025_f1_listing,
        _is_rate_limited,
        SEARCH_QUERIES,
    )
    from scraper import _upsert_listings, recompute_snipe_eligibility
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz

    now = _dt.now(_tz.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_iso = (now + _td(minutes=window_min)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    time_filter = f"itemEndDate:[{now_iso}..{end_iso}]"

    all_items: list = []
    seen_ids: set = set()
    api_calls = 0
    MAX_PAGES_PER_QUERY = 5  # 5 × 200 = 1000 items per query (eBay caps at 200/page)

    for query in SEARCH_QUERIES:
        if _is_rate_limited():
            import logging as _log
            _log.getLogger("imminent").warning(
                f"rate-limit cooldown active — aborting at query '{query}'"
            )
            break
        for page in range(MAX_PAGES_PER_QUERY):
            try:
                items = await search_f1_cards(
                    query=query,
                    limit=200,
                    sort="endingSoonest",
                    buying_options_filter="buyingOptions:{AUCTION}",
                    offset=page * 200,
                    extra_filter=time_filter,
                )
                api_calls += 1
            except Exception:
                break
            if not items:
                break
            for it in items:
                iid = it.get("itemId", "")
                title = it.get("title", "")
                if iid and iid not in seen_ids and _is_valid_2025_f1_listing(title):
                    seen_ids.add(iid)
                    all_items.append(parse_ebay_item(it))
            if len(items) < 200:
                break  # last page for this query

    added, updated = _upsert_listings(db, all_items)
    db.commit()

    # Recompute snipe flags so anything just inserted with a fresh price gets
    # surfaced on the dashboard immediately (rather than waiting for the next
    # full /api/cron/sync).
    try:
        recompute_snipe_eligibility(db)
    except Exception as _re:
        import logging as _log
        _log.getLogger("imminent").warning(f"snipe recompute failed: {_re}")

    # Count rows ending in next 30 min so caller can confirm we plugged the gap
    from datetime import datetime as _dtnow
    thirty_cutoff = _dtnow.utcnow() + _td(minutes=30)
    ending_in_30m = (
        db.query(Auction)
        .filter(Auction.status == "active", Auction.end_time != None, Auction.end_time <= thirty_cutoff)
        .count()
    )

    return {
        "fetched": len(all_items),
        "added": added,
        "updated": updated,
        "ending_in_30m": ending_in_30m,
        "window_min": window_min,
        "api_calls": api_calls,
        "queries_used": len(SEARCH_QUERIES),
    }


@app.get("/api/cron/sync-imminent")
async def cron_sync_imminent(db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
    """Tight loop: pull only auctions ending in next 90 minutes.
    Runs every 15 min via Vercel cron. Solves the blind window between full
    2-hourly syncs where newly-listed short-duration auctions would otherwise
    never reach our DB before they end."""
    if not has_real_credentials():
        return {"ok": False, "reason": "no_credentials"}
    try:
        result = await _do_imminent_sync(db, window_min=90)
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/sniper/refresh-imminent")
async def refresh_imminent_user(request: Request, db: Session = Depends(get_db)):
    """User-triggered refresh — same logic as cron_sync_imminent but
    rate-limited to 1 call per 60s per client IP."""
    import time as _time
    # Trusted client IP (x-real-ip / rightmost XFF) — request.client.host is
    # the proxy behind Vercel, which would rate-limit all users as one.
    ip = _client_ip(request)
    now_t = _time.time()
    last = _refresh_imminent_rate.get(ip, 0)
    if now_t - last < 60:
        return {
            "ok": False,
            "error": "rate_limited",
            "retry_after": int(60 - (now_t - last)),
        }
    _refresh_imminent_rate[ip] = now_t
    if not has_real_credentials():
        return {"ok": False, "reason": "no_credentials"}
    try:
        result = await _do_imminent_sync(db, window_min=90)
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.get("/api/cron/refresh-bids")
async def cron_refresh_bids(db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
    """Refresh bid_count + current_price on the top 100 auctions ending soonest.
    Most rows show bids=0 because Browse search doesn't include live bid counts
    reliably; the per-item /buy/browse/v1/item/{id} endpoint does. Runs every
    5 min so the dashboard's bid columns stay fresh on the most actionable
    auctions — fixes "Updated 4h ago" complaint for live sniping. (Bug 3 from
    user audit.) 100 rows × ~0.3s eBay item-detail call ≈ 30s/run, well under
    Vercel's 60s function timeout."""
    from database import Auction as _Auction
    from ebay_api import get_item_details
    from datetime import datetime as _dt

    if not has_real_credentials():
        return {"ok": False, "reason": "no_credentials"}

    now = _dt.utcnow()
    # AUCTION-only filter — BIN listings have no bid count, so refreshing
    # them wastes API calls and never updates anything. The previous
    # version selected ALL active rows, and when the top-50 ending-soonest
    # were dominated by BINs (the now-fixed display bug), this cron did
    # ~50 wasted eBay calls per run.
    rows = (
        db.query(_Auction)
        .filter(
            _Auction.status == "active",
            _Auction.end_time > now,
            _Auction.buying_options.like('%AUCTION%'),
        )
        .order_by(_Auction.end_time.asc())
        .limit(100)
        .all()
    )

    updated = 0
    for a in rows:
        iid = a.ebay_listing_id  # eBay item id; usually "v1|123456|0" format
        try:
            # Extract numeric portion. Some rows may already be numeric.
            parts = (iid or "").split("|")
            if len(parts) >= 2:
                numeric = parts[1]
            else:
                numeric = iid or ""
            if not numeric:
                continue
            details = await get_item_details(numeric)
            if not details:
                continue
            row_changed = False
            # Coalesce None — eBay returns "bidCount": null on BIN-format items
            # that slip through the AUCTION filter. Don't overwrite with None,
            # which would wipe legitimate counts.
            raw_bids = details.get("bidCount")
            if raw_bids is None:
                raw_bids = details.get("bid_count")
            new_bids = raw_bids if raw_bids is not None else (a.bid_count or 0)
            if raw_bids is not None and new_bids != (a.bid_count or 0):
                a.bid_count = new_bids
                row_changed = True
            cbp = details.get("currentBidPrice", {}) or {}
            cbp_val = float(cbp.get("value", 0)) if cbp else 0.0
            if not cbp_val:
                cbp_val = float(details.get("current_price", 0) or 0)
            if cbp_val and cbp_val != (a.current_price or 0):
                a.current_price = cbp_val
                row_changed = True
            a.last_updated = now
            if row_changed:
                updated += 1
        except Exception:
            continue
    db.commit()
    return {"ok": True, "checked": len(rows), "updated": updated}


@app.api_route("/api/ebay/refresh-top-page", methods=["GET", "POST"])
async def ebay_refresh_top_page(request: Request, db: Session = Depends(get_db)):
    """
    Fast hourly refresh of the top 50 ending-soonest active auctions.
    Keeps the first page of live auctions always fresh (< 1 hour old).
    """
    require_cron_or_admin(request)

    try:
        from ebay_api import get_item_details as _get_item_details
        # Refresh top 50 ending-soonest (regardless of time until end)
        top_auctions = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.ebay_listing_id.isnot(None),
            Auction.end_time.isnot(None),
            Auction.end_time > datetime.utcnow(),
        ).order_by(Auction.end_time.asc()).limit(50).all()

        updated = 0
        ended = 0
        for _a in top_auctions:
            try:
                _item = await _get_item_details(_a.ebay_listing_id)
                if _item is None:
                    # Phantom-active row — eBay says listing is closed.
                    # Mark ended so the next iteration of this cron picks up
                    # an actually-live auction instead of re-checking the corpse.
                    _a.status = "ended"
                    _a.last_updated = datetime.utcnow()
                    ended += 1
                    continue
                _a.current_price = _item.get("current_price", _a.current_price)
                _a.bid_count = _item.get("bid_count", _a.bid_count)
                # Always write fresh end_time so secsLeft() stays accurate
                _fresh_end = _item.get("end_time")
                if _fresh_end:
                    from datetime import timezone as _tz
                    if hasattr(_fresh_end, "tzinfo") and _fresh_end.tzinfo:
                        _fresh_end = _fresh_end.astimezone(_tz.utc).replace(tzinfo=None)
                    _a.end_time = _fresh_end
                _a.last_updated = datetime.utcnow()
                updated += 1
            except Exception as _e:
                # Per-auction failure — keep refreshing the rest, but log so
                # repeated failures (eBay rate-limit, schema drift) are visible.
                logger.warning(f"refresh-bids item {_a.id}: {_e}")
        db.commit()
        return {"ok": True, "updated": updated, "ended": ended, "message": f"Refreshed {updated} top auctions, marked {ended} ended"}
    except Exception as e:
        db.rollback()
        logger.error(f"Top-page refresh failed: {e}")
        return {"ok": False, "error": str(e)[:300]}


@app.api_route("/api/cron/keepalive", methods=["GET", "POST"])
async def cron_keepalive(request: Request):
    """
    Pre-warm the slow endpoints so users never hit a cold function.
    Runs every few minutes via Vercel cron. Hits the heavy queries
    inside their CDN cache window so the next user request is served
    from cache instantly (~150ms) instead of cold (~15s).
    """
    import httpx as _httpx
    require_cron_or_admin(request)

    base = "https://f1cardvault.com"
    # Warming trimmed 2026-07-07 after the Neon data-transfer quota was exceeded.
    # Root cause: this warmed 8 endpoints — including two limit=500 full-payload
    # queries + sales?limit=500 — every 4 min, ~360 heavy fetches/day moving GBs
    # of rows whether or not anyone was on the site. The CDN cache is only
    # s-maxage=60 while this ran every 240s, so the big fetches expired long
    # before each warm and barely prevented cold-starts. Now: only the small,
    # cheap endpoints + the mobile-sized limit=100 dashboard (first paint). The
    # heavy limit=500 desktop pages cold-start on first visit (~3.8s, rare) —
    # an acceptable trade to stop blowing the DB transfer budget. Schedule also
    # relaxed to */15 in vercel.json.
    targets = [
        # Mobile dashboard first paint (limit=100 = ~5x smaller payload than 500).
        "/api/auctions/with-verdicts?limit=100",
        "/api/auctions/with-verdicts?buying=auction&limit=100",
        # Small/cheap endpoints — negligible transfer, real cold-start wins:
        "/api/sniper/fresh-snipes/6",                             # Dashboard snipes strip
        "/api/auctions/snipe/targets",                            # Snipes-strip fallback (5s race loser)
        "/api/sales/stats",                                       # Pre-aggregated summary (Total Sales tile)
        # Sales feed — ticker + 7d Sales + big wins tiles. Was dropped in
        # the 2026-07 Neon-quota trim; back now that Launch has 500 GB —
        # without it the sales tiles cold-started on every first visit.
        "/api/sales?limit=500&year=2025",
        "/api/health",                                            # Cheap baseline ping
    ]
    results = []
    async with _httpx.AsyncClient(timeout=20.0) as client:
        for path in targets:
            try:
                r = await client.get(f"{base}{path}", headers={"User-Agent": "vercel-cron-keepalive/1.0"})
                results.append({"path": path, "status": r.status_code, "ms": int(r.elapsed.total_seconds() * 1000)})
            except Exception as e:
                results.append({"path": path, "error": str(e)[:120]})
    return {"ok": True, "warmed": len(results), "results": results}


@app.api_route("/api/audit/auto-fix", methods=["GET", "POST"])
async def audit_auto_fix(request: Request, db: Session = Depends(get_db)):
    """
    Daily auto-audit-AND-fix routine. Runs unattended at 06:00 UTC.

    What it does (every day):
      1. Refresh the most-stale-but-still-active auctions via Browse API
         (rolls last_updated forward, marks ended phantoms)
      2. Trigger the regular ingest sync to add fresh listings
      3. Snapshot health metrics (sample size, freshness, stale-premium)
      4. Compare snapshot to previous run; if anything degraded, escalate
         the report severity in the inbox so Eddie sees it
      5. Persist the report into user_feedback so /admin/feedback shows it

    Auth: Vercel cron (Authorization: Bearer CRON_SECRET) or X-Admin-Token header.
    """
    from datetime import timedelta
    require_cron_or_admin(request)

    now = datetime.utcnow()
    actions: list[str] = []
    errors: list[str] = []

    # 1. Refresh stale auctions — TWO passes, prioritize $50+ first.
    try:
        from ebay_api import get_item_details as _get_item_details
        from sqlalchemy import or_
        cutoff = now - timedelta(hours=2)

        async def _refresh_batch(query, label):
            r, e = 0, 0
            for a in query.all():
                try:
                    item = await _get_item_details(a.ebay_listing_id)
                    if item is None:
                        a.status = "ended"
                        a.last_updated = now
                        e += 1
                        continue
                    a.current_price = item.get("current_price", a.current_price)
                    a.bid_count = item.get("bid_count", a.bid_count)
                    a.last_updated = now
                    r += 1
                except Exception as _exc:
                    # Per-auction failure — log so eBay rate-limits / schema drift surface.
                    logger.warning(f"keepalive {label} item {a.id}: {_exc}")
            return r, e

        # Pass A: stale PREMIUM ($50+) — these matter most
        prem_q = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.ebay_listing_id.isnot(None),
            Auction.end_time.isnot(None),
            Auction.end_time > now,
            Auction.last_updated < cutoff,
            Auction.current_price >= 50.0,
        ).order_by(Auction.last_updated.asc()).limit(40)
        pa_ref, pa_end = await _refresh_batch(prem_q, "premium")

        # Pass B: stale anything else (catches the long-tail cheap cards)
        any_q = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.ebay_listing_id.isnot(None),
            Auction.end_time.isnot(None),
            Auction.end_time > now,
            Auction.last_updated < cutoff,
        ).order_by(Auction.last_updated.asc()).limit(40)
        pb_ref, pb_end = await _refresh_batch(any_q, "any")

        db.commit()
        actions.append(f"Refreshed premium={pa_ref} (ended {pa_end}), other={pb_ref} (ended {pb_end})")
    except Exception as e:
        errors.append(f"refresh_stale: {str(e)[:120]}")

    # 2. Trigger ingest sync (Browse API search → adds new + updates existing)
    try:
        from scraper import sync_real_ebay_listings
        added = await sync_real_ebay_listings(db)
        actions.append(f"Sync added {added} new listings")
    except Exception as e:
        errors.append(f"sync: {str(e)[:120]}")

    # 3. Health snapshot
    rows = db.query(Auction).filter(
        Auction.status == "active",
        Auction.is_real_ebay == True,
        Auction.end_time.isnot(None),
        Auction.end_time > now,
    ).limit(500).all()
    fresh_30m = sum(1 for a in rows if a.last_updated and (now - a.last_updated).total_seconds() < 1800)
    fresh_2h = sum(1 for a in rows if a.last_updated and 1800 <= (now - a.last_updated).total_seconds() < 7200)
    stale_24h = sum(1 for a in rows if a.last_updated and (now - a.last_updated).total_seconds() >= 86400)
    stale_premium = sum(
        1 for a in rows
        if a.last_updated
        and (now - a.last_updated).total_seconds() >= 7200
        and (a.current_price or 0) >= 50
    )
    auc_count = sum(1 for a in rows if a.buying_options and "AUCTION" in a.buying_options)
    bin_count = sum(1 for a in rows if a.buying_options and ("FIXED_PRICE" in a.buying_options or "BEST_OFFER" in a.buying_options))

    # 4. Severity heuristic — flag if site is in trouble
    severity = "OK"
    if auc_count == 0 and bin_count == 0:
        severity = "CRITICAL: zero active listings"
    elif stale_premium > 10:
        severity = f"WARN: {stale_premium} stale-premium rows"
    elif stale_24h > len(rows) * 0.7:
        severity = f"WARN: {stale_24h}/{len(rows)} >24h stale"

    # 5. Build & persist report
    lines = [
        f"AUTO-FIX DAILY ({now.date().isoformat()})",
        f"Severity: {severity}",
        "",
        "Actions taken:",
        *[f"  - {a}" for a in actions],
    ]
    if errors:
        lines.append("Errors:")
        lines.extend(f"  ! {e}" for e in errors)
    lines.append("")
    lines.append(f"Snapshot ({len(rows)} active, {auc_count} AUCTION + {bin_count} BIN):")
    lines.append(f"  fresh <30m={fresh_30m}  <2h={fresh_2h}  >=24h={stale_24h}")
    lines.append(f"  stale_premium($50+, >2h)={stale_premium}")
    msg = "\n".join(lines)[:1950]

    try:
        from database import UserFeedback
        db.add(UserFeedback(message=msg, page_url="/auto-fix-daily", created_at=now))
        db.commit()
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:300], "report": msg}

    return {
        "ok": True,
        "severity": severity,
        "actions": actions,
        "errors": errors,
        "snapshot": {
            "active_total": len(rows),
            "auction_type": auc_count,
            "bin_type": bin_count,
            "fresh_30m": fresh_30m,
            "fresh_2h": fresh_2h,
            "stale_24h": stale_24h,
            "stale_premium": stale_premium,
        },
    }


@app.api_route("/api/audit/morning-check", methods=["GET", "POST"])
async def audit_morning_check(request: Request, db: Session = Depends(get_db)):
    """
    Daily morning check. Fires after the eBay quota resets at 07:05 UTC.
    Posts a combined report into the feedback inbox so Eddie sees it as
    soon as he opens the admin panel.

    Three sections:
      1. INGEST: triggers a fresh sync, reports added/updated/fetched
      2. FRESHNESS: snapshot of audit metrics (top-300 active auctions)
      3. OVERNIGHT: last-24h feedback submissions count (excluding our
         own auto-audit posts)

    Auth: Vercel cron (Authorization: Bearer CRON_SECRET) or X-Admin-Token header.
    """
    from datetime import timedelta
    require_cron_or_admin(request)

    now = datetime.utcnow()
    lines = [f"MORNING DIGEST ({now.strftime('%Y-%m-%d %H:%M')}Z)", ""]

    # 1. Ingest health — run a fresh sync and report stats
    lines.append("INGEST")
    try:
        from scraper import sync_real_ebay_listings
        import ebay_api as _ea
        _ea._cooldown_loaded_at = None  # force fresh DB read
        _ea._last_browse_error = None
        stats = await sync_real_ebay_listings(db, return_full_stats=True)
        rl = _ea._is_rate_limited()
        cd = _ea._rate_limited_until.isoformat()[:16] if _ea._rate_limited_until else None
        lines.append(f"  fetched={stats.get('fetched', 0)} added={stats.get('added', 0)} updated={stats.get('updated', 0)}")
        if rl:
            lines.append(f"  WARN: rate-limited until {cd}")
        if _ea._last_browse_error:
            lines.append(f"  ERR: {_ea._last_browse_error[:120]}")
    except Exception as e:
        lines.append(f"  FAILED: {str(e)[:120]}")

    # 2. Freshness snapshot
    lines.append("")
    lines.append("FRESHNESS (top 300 active)")
    try:
        rows = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.end_time.isnot(None),
            Auction.end_time > now,
        ).order_by(Auction.end_time.asc()).limit(300).all()
        fresh_30m = sum(1 for a in rows if a.last_updated and (now - a.last_updated).total_seconds() < 1800)
        fresh_2h = sum(1 for a in rows if a.last_updated and 1800 <= (now - a.last_updated).total_seconds() < 7200)
        stale_24h_plus = sum(1 for a in rows if a.last_updated and (now - a.last_updated).total_seconds() >= 86400)
        stale_premium = sum(1 for a in rows
                            if a.last_updated
                            and (now - a.last_updated).total_seconds() >= 7200
                            and (a.current_price or 0) >= 50)
        n = len(rows)
        lines.append(f"  sample={n}  <30m={fresh_30m}  <2h={fresh_2h}  >=24h={stale_24h_plus}")
        lines.append(f"  stale_premium($50+, >2h)={stale_premium}")
    except Exception as e:
        lines.append(f"  FAILED: {str(e)[:120]}")

    # 3. Overnight feedback (last 24h, excluding our own auto-posts)
    lines.append("")
    lines.append("OVERNIGHT FEEDBACK (24h)")
    try:
        from database import UserFeedback
        cutoff = now - timedelta(hours=24)
        recent = db.query(UserFeedback).filter(
            UserFeedback.created_at >= cutoff,
            UserFeedback.resolved == False,  # noqa: E712
        ).order_by(UserFeedback.created_at.desc()).all()
        # Exclude our own audit posts so the digest doesn't echo itself
        user_subs = [r for r in recent if not (r.message or "").startswith(("AUTO-AUDIT", "MORNING DIGEST"))]
        lines.append(f"  total_unresolved_24h={len(recent)}  user_submissions={len(user_subs)}")
        for s in user_subs[:5]:
            preview = (s.message or "").replace("\n", " ")[:100]
            ago_min = int((now - s.created_at).total_seconds() / 60)
            lines.append(f"  #{s.id} ({ago_min}m ago) {preview}")
        if len(user_subs) > 5:
            lines.append(f"  ...{len(user_subs) - 5} more")
    except Exception as e:
        lines.append(f"  FAILED: {str(e)[:120]}")

    msg = "\n".join(lines)[:1950]

    # Persist as a UserFeedback row tagged with /morning-digest page_url
    try:
        from database import UserFeedback
        db.add(UserFeedback(message=msg, page_url="/morning-digest", created_at=now))
        db.commit()
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:300], "report": msg}

    return {"ok": True, "report_preview": msg[:500]}


@app.api_route("/api/audit/stale-prices", methods=["GET", "POST"])
def audit_stale_prices(request: Request, db: Session = Depends(get_db)):
    """
    Server-side daily 7am audit. Replaces the session-only CronCreate version.
    Walks active auctions, breaks down freshness, flags stale-premium ($50+,
    >2h since refresh), posts a tight digest into the feedback inbox so Eddie
    sees it next time he opens the inbox. Auth: CRON_SECRET bearer or X-Admin-Token.

    Also checks sold_cards write-freshness (same signal /api/health/data-freshness
    exposes) and prepends a WARNING line when it's degraded/stale/unknown. This is
    the exact metric that stayed silently green for 7 weeks during the dead-DB
    outage — nothing was watching it, so nobody noticed until the Sales page was
    checked by hand. Now it rides the same daily digest as the price-staleness
    audit instead of needing a separate alert channel.
    """
    from datetime import timedelta
    require_cron_or_admin(request)

    now = datetime.utcnow()
    rows = db.query(Auction).filter(
        Auction.status == "active",
        Auction.is_real_ebay == True,
        Auction.end_time.isnot(None),
        Auction.end_time > now,
    ).order_by(Auction.end_time.asc()).limit(300).all()

    fresh = {"<30m": 0, "<2h": 0, "<6h": 0, "<24h": 0, ">=24h": 0, "unknown": 0}
    stale_premium: list[dict] = []
    for a in rows:
        lu = a.last_updated
        price = float(a.current_price or 0)
        if not lu:
            fresh["unknown"] += 1
            continue
        age_h = (now - lu).total_seconds() / 3600.0
        if age_h < 0.5: fresh["<30m"] += 1
        elif age_h < 2: fresh["<2h"] += 1
        elif age_h < 6: fresh["<6h"] += 1
        elif age_h < 24: fresh["<24h"] += 1
        else: fresh[">=24h"] += 1
        if age_h > 2 and price >= 50:
            stale_premium.append({
                "age_h": round(age_h, 1),
                "price": round(price),
                "title": (a.title or "")[:55],
            })
    stale_premium.sort(key=lambda r: -r["age_h"])

    n = len(rows)
    pct_24h = (fresh[">=24h"] * 100 // n) if n else 0

    # Sold-data freshness check — the metric that hid a 7-week outage because
    # nothing was watching it. See /api/health/data-freshness for the same logic.
    from database import SoldCard
    from sqlalchemy import func as _func
    sold_warning = None
    try:
        newest_scrape = db.query(_func.max(SoldCard.scraped_at)).scalar()
        sold_age_h = (now - newest_scrape).total_seconds() / 3600 if newest_scrape else None
        if sold_age_h is None:
            sold_warning = "WARNING: sold_cards has no scraped_at rows at all (unknown/never written)."
        elif sold_age_h > 48:
            sold_warning = f"WARNING: sold_cards data is STALE — newest write is {sold_age_h:.1f}h old (>48h). Check GH Actions DATABASE_URL and scrape.yml runs."
        elif sold_age_h > 12:
            sold_warning = f"NOTE: sold_cards data is degraded — newest write is {sold_age_h:.1f}h old (>12h)."
    except Exception as e:
        sold_warning = f"WARNING: sold_cards freshness check failed: {str(e)[:120]}"

    lines = [
        f"AUTO-AUDIT 7AM ({now.date().isoformat()})",
    ]
    if sold_warning:
        lines += [sold_warning, ""]
    lines += [
        f"Sample: {n} active auctions",
        f"Freshness: <30m={fresh['<30m']} <2h={fresh['<2h']} <6h={fresh['<6h']} <24h={fresh['<24h']} >=24h={fresh['>=24h']}",
        f"Stale (>=24h): {pct_24h}%",
        "",
        f"Stale premium ($50+, >2h): {len(stale_premium)}",
    ]
    for r in stale_premium[:10]:
        lines.append(f"  {r['age_h']:>5.1f}h | ${r['price']} | {r['title']}")
    msg = "\n".join(lines)[:2000]

    # Persist to feedback inbox so Eddie sees it next time he reviews.
    try:
        from database import UserFeedback
        db.add(UserFeedback(message=msg, page_url="/auto-audit-7am", created_at=now))
        db.commit()
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:300], "report": msg}

    return {
        "ok": True,
        "sample_size": n,
        "freshness": fresh,
        "stale_premium_count": len(stale_premium),
        "sold_data_warning": sold_warning,
        "report_preview": msg[:500],
    }


@app.api_route("/api/admin/backfill-sellers", methods=["GET", "POST"])
async def backfill_sellers(request: Request, db: Session = Depends(get_db)):
    """
    One-shot batch: refresh seller name + feedback for active auctions where
    seller is empty or the 'ebay_seller' placeholder. Hit repeatedly until
    `remaining` returns 0. Same auth pattern as refresh endpoints.
    """
    require_cron_or_admin(request)

    from sqlalchemy import or_
    from ebay_api import get_item_details as _get_item_details

    rows = db.query(Auction).filter(
        Auction.status == "active",
        Auction.is_real_ebay == True,
        Auction.ebay_listing_id.isnot(None),
        or_(
            Auction.seller.is_(None),
            Auction.seller == "",
            Auction.seller == "ebay_seller",
            Auction.seller == "unknown",
            Auction.seller == "unknown_seller",
        ),
    ).order_by(Auction.end_time.asc()).limit(80).all()

    fixed = 0
    ended = 0
    errors = 0
    for a in rows:
        try:
            item = await _get_item_details(a.ebay_listing_id)
            if item is None:
                a.status = "ended"
                a.last_updated = datetime.utcnow()
                ended += 1
                continue
            seller = (item.get("seller") or "").strip()
            if seller and seller.lower() not in ("ebay_seller", "unknown", "unknown_seller"):
                a.seller = seller
                fb = item.get("seller_feedback_score")
                if isinstance(fb, int) and fb > 0:
                    a.seller_feedback = fb
                a.last_updated = datetime.utcnow()
                fixed += 1
        except Exception as e:
            errors += 1
            logger.warning(f"backfill-sellers item {a.id}: {e}")
    db.commit()

    # Estimate remaining
    remaining = db.query(Auction).filter(
        Auction.status == "active",
        Auction.is_real_ebay == True,
        or_(
            Auction.seller.is_(None),
            Auction.seller == "",
            Auction.seller == "ebay_seller",
        ),
    ).count()

    return {
        "ok": True,
        "candidates_this_run": len(rows),
        "fixed": fixed,
        "ended": ended,
        "errors": errors,
        "remaining": remaining,
        "message": f"Hit again — {remaining} rows still missing seller info" if remaining > 0 else "All done.",
    }


@app.api_route("/api/ebay/refresh-stale-premium", methods=["GET", "POST"])
async def ebay_refresh_stale_premium(request: Request, db: Session = Depends(get_db)):
    """
    Tail refresher — catches premium auctions that fall outside the top-200
    ending-soonest window the hourly cron covers. The 7am audit found 14
    auctions >= $50 that hadn't been refreshed in 2-153 hours (the $56 vs $810
    bug class). This endpoint targets exactly that gap.

    Selects active auctions with current_price >= $50 AND last_updated > 2h ago
    AND end_time still in the future. Limits to 80 per run (~half of typical
    Browse API quota headroom). Marks status='ended' if eBay reports the
    listing closed.
    """
    require_cron_or_admin(request)

    try:
        from ebay_api import get_item_details as _get_item_details
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(hours=2)
        # Order by last_updated ASC so the MOST stale rows refresh first —
        # the rows the user complains about land at the top of the queue.
        stale = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.ebay_listing_id.isnot(None),
            Auction.end_time.isnot(None),
            Auction.end_time > datetime.utcnow(),
            Auction.current_price >= 50.0,
            Auction.last_updated < cutoff,
        ).order_by(Auction.last_updated.asc()).limit(80).all()

        updated = 0
        ended = 0
        errors = 0
        for _a in stale:
            try:
                _item = await _get_item_details(_a.ebay_listing_id)
                if _item is None:
                    # eBay returned 404 / closed — mark as ended so it stops
                    # appearing on the dashboard.
                    _a.status = "ended"
                    _a.last_updated = datetime.utcnow()
                    ended += 1
                    continue
                _a.current_price = _item.get("current_price", _a.current_price)
                _a.bid_count = _item.get("bid_count", _a.bid_count)
                _a.buying_options = json.dumps(_item.get("buying_options", []))
                fresh_seller = (_item.get("seller") or "").strip()
                if fresh_seller and fresh_seller.lower() not in ("ebay_seller", "unknown", "unknown_seller"):
                    _a.seller = fresh_seller
                fresh_fb = _item.get("seller_feedback_score")
                if isinstance(fresh_fb, int) and fresh_fb > 0:
                    _a.seller_feedback = fresh_fb
                _a.last_updated = datetime.utcnow()
                updated += 1
            except Exception as e:
                errors += 1
                logger.warning(f"refresh-stale-premium item {_a.id}: {e}")
        db.commit()
        return {
            "ok": True,
            "candidates": len(stale),
            "updated": updated,
            "ended": ended,
            "errors": errors,
            "message": f"Refreshed {updated} stale premium auctions, marked {ended} ended",
        }
    except Exception as e:
        db.rollback()
        logger.error(f"refresh-stale-premium failed: {e}")
        return {"ok": False, "error": str(e)[:300]}


@app.api_route("/api/admin/finding-active-ingest", methods=["GET", "POST"])
async def finding_active_ingest(request: Request, db: Session = Depends(get_db)):
    """
    Synchronous Finding API ingest for ACTIVE listings — bypasses the Browse
    API daily quota by using the legacy findItemsAdvanced endpoint
    (separate quota, less prone to exhaustion).

    Runs a small driver x parallel matrix inline so Vercel's 10s function
    timeout doesn't kill it. Hit repeatedly to expand coverage.

    Auth: Vercel cron (Authorization: Bearer CRON_SECRET) or X-Admin-Token header.
    """
    require_cron_or_admin(request)

    try:
        from ebay_finding_api import fetch_active_for_query
        from sold_ingest import _upsert_active_item
    except Exception as e:
        return {"ok": False, "error": f"import failed: {e}"}

    queries = request.query_params.get("queries")
    if queries:
        query_list = [q.strip() for q in queries.split(",") if q.strip()]
    else:
        # Default: top 4 drivers each with the broadest 2025 search.
        # Each query returns up to 100 listings of any buying type.
        query_list = [
            "2025 Topps Chrome F1 Verstappen",
            "2025 Topps Chrome F1 Hamilton",
            "2025 Topps Chrome F1 Norris",
            "2025 Topps Chrome F1 Leclerc",
            "2025 Topps Chrome Formula 1 auto",
            "2025 Topps Chrome F1 refractor",
        ]

    added = 0
    updated = 0
    errors: list[str] = []
    for q in query_list:
        try:
            items = await fetch_active_for_query(q, pages=1)
            for item in items:
                r = await _upsert_active_item(item, db)
                if r == "added":
                    added += 1
                elif r == "updated":
                    updated += 1
        except Exception as e:
            errors.append(f"{q}: {str(e)[:120]}")
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": f"commit: {str(e)[:200]}"}

    return {
        "ok": True,
        "queries_run": len(query_list),
        "added": added,
        "updated": updated,
        "errors": errors[:5],
    }


@app.api_route("/api/admin/debug-sync", methods=["GET", "POST"])
async def debug_sync(request: Request, db: Session = Depends(get_db)):
    """Run sync_real_ebay_listings with full instrumentation. Same auth pattern."""
    require_cron_or_admin(request)
    try:
        from scraper import sync_real_ebay_listings
        import ebay_api as _ea
        # Force-clear cache so we read DB cooldown state fresh
        _ea._cooldown_loaded_at = None
        _ea._last_browse_error = None
        stats = await sync_real_ebay_listings(db, return_full_stats=True)
        return {
            "ok": True,
            **stats,
            "rate_limited_now": _ea._is_rate_limited(),
            "cooldown_until": _ea._rate_limited_until.isoformat() if _ea._rate_limited_until else None,
            "last_browse_error": _ea._last_browse_error,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@app.api_route("/api/admin/clear-ebay-cooldown", methods=["GET", "POST"])
def clear_ebay_cooldown(request: Request):
    """
    Manually clear the eBay rate-limit cooldown. The Browse API auto-locks for
    24h on a 429, which can lock the whole ingest pipeline for a full day.
    Use sparingly — the cooldown exists for a reason. Auth: CRON_SECRET
    bearer or X-Admin-Token header.
    """
    require_cron_or_admin(request)
    try:
        from database import SessionLocal, SystemState
        import ebay_api as _ea
        db = SessionLocal()
        row = db.query(SystemState).filter(SystemState.key == "ebay_rate_limited_until").first()
        had_cooldown = bool(row and row.value)
        prev = row.value if row else None
        if row:
            db.delete(row)
            db.commit()
        # Also clear in-process cache so the running instance picks it up.
        _ea._rate_limited_until = None
        _ea._cooldown_loaded_at = datetime.utcnow()
        db.close()
        return {"ok": True, "had_cooldown": had_cooldown, "previous_value": prev,
                "message": "Cooldown cleared. eBay calls will resume on next request."}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


@app.api_route("/api/admin/migrate-feedback", methods=["GET", "POST"])
def migrate_feedback_table(request: Request):
    """Create user_feedback table on Postgres if missing.

    Base.metadata.create_all() should handle this on cold start, but Vercel
    serverless instances don't reliably re-init across deploys, so this is
    the manual escape hatch.

    Auth: CRON_SECRET bearer or X-Admin-Token header. The operation is
    idempotent (CREATE TABLE IF NOT EXISTS).
    """
    require_cron_or_admin(request)
    from sqlalchemy import text
    try:
        from database import engine as _engine
        # Pure idempotent DDL — skips Base.metadata.create_all because that
        # tries to recreate ALL tables and trips on pre-existing indexes
        # elsewhere (e.g. ix_click_events_clicked_at).
        results = []
        statements = [
            ("user_feedback table", """
                CREATE TABLE IF NOT EXISTS user_feedback (
                    id SERIAL PRIMARY KEY,
                    message TEXT NOT NULL,
                    page_url VARCHAR(500),
                    user_agent VARCHAR(400),
                    user_email VARCHAR(200),
                    ip_hash VARCHAR(32),
                    resolved BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """),
            ("ix_resolved", "CREATE INDEX IF NOT EXISTS ix_user_feedback_resolved ON user_feedback (resolved)"),
            ("ix_created_at", "CREATE INDEX IF NOT EXISTS ix_user_feedback_created_at ON user_feedback (created_at)"),
            ("ix_ip_hash", "CREATE INDEX IF NOT EXISTS ix_user_feedback_ip_hash ON user_feedback (ip_hash)"),
        ]
        for label, sql in statements:
            try:
                with _engine.begin() as conn:
                    conn.execute(text(sql))
                results.append({"step": label, "ok": True})
            except Exception as ie:
                results.append({"step": label, "ok": False, "error": str(ie)[:200]})
        return {"ok": True, "message": "user_feedback table ensured", "steps": results}
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@app.api_route("/api/ebay/refresh", methods=["GET", "POST"])
async def ebay_refresh(request: Request, db: Session = Depends(get_db)):
    """
    Admin-gated live-refresh via eBay Browse API.
    Runs on a 15-minute Vercel cron to keep bid counts + end times fresh.
    Auth: CRON_SECRET bearer (Vercel cron) or X-Admin-Token header.
    """
    require_cron_or_admin(request)

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

    # Stale-sweep pass: pick the 50 auctions with the OLDEST last_updated that
    # are still active AND ending within 6h, and re-fetch each individually.
    # Keeps "ending soon" bid_count / end_time fresher than the per-query
    # broad sync alone can manage.
    stale_refreshed = 0
    try:
        from ebay_api import get_item_details as _get_item_details_stale
        soon6h_cutoff = datetime.utcnow() + timedelta(hours=6)
        stale_candidates = db.query(Auction).filter(
            Auction.status == "active",
            Auction.is_real_ebay == True,
            Auction.ebay_listing_id.isnot(None),
            Auction.end_time.isnot(None),
            Auction.end_time > datetime.utcnow(),
            Auction.end_time <= soon6h_cutoff,
        ).order_by(Auction.last_updated.asc().nulls_first()).limit(50).all()
        for _a in stale_candidates:
            try:
                _item = await _get_item_details_stale(_a.ebay_listing_id)
                if not _item:
                    continue
                _a.current_price = _item.get("current_price", _a.current_price)
                _a.bid_count = _item.get("bid_count", _a.bid_count)
                _a.end_time = _item.get("end_time", _a.end_time)
                _a.last_updated = datetime.utcnow()
                stale_refreshed += 1
            except Exception:
                # Per-item errors must not kill the sweep.
                continue
        if stale_refreshed:
            db.commit()
    except Exception:
        # Stale sweep is best-effort — never fail the overall refresh over it.
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
    except Exception as _exp_e:
        # Sweep is best-effort — never fail the overall refresh — but log so a
        # repeatedly-failing sweep (DB lock, schema drift) doesn't stay invisible.
        logger.warning(f"expired-auction sweep failed: {_exp_e}")

    # Recompute snipe_eligible now that prices/end_times are fresh — this is the
    # catch-up pass that flips newly-eligible auctions on without waiting for the
    # next /api/cron/sync cycle.
    snipe_recompute = None
    try:
        from scraper import recompute_snipe_eligibility
        snipe_recompute = recompute_snipe_eligibility(db)
    except Exception as _sr_e:
        # Best-effort recompute — log so a broken scraper module is visible.
        logger.warning(f"snipe recompute (refresh) failed: {_sr_e}")

    total_active = db.query(Auction).filter(Auction.status == "active").count()
    return {
        "ok": True,
        "searches": len(SEARCH_QUERIES),
        "listings_added": added,
        "total_active": total_active,
        "priority_refreshed": priority_refreshed,
        "stale_refreshed": stale_refreshed,
        "snipe_recompute": snipe_recompute,
    }


@app.api_route("/api/cron/scrape-free", methods=["GET", "POST"])
async def cron_scrape_free(request: Request):
    """
    Dedicated high-frequency (every 10 min) tick that runs ONLY the free HTML
    scrapers — no eBay Browse API quota burned. Scoped separately from
    /api/cron/sync so we can hammer the cheap scrapers without tripping the
    expensive paths.

    Auth: same pattern as /api/ebay/refresh — CRON_SECRET bearer or X-Admin-Token.
    """
    require_cron_or_admin(request)

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
async def manual_sync(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
async def manual_price_history_sync(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Trigger one batch of price history sync (5 drivers, ~300 sold comps each)."""
    if not has_real_credentials():
        return {"success": False, "message": "No eBay credentials"}
    from price_history_sync import sync_price_history_batch
    result = await sync_price_history_batch(db)
    from database import PriceHistory
    total_ph = db.query(PriceHistory).count()
    return {"success": True, **result, "total_price_history_records": total_ph}


@app.post("/api/admin/seed-all-drivers")
def seed_all_drivers(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
            # Idempotent ALTER — almost always "column already exists". Safe to swallow.
            pass
    from seed_data import seed_missing_drivers
    added = seed_missing_drivers(db)
    return {"added": added, "status": "done"}


@app.post("/api/admin/seed-auto-variants")
def seed_auto_variants(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
def reset_price_history_sync(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Clear all sync logs so every driver is due on the next cron/sync."""
    from database import PriceHistorySyncLog
    deleted = db.query(PriceHistorySyncLog).delete()
    db.commit()
    return {"reset": deleted}


@app.post("/api/admin/fix-stale-endtimes")
def fix_stale_endtimes(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
def fix_parallel_names(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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


@app.post("/api/admin/normalize-driver-names")
def normalize_driver_names(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Collapse driver_name variants to canonical 'First Last' across all tables.

    Idempotent — running twice is a no-op on the second run because every row
    already maps to its canonical form. Per-table summary:

        {table, rows_updated, unique_before, unique_after}

    Skips rows where the canonical form == the existing value, so we don't
    touch rows that are already clean or where the name isn't in our map
    (legitimate non-grid names like 'Sergio Perez' stay untouched).

    Uses raw SQL UPDATE keyed on the OLD name so we don't load every row into
    Python memory. comp_medians + race_results have unique constraints that
    *could* collide if normalizing two old values produces the same canonical
    form (e.g. 'Hamilton' and 'Lewis Hamilton' both → 'Lewis Hamilton'). We
    handle that by deleting losing duplicate rows before the rename — keeping
    the row with the most recent computed_at / inserted_at.
    """
    from sqlalchemy import text
    from lib.driver_norm import normalize_driver

    # (table_name, has_unique_constraint, "tiebreaker order-by column" or None)
    # comp_medians: UNIQUE(driver_name, parallel, grade, days) — keep most recent
    # race_results: UNIQUE(driver_name, race_date) — keep most recent
    # All other tables: plain rename is safe
    tables = [
        ("sold_cards", None, None),
        ("cards", None, None),
        ("psa_pop", None, None),
        ("psa_pop_snapshots", None, None),
        ("psa_sales", None, None),
        ("sold_cards_archive", None, None),
        ("race_results", ("driver_name", "race_date"), "inserted_at"),
        ("comp_medians", ("driver_name", "parallel", "grade", "days"), "computed_at"),
    ]

    results = []
    for tbl, unique_cols, tiebreak in tables:
        try:
            # Get all distinct current names — case-sensitive distinct so we
            # see "Hamilton" vs "HAMILTON" vs "Lewis Hamilton" separately.
            distincts = [
                r[0] for r in db.execute(
                    text(f"SELECT DISTINCT driver_name FROM {tbl} WHERE driver_name IS NOT NULL")
                ).fetchall()
            ]
        except Exception as e:
            # Table may not exist (e.g. comp_medians on a fresh deploy)
            results.append({
                "table": tbl, "skipped": True, "error": str(e)[:120]
            })
            db.rollback()
            continue

        unique_before = len(distincts)
        rows_updated = 0

        for old in distincts:
            new = normalize_driver(old)
            if new == old:
                continue  # already canonical, or unknown — leave alone

            if unique_cols:
                # Pre-delete losing duplicates that would conflict with the rename.
                # For comp_medians: rows whose (parallel, grade, days) already
                # exist under the canonical name — drop the OLD-named row(s).
                # Tiebreaker keeps the row with the latest tiebreak column;
                # since the canonical-named row is the "winner" already in DB,
                # we just delete the old-named duplicates outright.
                conflict_cols = [c for c in unique_cols if c != "driver_name"]
                if conflict_cols:
                    on_clauses = " AND ".join(
                        f"old_t.{c} = new_t.{c}" for c in conflict_cols
                    )
                    del_sql = text(
                        f"DELETE FROM {tbl} old_t "
                        f"WHERE old_t.driver_name = :old "
                        f"AND EXISTS ("
                        f"  SELECT 1 FROM {tbl} new_t "
                        f"  WHERE new_t.driver_name = :new AND {on_clauses}"
                        f")"
                    )
                    try:
                        db.execute(del_sql, {"old": old, "new": new})
                    except Exception:
                        # SQLite doesn't support DELETE ... FROM alias syntax;
                        # fall back to a subselect form.
                        and_clauses = " AND ".join(
                            f"{c} = (SELECT {c} FROM {tbl} t2 WHERE t2.driver_name = :old)"
                            for c in conflict_cols
                        )
                        # Simpler fallback: drop everything with the old name
                        # whose conflict-key exists under the new name.
                        db.rollback()
                        for c in conflict_cols:
                            pass
                        db.execute(text(
                            f"DELETE FROM {tbl} WHERE driver_name = :old "
                            f"AND ({', '.join(conflict_cols)}) IN ("
                            f"  SELECT {', '.join(conflict_cols)} FROM {tbl} "
                            f"  WHERE driver_name = :new"
                            f")"
                        ), {"old": old, "new": new})

            try:
                res = db.execute(
                    text(f"UPDATE {tbl} SET driver_name = :new WHERE driver_name = :old"),
                    {"new": new, "old": old},
                )
                # rowcount may be -1 on some drivers — count manually if so
                rc = res.rowcount if res.rowcount is not None and res.rowcount >= 0 else 0
                rows_updated += rc
            except Exception as e:
                db.rollback()
                results.append({
                    "table": tbl, "old": old, "new": new,
                    "error": f"update failed: {str(e)[:120]}"
                })
                continue

        db.commit()

        unique_after = db.execute(
            text(f"SELECT COUNT(DISTINCT driver_name) FROM {tbl} WHERE driver_name IS NOT NULL")
        ).scalar() or 0

        results.append({
            "table": tbl,
            "rows_updated": int(rows_updated),
            "unique_before": int(unique_before),
            "unique_after": int(unique_after),
        })

    return {"ok": True, "results": results}


@app.post("/api/admin/seed-missing-parallels")
def seed_missing_parallels(db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
async def trigger_card_image_scrape_sync(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Synchronously scrape eBay public search for card catalog images."""
    from card_image_scraper import scrape_all_missing
    updated = await scrape_all_missing(db)
    return {"status": "done", "updated": updated}


@app.post("/api/admin/rebuild")
async def rebuild_auctions(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Delete all active auctions and re-sync from eBay with correct parallel matching."""
    from seed_data import seed_all
    seed_all(db)
    deleted = db.query(Auction).filter(Auction.status == "active").delete()
    db.commit()
    from scraper import sync_real_ebay_listings
    added = await sync_real_ebay_listings(db)
    total = db.query(Auction).filter(Auction.status == "active").count()
    return {"deleted": deleted, "added": added, "total_active": total}


@app.get("/api/cron/mark-ended")
def cron_mark_ended(db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
    """Sweep: mark every active auction whose end_time is in the past as
    'ended'. Runs every 30 min via Vercel cron. Without this, the API's
    ending-soonest sort puts expired rows before live ones, burying real
    auctions past row 500."""
    from database import Auction
    now = datetime.utcnow()
    updated = (
        db.query(Auction)
        .filter(Auction.status == "active", Auction.end_time < now)
        .update({"status": "ended", "last_updated": now}, synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "marked_ended": updated}


def _refresh_comp_medians_impl(db: Session) -> dict:
    """Shared body for the cron + the admin seed endpoint.

    Pre-aggregates 90-day median sale prices per (driver, parallel, grade)
    AND per driver-only (parallel=NULL, grade=NULL) into `comp_medians`.
    Single GROUP BY query per shape (not 1 per tuple) so the full refresh
    runs in seconds even with thousands of distinct tuples.

    Idempotent — running twice in a row produces identical state. UPSERT
    keeps reads consistent during refresh: a concurrent reader sees either
    the old row or the new row, never a torn write.
    """
    import time as _time
    from sqlalchemy import text
    from database import engine as _engine, CompMedian

    started = _time.time()
    days = 90
    is_pg = "postgresql" in str(_engine.url)

    # Self-heal: ensure the table exists (fresh Vercel workers don't always
    # run create_tables() before the first cron tick).
    try:
        CompMedian.__table__.create(bind=_engine, checkfirst=True)
    except Exception as _e:
        logger.warning(f"comp_medians table create skipped: {_e}")

    now = datetime.utcnow()
    cutoff = now - timedelta(days=days)

    # Two GROUP BY queries: one fully-scoped (driver, parallel, grade),
    # one driver-only (parallel=NULL, grade=NULL). Postgres has PERCENTILE_CONT
    # for true median; SQLite falls back to AVG (good enough for local dev).
    if is_pg:
        scoped_sql = (
            "SELECT driver_name, parallel, grade, "
            "PERCENTILE_CONT(0.5) WITHIN GROUP ("
            "ORDER BY sale_price + COALESCE(shipping_cost, 0)) AS med, "
            "COUNT(*) AS n "
            "FROM sold_cards "
            "WHERE sale_date >= :cutoff AND sale_price > 0 "
            "AND is_duplicate = FALSE AND driver_name IS NOT NULL "
            "AND title NOT ILIKE '%dynasty%' "
            "GROUP BY driver_name, parallel, grade HAVING COUNT(*) >= 3"
        )
        driver_only_sql = (
            "SELECT driver_name, "
            "PERCENTILE_CONT(0.5) WITHIN GROUP ("
            "ORDER BY sale_price + COALESCE(shipping_cost, 0)) AS med, "
            "COUNT(*) AS n "
            "FROM sold_cards "
            "WHERE sale_date >= :cutoff AND sale_price > 0 "
            "AND is_duplicate = FALSE AND driver_name IS NOT NULL "
            "AND title NOT ILIKE '%dynasty%' "
            "GROUP BY driver_name HAVING COUNT(*) >= 3"
        )
    else:
        scoped_sql = (
            "SELECT driver_name, parallel, grade, "
            "AVG(sale_price + COALESCE(shipping_cost, 0)) AS med, "
            "COUNT(*) AS n "
            "FROM sold_cards "
            "WHERE sale_date >= :cutoff AND sale_price > 0 "
            "AND is_duplicate = 0 AND driver_name IS NOT NULL "
            "AND LOWER(title) NOT LIKE '%dynasty%' "
            "GROUP BY driver_name, parallel, grade HAVING COUNT(*) >= 3"
        )
        driver_only_sql = (
            "SELECT driver_name, "
            "AVG(sale_price + COALESCE(shipping_cost, 0)) AS med, "
            "COUNT(*) AS n "
            "FROM sold_cards "
            "WHERE sale_date >= :cutoff AND sale_price > 0 "
            "AND is_duplicate = 0 AND driver_name IS NOT NULL "
            "AND LOWER(title) NOT LIKE '%dynasty%' "
            "GROUP BY driver_name HAVING COUNT(*) >= 3"
        )

    rows_scoped = list(db.execute(text(scoped_sql), {"cutoff": cutoff}))
    rows_driver = list(db.execute(text(driver_only_sql), {"cutoff": cutoff}))

    # Build the set of (driver, parallel, grade) tuples that should exist
    # after this refresh — used below to delete stale rows.
    fresh_keys = set()
    for r in rows_scoped:
        fresh_keys.add((r[0], r[1], r[2]))
    for r in rows_driver:
        fresh_keys.add((r[0], None, None))

    computed = 0
    if is_pg:
        upsert_sql = text(
            "INSERT INTO comp_medians (driver_name, parallel, grade, median_total, n_comps, days, computed_at) "
            "VALUES (:dn, :par, :gr, :med, :n, :days, :ts) "
            "ON CONFLICT ON CONSTRAINT uq_comp_med_combo DO UPDATE SET "
            "median_total = EXCLUDED.median_total, "
            "n_comps = EXCLUDED.n_comps, "
            "computed_at = EXCLUDED.computed_at"
        )
        for r in rows_scoped:
            db.execute(upsert_sql, {
                "dn": r[0], "par": r[1], "gr": r[2],
                "med": float(r[3]), "n": int(r[4]),
                "days": days, "ts": now,
            })
            computed += 1
        for r in rows_driver:
            db.execute(upsert_sql, {
                "dn": r[0], "par": None, "gr": None,
                "med": float(r[1]), "n": int(r[2]),
                "days": days, "ts": now,
            })
            computed += 1
    else:
        # SQLite path — SELECT-then-INSERT/UPDATE.
        from database import CompMedian as _CM
        def _upsert(dn, par, gr, med, n):
            existing = (
                db.query(_CM)
                .filter(_CM.driver_name == dn, _CM.parallel == par,
                        _CM.grade == gr, _CM.days == days)
                .first()
            )
            if existing:
                existing.median_total = float(med)
                existing.n_comps = int(n)
                existing.computed_at = now
            else:
                db.add(_CM(
                    driver_name=dn, parallel=par, grade=gr,
                    median_total=float(med), n_comps=int(n),
                    days=days, computed_at=now,
                ))
        for r in rows_scoped:
            _upsert(r[0], r[1], r[2], r[3], r[4])
            computed += 1
        for r in rows_driver:
            _upsert(r[0], None, None, r[1], r[2])
            computed += 1

    db.commit()

    # Delete stale rows — anything in comp_medians whose (driver, parallel, grade)
    # combo is no longer in the fresh set (i.e. dropped below the 3-comp floor
    # or aged out of the 90-day window).
    deleted = 0
    try:
        from database import CompMedian as _CM
        existing_rows = db.query(_CM).filter(_CM.days == days).all()
        stale_ids = [
            row.id for row in existing_rows
            if (row.driver_name, row.parallel, row.grade) not in fresh_keys
        ]
        if stale_ids:
            db.query(_CM).filter(_CM.id.in_(stale_ids)).delete(synchronize_session=False)
            db.commit()
            deleted = len(stale_ids)
    except Exception as _del_err:
        logger.warning(f"comp_medians stale-delete skipped: {_del_err}")
        db.rollback()

    runtime = round(_time.time() - started, 2)
    return {"ok": True, "computed": computed, "deleted": deleted, "runtime_sec": runtime}


@app.get("/api/cron/refresh-comp-medians")
def cron_refresh_comp_medians(response: Response, db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
    """Daily pre-aggregation of `sold_cards` medians into `comp_medians`.

    Vercel cron at 04:15 UTC. Reads via /api/auctions/with-verdicts hit
    the precomputed table instead of running 50 median lookups per
    request → cold-start drops from ~2.8s to ~200ms.

    Idempotent and UPSERT-atomic (per-row), so a concurrent reader during
    refresh sees either the old or new value but never a torn write.
    """
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    try:
        return _refresh_comp_medians_impl(db)
    except Exception as e:
        logger.error(f"refresh-comp-medians failed: {e}")
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/admin/seed-comp-medians")
def admin_seed_comp_medians(request: Request, db: Session = Depends(get_db)):
    """One-shot seed of `comp_medians` for the first deploy when the table
    is empty. Calls the cron's refresh logic synchronously. Admin-gated."""
    require_admin(request)
    try:
        return _refresh_comp_medians_impl(db)
    except Exception as e:
        logger.error(f"seed-comp-medians failed: {e}")
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


def _refresh_basket_history_impl(db: Session, lookback_days: int = 365) -> dict:
    """Shared body for the basket-history cron + admin seed endpoint.

    For each known index slug, compute the basket value for each of the
    last `lookback_days` days and UPSERT into `basket_daily_value`. Rows
    whose `computed_at` is fresher than 24h are skipped so a re-run on
    the same day doesn't redo the work.

    Strategy: bulk-pull all sold_cards in the (lookback + 7d edge) window
    once per request, group in Python by (driver, parallel), then for
    each (slug, day) compute the +/-7d basket median from the in-memory
    rows. This is the 'ONE big SQL per index' optimization — actually
    ONE big SQL TOTAL, since the same sold_cards rows feed every basket.
    """
    import time as _time
    from sqlalchemy import text
    from database import engine as _engine, BasketDailyValue, SoldCard
    from routers.index import BASKETS as _BASKETS

    started = _time.time()
    is_pg = "postgresql" in str(_engine.url)

    # Self-heal: ensure the table exists (fresh Vercel workers don't always
    # run create_tables() before the first cron tick).
    try:
        BasketDailyValue.__table__.create(bind=_engine, checkfirst=True)
    except Exception as _e:
        logger.warning(f"basket_daily_value table create skipped: {_e}")

    now = datetime.utcnow()
    # Need rows up to +7d outside the lookback window because the basket
    # value at day D uses sales in [D-7d, D+7d]. Earliest day we compute
    # is `now - lookback_days` so earliest sale we need is `now - lookback - 7`.
    earliest_sale = now - timedelta(days=lookback_days + 7)
    latest_sale = now + timedelta(days=7)

    # ONE pull of every relevant sale row. Project only the columns the
    # basket-value computation needs.
    sales_rows = list(db.execute(text(
        "SELECT driver_name, parallel, sale_price, COALESCE(shipping_cost, 0) AS shp, sale_date "
        "FROM sold_cards "
        "WHERE sale_date >= :earliest AND sale_date <= :latest "
        "AND sale_price > 0 "
        f"AND is_duplicate = {'FALSE' if is_pg else '0'} "
        "AND driver_name IS NOT NULL"
    ), {"earliest": earliest_sale, "latest": latest_sale}))

    # Pre-sort sales by date for fast windowing
    sales_rows.sort(key=lambda r: r[4])
    sale_dates = [r[4] for r in sales_rows]

    # Build the fast-skip set: (slug, day) rows already computed in last 24h
    skip_cutoff = now - timedelta(hours=24)
    recent_rows = list(db.execute(text(
        "SELECT slug, date FROM basket_daily_value WHERE computed_at >= :c"
    ), {"c": skip_cutoff}))
    recent_set = set()
    for r in recent_rows:
        d = r[1]
        if isinstance(d, datetime):
            day_key = datetime(d.year, d.month, d.day)
        else:
            day_key = datetime.fromisoformat(str(d))
            day_key = datetime(day_key.year, day_key.month, day_key.day)
        recent_set.add((r[0], day_key))

    if is_pg:
        upsert_sql = text(
            "INSERT INTO basket_daily_value (slug, date, value, computed_at) "
            "VALUES (:slug, :date, :value, :ts) "
            "ON CONFLICT ON CONSTRAINT uq_basket_slug_date DO UPDATE SET "
            "value = EXCLUDED.value, computed_at = EXCLUDED.computed_at"
        )

    import bisect

    def _window_indices(center: datetime):
        """Return (lo, hi) such that sales_rows[lo:hi] is in [center-7d, center+7d]."""
        lo = bisect.bisect_left(sale_dates, center - timedelta(days=7))
        hi = bisect.bisect_right(sale_dates, center + timedelta(days=7))
        return lo, hi

    slugs_processed = 0
    rows_upserted = 0

    for slug, basket in _BASKETS.items():
        slugs_processed += 1
        drivers_filter = basket["drivers"]
        parallel_filter = basket["parallel"]
        drivers_set = set(drivers_filter) if drivers_filter else None

        for d_offset in range(lookback_days, -1, -1):
            center = now - timedelta(days=d_offset)
            day_key = datetime(center.year, center.month, center.day)
            if (slug, day_key) in recent_set:
                continue
            lo, hi = _window_indices(center)
            if hi <= lo:
                continue
            prices = []
            for row in sales_rows[lo:hi]:
                dn, par, sp, shp, _sd = row
                if drivers_set is not None and dn not in drivers_set:
                    continue
                if parallel_filter is not None and par != parallel_filter:
                    continue
                if sp is None or sp <= 0:
                    continue
                prices.append((sp or 0) + (shp or 0))
            if len(prices) < 3:
                continue
            prices.sort()
            median = prices[len(prices) // 2]

            if is_pg:
                db.execute(upsert_sql, {
                    "slug": slug, "date": day_key,
                    "value": float(median), "ts": now,
                })
            else:
                existing = (db.query(BasketDailyValue)
                            .filter(BasketDailyValue.slug == slug,
                                    BasketDailyValue.date == day_key)
                            .first())
                if existing:
                    existing.value = float(median)
                    existing.computed_at = now
                else:
                    db.add(BasketDailyValue(slug=slug, date=day_key,
                                             value=float(median), computed_at=now))
            rows_upserted += 1

        # Commit per-slug so partial progress survives a timeout
        db.commit()

    runtime = round(_time.time() - started, 2)
    return {
        "ok": True,
        "slugs_processed": slugs_processed,
        "rows_upserted": rows_upserted,
        "runtime_sec": runtime,
    }


@app.get("/api/cron/refresh-basket-history")
def cron_refresh_basket_history(response: Response, db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
    """Daily pre-aggregation of index basket daily values into
    `basket_daily_value`. Vercel cron at 04:30 UTC.

    Reads from /api/indices/{slug}/history now read the precomputed table
    instead of recomputing ~30 medians per request → ~2.3s drops to <100ms.
    """
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    try:
        return _refresh_basket_history_impl(db)
    except Exception as e:
        logger.error(f"refresh-basket-history failed: {e}")
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/admin/seed-basket-history")
def admin_seed_basket_history(request: Request, db: Session = Depends(get_db)):
    """One-shot seed of `basket_daily_value` for the first deploy when the
    table is empty. Calls the cron's refresh logic synchronously. Admin-gated."""
    require_admin(request)
    try:
        return _refresh_basket_history_impl(db)
    except Exception as e:
        logger.error(f"seed-basket-history failed: {e}")
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


@app.get("/api/cron/sync-race-results")
async def cron_sync_race_results(request: Request, db: Session = Depends(get_db), _auth: None = Depends(require_cron_or_admin)):
    """Pull all 2026 race results from OpenF1 (https://openf1.org) and
    upsert into race_results. Free public API, no auth.

    ?reset=1 — wipe the table first. Use after a sync logic fix to
    purge bad rows (e.g. Sprint results misingested as Race results)."""
    import httpx
    from database import RaceResult, engine as _engine
    from datetime import datetime as _dt

    # Self-heal: Vercel's stateless workers don't always run create_tables()
    # before the first request. Make sure the table exists before we query it.
    try:
        RaceResult.__table__.create(bind=_engine, checkfirst=True)
    except Exception as _e:
        logger.warning(f"race_results table create skipped: {_e}")

    # Defensive ALTERs for the new columns (is_sprint, laps_completed) — these
    # were added after RaceResult shipped, so existing prod tables don't have
    # them yet. Safe + idempotent.
    try:
        from sqlalchemy import text as _text
        with _engine.connect() as _conn:
            _conn.execute(_text("ALTER TABLE race_results ADD COLUMN IF NOT EXISTS is_sprint BOOLEAN DEFAULT FALSE"))
            _conn.execute(_text("ALTER TABLE race_results ADD COLUMN IF NOT EXISTS laps_completed INTEGER"))
            _conn.commit()
    except Exception as _e:
        logger.warning(f"race_results column add skipped: {_e}")

    if request.query_params.get("reset") == "1":
        try:
            db.query(RaceResult).delete()
            db.commit()
        except Exception as _e:
            logger.warning(f"race_results reset failed: {_e}")
            db.rollback()

    added = 0
    updated = 0
    errors = []
    sessions_seen = 0
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Pull both Race and Sprint session lists
            races_sessions = []
            for label in ("Race", "Sprint"):
                try:
                    r = await client.get(
                        "https://api.openf1.org/v1/sessions",
                        params={"session_name": label, "year": 2026},
                    )
                    if r.status_code == 200:
                        for s in r.json():
                            if s.get("session_name") == label:
                                s["_label"] = label
                                races_sessions.append(s)
                except Exception as _se:
                    errors.append(f"{label} list: {str(_se)[:120]}")

            # Skip sessions in the future (no results yet)
            _now = _dt.utcnow()
            past_sessions = []
            for s in races_sessions:
                ds = (s.get("date_start", "") or "")[:19]
                try:
                    if _dt.fromisoformat(ds) <= _now:
                        past_sessions.append(s)
                except Exception:
                    continue
            sessions = past_sessions
            sessions_seen = len(sessions)

            # OpenF1 rate-limits us at ~1 req/sec. Sequential 8 sessions × 2
            # calls = 16 calls in 8s without sleep → most return 429. Sleep
            # 700ms between sessions keeps us under the limit and still
            # finishes 8 sessions in ~12s.
            for sess_idx, sess in enumerate(sessions):
                if sess_idx > 0:
                    await asyncio.sleep(0.7)
                sk = sess.get("session_key")
                label = sess.get("_label", "Race")
                meeting = sess.get("meeting_name") or sess.get("circuit_short_name") or "Race"
                race_name = f"{meeting} ({label})" if label == "Sprint" else meeting
                race_date_str = sess.get("date_start", "")[:19]
                try:
                    race_date = _dt.fromisoformat(race_date_str)
                except Exception:
                    continue

                async def _get_with_retry(url, params):
                    for attempt in range(3):
                        try:
                            r = await client.get(url, params=params)
                        except Exception as e:
                            if attempt == 2: raise
                            await asyncio.sleep(0.8 * (attempt + 1))
                            continue
                        if r.status_code == 429:
                            if attempt == 2: return r
                            await asyncio.sleep(1.5 * (attempt + 1))
                            continue
                        return r
                    return r
                try:
                    dresp = await _get_with_retry(
                        "https://api.openf1.org/v1/drivers", {"session_key": sk}
                    )
                    rresp = await _get_with_retry(
                        "https://api.openf1.org/v1/session_result", {"session_key": sk}
                    )
                except Exception as _se:
                    errors.append(f"sess {sk}: {str(_se)[:80]}")
                    continue

                if dresp.status_code != 200 or rresp.status_code != 200:
                    errors.append(f"sess {sk} status {dresp.status_code}/{rresp.status_code}")
                    continue
                try:
                    drivers = dresp.json()
                    results = rresp.json()
                except Exception as _je:
                    errors.append(f"sess {sk} json: {str(_je)[:80]}")
                    continue
                if not isinstance(results, list) or not isinstance(drivers, list):
                    errors.append(f"sess {sk} not-list results={type(results).__name__} drivers={type(drivers).__name__}")
                    continue
                if not results:
                    errors.append(f"sess {sk} empty results")
                    continue
                drv_map = {d.get("driver_number"): d.get("full_name") for d in drivers if d.get("driver_number")}

                _session_added_before = added
                for r in results:
                    dn = r.get("driver_number")
                    name = drv_map.get(dn)
                    if not name:
                        continue
                    pos = r.get("position")
                    dnf = r.get("dnf", False)
                    dsq = r.get("dsq", False)
                    dns = r.get("dns", False)
                    status = "DSQ" if dsq else "DNS" if dns else "DNF" if dnf else "Finished"
                    pts = r.get("points")
                    laps = r.get("number_of_laps")
                    is_sprint = (label == "Sprint")

                    existing = (
                        db.query(RaceResult)
                        .filter(RaceResult.driver_name == name, RaceResult.race_date == race_date)
                        .first()
                    )
                    if existing:
                        existing.position = pos
                        existing.status = status
                        existing.points = pts
                        existing.race_name = race_name
                        existing.is_sprint = is_sprint
                        existing.laps_completed = laps
                        updated += 1
                    else:
                        db.add(RaceResult(
                            driver_name=name,
                            race_name=race_name,
                            race_date=race_date,
                            position=pos,
                            status=status,
                            points=pts,
                            season=2026,
                            source="openf1",
                            is_sprint=is_sprint,
                            laps_completed=laps,
                        ))
                        added += 1
                # Commit per-session — earlier batched-commit lost most rows
                # silently when one session's data triggered a constraint
                # rollback that took the others with it.
                try:
                    db.commit()
                except Exception as _ce:
                    db.rollback()
                    errors.append(f"sess {sk} commit: {str(_ce)[:120]}")
                    added = _session_added_before  # un-count rolled-back adds
    except Exception as e:
        errors.append(str(e)[:200])
        try: db.rollback()
        except Exception: pass
    # Diagnostic — what's actually in the table now
    try:
        from sqlalchemy import func as _func
        total_rows = db.query(_func.count(RaceResult.id)).scalar() or 0
        date_rows = db.query(RaceResult.race_date, _func.count(RaceResult.id)).group_by(RaceResult.race_date).all()
        date_breakdown = [{"date": str(d), "count": int(c)} for d, c in date_rows]
        # Echo back what we saw from openf1 too
        seen_dates = sorted({(s.get("date_start","") or "")[:10] for s in past_sessions})
    except Exception:
        total_rows = -1
        date_breakdown = []
        seen_dates = []
    return {
        "ok": not errors, "added": added, "updated": updated,
        "sessions_seen": sessions_seen,
        "total_rows": total_rows,
        "date_breakdown": date_breakdown,
        "openf1_dates_seen": seen_dates,
        "errors": errors,
    }


@app.get("/api/drivers/form")
def driver_form_scores(response: Response = None, db: Session = Depends(get_db)):
    """Compute current form score for every driver from their last 6 events
    (Race or Sprint). All considered, but each is weighted:

    - Race recency × 1.0 modifier (full weight)
    - Sprint recency × 0.5 modifier (half weight — Sprints matter less)
    - DNF severity by laps_completed:
        ≤3 laps  →  5 pts (likely lap-1 incident, NOT driver's fault)
        4-15     →  2 pts (could be either)
        15+      →  0 pts (long DNF — usually mechanical or driver error)

    Position points: 1st=25, 2nd=18, 3rd=15, 4-10 declining 12-3, else 1.
    DSQ always = 0 pts. DNS doesn't count toward weight_sum (not their fault).

    Tiers: hot ≥20, climbing ≥10, stable ≥5, else cold.

    Scoring core lives in driver_form.py — shared with calculate_snipe_score,
    which applies a form-based price-threshold adjustment (a driver coming
    off a win needs a deeper discount to read as a "cheap" snipe, since
    hype outruns the comp median).
    """
    from database import RaceResult, engine as _engine
    from datetime import datetime as _dt, timedelta as _td
    from driver_form import compute_form_for_results, POSITION_POINTS, FORM_LOOKBACK_DAYS

    # Self-heal table on first call (see cron_sync_race_results note).
    try:
        RaceResult.__table__.create(bind=_engine, checkfirst=True)
    except Exception:
        # Idempotent create_all-style call — race condition or already exists. Safe to swallow.
        pass

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=600, stale-while-revalidate=3600"

    cutoff = _dt.utcnow() - _td(days=FORM_LOOKBACK_DAYS)
    rows = db.query(RaceResult).filter(RaceResult.race_date >= cutoff).all()

    by_driver = {}
    for r in rows:
        by_driver.setdefault(r.driver_name, []).append(r)

    out = []
    for name, results in by_driver.items():
        form = compute_form_for_results(results)
        out.append({"driver_name": name, **form})

    out.sort(key=lambda x: -x["form_score"])
    return {"drivers": out, "weights_table": POSITION_POINTS}


@app.post("/api/extension/verdicts")
def extension_verdicts(
    payload: dict = Body(...),
    response: Response = None,
    db: Session = Depends(get_db),
):
    """Batch verdict lookup for the browser extension.

    Input:
        {"items": [{"title": "...", "price": 42.0}, ...]}
    Returns:
        {"verdicts": [{"verdict": "STRONG_BUY"|..., "median": 80.0, "n_comps": 12,
                       "ratio": 0.52, "driver": "Lewis Hamilton",
                       "parallel": "Refractor"}|null, ...]}

    Order is preserved 1:1 with the input list. `null` entries indicate we
    couldn't determine driver/parallel from the title (treat as 'unknown').
    """
    from ebay_api import extract_driver_from_title, extract_parallel_from_title
    from scraper import median_comp_price, _extract_grade_from_title

    items = payload.get("items") or []
    if not isinstance(items, list):
        return {"verdicts": []}
    items = items[:50]  # cap batch size — protect API + DB

    if response is not None:
        # Items rarely change verdict in <60s. Cache the batch response so
        # repeat scrolls of the same eBay page hit the CDN edge.
        response.headers["Cache-Control"] = "public, s-maxage=60, stale-while-revalidate=300"
        # Allow the extension to call from any eBay tab origin.
        response.headers["Access-Control-Allow-Origin"] = "*"

    out = []
    # In-request memo so duplicate (driver, parallel, grade) tuples only do
    # one median lookup per batch.
    memo: dict = {}

    for it in items:
        title = (it or {}).get("title", "") or ""
        price = float((it or {}).get("price", 0) or 0)
        if not title:
            out.append(None)
            continue

        driver = extract_driver_from_title(title)
        parallel = extract_parallel_from_title(title)
        grade = _extract_grade_from_title(title)

        if not driver:
            out.append({
                "verdict": None,
                "median": None,
                "n_comps": 0,
                "ratio": None,
                "driver": None,
                "parallel": parallel,
                "reason": "no_driver_match",
            })
            continue

        memo_key = (driver, parallel, grade)
        if memo_key in memo:
            median, n_comps = memo[memo_key]
        else:
            try:
                median, n_comps = median_comp_price(db, driver, parallel, grade)
            except Exception:
                median, n_comps = None, 0
            memo[memo_key] = (median, n_comps)

        if not median or n_comps < 3 or price <= 0:
            out.append({
                "verdict": None,
                "median": median,
                "n_comps": n_comps,
                "ratio": None,
                "driver": driver,
                "parallel": parallel,
                "reason": "no_comps" if not median else "low_confidence",
            })
            continue

        ratio = price / median if median > 0 else 0
        # SANITY BOUND: a price >=5x the comp median almost always means the
        # listing's parallel got misparsed (e.g. a SuperFractor Auto tagged
        # as plain "Refractor"). Don't issue a verdict — show the raw price
        # and let the user judge. Suppressing the median too so we don't
        # imply confidence in a number that's about to look ridiculous.
        if price >= median * 5 and median > 0:
            out.append({
                "verdict": None,
                "median": None,
                "n_comps": n_comps,
                "ratio": None,
                "driver": driver,
                "parallel": parallel,
                "reason": "price_vs_median_outlier",
            })
            continue

        # STRONG_BUY: needs n_comps>=10 (already), AND price>=$5 to avoid
        # math volatility on penny-auction listings.
        if ratio <= 0.6 and n_comps >= 10 and price >= 5:
            verdict = "STRONG_BUY"
        elif ratio <= 0.8:
            verdict = "GOOD_BUY"
        elif ratio <= 1.05:
            verdict = "FAIR"
        elif ratio <= 1.25:
            verdict = "OVERPRICED"
        else:
            verdict = "PASS"

        out.append({
            "verdict": verdict,
            "median": round(median, 2),
            "n_comps": n_comps,
            "ratio": round(ratio, 3),
            "driver": driver,
            "parallel": parallel,
            "low_confidence": n_comps < 10,
        })

    return {"verdicts": out}


@app.options("/api/extension/verdicts")
def extension_verdicts_preflight(response: Response):
    """CORS preflight for the extension batch endpoint."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Max-Age"] = "86400"
    return {}


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
        except Exception as _ve:
            # Verdict computation is decorative for the OG image — fall back to
            # default but log so consistently-empty verdicts surface upstream bugs.
            logger.warning(f"og-image verdict compute failed: {_ve}")

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

    # Paths that must NEVER fall through to the SPA — these should return a
    # real 404 (or be handled by a registered route). Without this guard, a
    # broken/typoed API call returns 200 + index.html, JSON.parse() fails, and
    # the UI silently shows empty data instead of an error users can debug.
    _NON_SPA_PREFIXES = ("api/", "og/", "ws")
    _NON_SPA_EXACT = {"sitemap.xml", "robots.txt", "feed.xml", "manifest.json"}

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path in _NON_SPA_EXACT or full_path.startswith(_NON_SPA_PREFIXES):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(os.path.join(frontend_dist, "index.html"))


@app.on_event("startup")
async def startup_event():
    # Always ensure schema + tables exist (idempotent, fast on subsequent calls)
    create_tables()

    # Column migrations that used to live here (buying_options, extra_images,
    # ebay_item_id, sold_cards.source) moved into create_tables()'s sentinel-
    # gated `adds` list — they were bare ADD COLUMNs that failed on every boot
    # and cost a Neon round-trip each. See database.py SCHEMA_REV.

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
        except Exception as _seed_e:
            # Local-dev seed — log so a broken seed_all doesn't silently leave an empty DB.
            logger.warning(f"local-dev startup seed skipped: {_seed_e}")
        # Imported lazily: the scheduler pulls in scraper/ebay_api at module load,
        # which is dead weight on Vercel cold starts (crons run via vercel.json there).
        from scheduler import set_broadcast, start_scheduler
        set_broadcast(manager.broadcast)
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
