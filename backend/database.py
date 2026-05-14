from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

import os as _os
_pg_url = _os.environ.get("DATABASE_URL", "")
if _pg_url:
    DATABASE_URL = _pg_url.replace("postgres://", "postgresql://", 1)
    import time as _time
    import psycopg2 as _psycopg2

    def _make_conn():
        """Connect with retry — handles transient 'Max client connections' on free tier."""
        for attempt in range(6):
            try:
                return _psycopg2.connect(DATABASE_URL, connect_timeout=10)
            except _psycopg2.OperationalError as e:
                msg = str(e)
                if ("Max client" in msg or "max_client_conn" in msg or "too many clients" in msg) and attempt < 5:
                    _time.sleep(0.25 * (attempt + 1))
                    continue
                raise

    from sqlalchemy.pool import NullPool
    engine = create_engine(
        "postgresql+psycopg2://",
        creator=_make_conn,
        poolclass=NullPool,
    )
else:
    _db_path = _os.environ.get("DB_PATH", _os.path.join(_os.path.dirname(__file__), "f1cards.db"))
    DATABASE_URL = f"sqlite:///{_db_path}"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Card(Base):
    __tablename__ = "cards"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, index=True)
    year = Column(Integer)
    set_name = Column(String, default="Topps Chrome F1")
    card_number = Column(String)
    parallel = Column(String)
    grade = Column(String)
    image_url = Column(String)
    ebay_image_url = Column(String, nullable=True)
    base_value = Column(Float)
    investment_score = Column(Float)
    team = Column(String, nullable=True)
    team_color = Column(String, nullable=True)
    nationality = Column(String, nullable=True)
    career_wins = Column(Integer, default=0)
    championships = Column(Integer, default=0)
    series = Column(String, default="F1", nullable=True)
    is_rookie = Column(Boolean, default=False, nullable=True)
    is_legend = Column(Boolean, default=False, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    auctions = relationship("Auction", back_populates="card", cascade="all, delete-orphan")
    portfolio_items = relationship("Portfolio", back_populates="card", cascade="all, delete-orphan")
    price_history = relationship("PriceHistory", back_populates="card", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="card", cascade="all, delete-orphan")
    wishlist_items = relationship("Wishlist", back_populates="card", cascade="all, delete-orphan")


class Auction(Base):
    __tablename__ = "auctions"
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"))
    # NOTE: column is *not* declared unique=True at the SQLAlchemy level — uniqueness
    # is enforced via a partial index (`ix_auctions_ebay_listing_id_notnull`)
    # created in create_tables() so multiple NULLs are allowed without surprise.
    ebay_listing_id = Column(String, unique=False, index=True)
    title = Column(String)
    current_price = Column(Float)
    buy_now_price = Column(Float, nullable=True)
    bid_count = Column(Integer, default=0)
    end_time = Column(DateTime)
    seller = Column(String)
    seller_feedback = Column(Integer, default=0)
    condition = Column(String)
    snipe_eligible = Column(Boolean, default=False)
    snipe_score = Column(Float, default=0.0)
    status = Column(String, default="active")  # active, ended, sniped, watchlist
    ebay_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    shipping_cost = Column(Float, default=0.0)
    is_real_ebay = Column(Boolean, default=False)
    buying_options = Column(Text, nullable=True)  # JSON array e.g. '["AUCTION","BEST_OFFER"]'
    extra_images = Column(Text, nullable=True)    # JSON array of additional image URLs
    # Quick filter flags computed at scrape time so frontend doesn't regex per-render
    is_lot = Column(Boolean, default=False, nullable=True, index=True)
    is_graded = Column(Boolean, default=False, nullable=True, index=True)
    is_sealed = Column(Boolean, default=False, nullable=True, index=True)
    grade_num = Column(Float, nullable=True)  # 9.5, 10, etc.
    psa_cert = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.utcnow)

    card = relationship("Card", back_populates="auctions")

    __table_args__ = (
        Index("ix_auctions_status_snipe_score", "status", "snipe_score"),
        Index("ix_auctions_status_end_time", "status", "end_time"),
        Index("ix_auctions_end_time", "end_time"),
    )


class Portfolio(Base):
    __tablename__ = "portfolio"
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"))
    purchase_price = Column(Float)
    purchase_date = Column(DateTime)
    current_value = Column(Float)
    quantity = Column(Integer, default=1)
    notes = Column(Text, nullable=True)
    ebay_listing_id = Column(String, nullable=True)
    user_id = Column(String, nullable=True, index=True)  # nullable for backfill

    card = relationship("Card", back_populates="portfolio_items")


class PriceHistory(Base):
    __tablename__ = "price_history"
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"))
    price = Column(Float)
    sale_date = Column(DateTime)
    source = Column(String, default="eBay")
    condition = Column(String, nullable=True)
    ebay_item_id = Column(String, nullable=True, index=True)  # dedup key

    card = relationship("Card", back_populates="price_history")


class PriceHistorySyncLog(Base):
    __tablename__ = "price_history_sync_log"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, unique=True, index=True)
    last_synced = Column(DateTime, nullable=True)
    total_records = Column(Integer, default=0)


class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=True)
    alert_type = Column(String)  # price_drop, snipe_opportunity, new_listing, ending_soon
    threshold_price = Column(Float, nullable=True)
    triggered = Column(Boolean, default=False)
    triggered_at = Column(DateTime, nullable=True)
    message = Column(Text, nullable=True)
    auction_id = Column(Integer, nullable=True)
    urgency = Column(String, default="normal")  # low, normal, high, critical
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String, nullable=True, index=True)  # nullable for backfill

    card = relationship("Card", back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_type_triggered_created", "alert_type", "triggered", "created_at"),
    )


class SoldCard(Base):
    """
    Permanent, richer log of every non-base 2025 Topps Chrome F1 sold listing.
    Separate from PriceHistory — no card_id FK, so we can record sales even for
    cards that aren't in our seed catalog (new parallels, odd autos, etc.).
    """
    __tablename__ = "sold_cards"
    id = Column(Integer, primary_key=True, index=True)
    ebay_item_id = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    driver_name = Column(String, index=True, nullable=True)
    parallel = Column(String, index=True, nullable=True)
    grade = Column(String, nullable=True)      # "PSA 10", "BGS 9.5", etc, or null
    condition = Column(String, nullable=True)  # raw eBay condition display name
    sale_price = Column(Float, nullable=False)
    sale_date = Column(DateTime, index=True, nullable=False)
    image_url = Column(String, nullable=True)
    ebay_url = Column(String, nullable=True)
    shipping_cost = Column(Float, nullable=True)
    is_auction = Column(Boolean, default=False)
    series = Column(String, default="F1", nullable=True)
    source = Column(String, default="eBay", index=True)  # 'eBay', 'Goldin', 'PWCC', 'MySlabs'
    is_duplicate = Column(Boolean, default=False, index=True)  # fuzzy-dedup flag
    scraped_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_sold_cards_driver_parallel_date", "driver_name", "parallel", "sale_date"),
    )


class PsaPop(Base):
    """Official PSA population data per card-grade combo. Sourced from psacard.com/pop/."""
    __tablename__ = "psa_pop"
    id = Column(Integer, primary_key=True, index=True)
    set_year = Column(Integer)
    set_name = Column(String)
    card_num = Column(String, nullable=True)
    driver_name = Column(String, index=True)
    parallel = Column(String, index=True)
    grade = Column(String, index=True)
    pop_count = Column(Integer, default=0)
    pop_higher = Column(Integer, default=0)
    source_url = Column(String, nullable=True)
    last_scraped = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_psa_pop_driver_parallel_grade", "driver_name", "parallel", "grade"),
    )


class PsaPopSnapshot(Base):
    """Weekly PSA population snapshot — one row per (driver, parallel, grade) per capture.
    Enables pop-delta / 'who's getting harder to pull a 10 on' queries."""
    __tablename__ = "psa_pop_snapshots"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, nullable=False, index=True)
    parallel = Column(String, nullable=True)
    grade = Column(String, nullable=True)  # PSA 10, PSA 9, etc.
    pop_count = Column(Integer, nullable=False)
    snapshot_date = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index('ix_psa_snap_driver_grade_date', 'driver_name', 'grade', 'snapshot_date'),
    )


class PsaSale(Base):
    """Individual graded sale record. Sourced from psacard.com/auctionprices + our eBay scraper."""
    __tablename__ = "psa_sales"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, index=True)
    parallel = Column(String, index=True)
    grade = Column(String, index=True)
    price = Column(Float)
    sale_date = Column(DateTime, index=True)
    source = Column(String)
    auction_house = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    listing_url = Column(String, nullable=True, unique=True)
    title = Column(String, nullable=True)
    scraped_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_psa_sales_driver_grade_date", "driver_name", "grade", "sale_date"),
    )


class Wishlist(Base):
    __tablename__ = "wishlist"
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"))
    max_price = Column(Float)
    priority = Column(Integer, default=1)  # 1-5
    notes = Column(Text, nullable=True)
    auto_snipe = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String, nullable=True, index=True)  # nullable for backfill

    card = relationship("Card", back_populates="wishlist_items")


class PushSubscription(Base):
    """Browser Web Push subscription — one row per subscribed device."""
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    endpoint = Column(String, unique=True, index=True, nullable=False)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class BidIntent(Base):
    """User-planned max bid on an auction. Saved even when snipe can't auto-execute."""
    __tablename__ = "bid_intents"
    id = Column(Integer, primary_key=True, index=True)
    auction_id = Column(Integer, index=True, nullable=False)
    ebay_item_id = Column(String, nullable=True, index=True)
    max_bid = Column(Float, nullable=False)
    executed = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ScraperRun(Base):
    """Per-run telemetry row — one per scraper invocation."""
    __tablename__ = "scraper_runs"
    id = Column(Integer, primary_key=True, index=True)
    source = Column(String, index=True, nullable=False)  # 'eBay', 'Goldin', ...
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    ended_at = Column(DateTime, nullable=True)
    queries_attempted = Column(Integer, default=0)
    queries_succeeded = Column(Integer, default=0)
    rows_seen = Column(Integer, default=0)
    rows_inserted = Column(Integer, default=0)
    rows_updated = Column(Integer, default=0)
    rows_skipped_dup = Column(Integer, default=0)
    blocked = Column(Boolean, default=False)
    error_message = Column(Text, nullable=True)
    run_id = Column(String, nullable=True)  # GH Actions run id


class VerdictFeedback(Base):
    """User feedback on verdict accuracy — tracks if a STRONG_BUY/GOOD_BUY actually profited."""
    __tablename__ = "user_verdict_feedback"
    id = Column(Integer, primary_key=True, index=True)
    sold_card_id = Column(Integer, ForeignKey("sold_cards.id"), index=True, nullable=False)
    ebay_item_id = Column(String, index=True, nullable=True)  # denorm for quick lookups
    verdict_key = Column(String, nullable=False)  # STRONG_BUY, GOOD_BUY, etc.
    feedback = Column(String, nullable=False)  # 'up', 'down', 'neutral'
    actual_sale_price = Column(Float, nullable=True)  # optional: user's actual profit/loss
    notes = Column(Text, nullable=True)  # user can add context
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_verdict_feedback_card_user", "sold_card_id"),
    )


class SystemState(Base):
    """Key-value store for flags that must survive Vercel cold starts (e.g. eBay rate-limit cooldowns)."""
    __tablename__ = "system_state"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ClickEvent(Base):
    """Affiliate click-out event — fired when a user clicks an outbound eBay link."""
    __tablename__ = "click_events"
    id = Column(Integer, primary_key=True, index=True)
    auction_id = Column(Integer, nullable=True)
    card_id = Column(Integer, nullable=True)
    url = Column(Text, nullable=False)
    clicked_at = Column(DateTime, default=datetime.utcnow, index=True)
    user_agent = Column(String, nullable=True)
    ip_hash = Column(String, nullable=True, index=True)

    __table_args__ = (
        Index("ix_click_events_clicked_at", "clicked_at"),
    )


class UserFeedback(Base):
    """In-app suggestions / bug reports submitted via the floating feedback widget.
    Anonymous-allowed (no auth required) so we get the most signal possible."""
    __tablename__ = "user_feedback"
    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    page_url = Column(String, nullable=True)        # e.g. "/auctions?premium=1"
    user_agent = Column(String, nullable=True)
    user_email = Column(String, nullable=True)      # supabase email if signed in
    ip_hash = Column(String, nullable=True, index=True)
    resolved = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class CardSet(Base):
    """
    Lookup table for card sets across years/brands.
    Backbone for multi-year support — every Card / SoldCard / Auction can reference one.
    enabled_in_ui = False keeps a set fully hidden from the live site.
    """
    __tablename__ = "card_sets"
    id = Column(String, primary_key=True)              # 'topps-chrome-2025'
    year = Column(Integer, nullable=False, index=True)
    brand = Column(String, nullable=False)             # 'Topps Chrome', 'Sapphire', 'Finest'
    name = Column(String, nullable=False)              # 'Topps Chrome F1 2025'
    slug = Column(String, nullable=False, unique=True) # '2025-topps-chrome'
    enabled_for_live_tracking = Column(Boolean, default=False)
    enabled_in_ui = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SoldCardArchive(Base):
    """
    Historical sold-listing archive — isolated from sold_cards so backfilled
    pre-2025 data NEVER leaks into UI queries that target sold_cards.
    Same shape as SoldCard so we can later UNION or migrate when ready.
    """
    __tablename__ = "sold_cards_archive"
    id = Column(Integer, primary_key=True, index=True)
    set_id = Column(String, ForeignKey("card_sets.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    ebay_item_id = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    driver_name = Column(String, index=True, nullable=True)
    parallel = Column(String, index=True, nullable=True)
    grade = Column(String, nullable=True)
    condition = Column(String, nullable=True)
    sale_price = Column(Float, nullable=False)
    sale_date = Column(DateTime, index=True, nullable=False)
    image_url = Column(String, nullable=True)
    ebay_url = Column(String, nullable=True)
    shipping_cost = Column(Float, nullable=True)
    is_auction = Column(Boolean, default=False)
    series = Column(String, default="F1", nullable=True)
    source = Column(String, default="eBay", index=True)
    is_duplicate = Column(Boolean, default=False, index=True)
    scraped_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_sold_archive_year_set", "year", "set_id"),
        Index("ix_sold_archive_driver_parallel_date", "driver_name", "parallel", "sale_date"),
    )


class CompMedian(Base):
    """Pre-aggregated 90-day median sale price by (driver, parallel, grade).

    Refreshed daily by /api/cron/refresh-comp-medians. Endpoints like
    /api/auctions/with-verdicts read this instead of hammering sold_cards on
    every request. Cold-start latency drops from ~2.8s to ~200ms."""
    __tablename__ = "comp_medians"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, nullable=False, index=True)
    parallel = Column(String, nullable=True, index=True)   # null = driver-only aggregate
    grade = Column(String, nullable=True, index=True)      # null = raw/ungraded
    median_total = Column(Float, nullable=False)
    n_comps = Column(Integer, nullable=False, default=0)
    days = Column(Integer, default=90)
    computed_at = Column(DateTime, default=datetime.utcnow, index=True)
    __table_args__ = (
        UniqueConstraint("driver_name", "parallel", "grade", "days",
                         name="uq_comp_med_combo"),
    )


class BasketDailyValue(Base):
    """Pre-aggregated daily index basket value. Powers /api/indices/.../history
    in sub-100ms instead of recomputing per request.

    Refreshed daily by /api/cron/refresh-basket-history at 4:30 UTC."""
    __tablename__ = "basket_daily_value"
    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)  # midnight UTC
    value = Column(Float, nullable=False)
    computed_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("slug", "date", name="uq_basket_slug_date"),)


class RaceResult(Base):
    """Per-driver, per-race finishing result. Powers form-score / driver tier
    computation so card prices can react to current F1 form (e.g. Kimi wins
    Miami → his cards rocket → 'hot' tier badge on the site).

    Sprint races stored alongside GPs (is_sprint=True) and weighted at half
    the Race weight in form scoring. laps_completed lets us distinguish
    'crashed into on lap 1' (low penalty — not the driver's fault) from
    'gave up on lap 50 with a mechanical' (higher penalty)."""
    __tablename__ = "race_results"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, index=True, nullable=False)  # e.g. "Kimi Antonelli"
    race_name = Column(String, nullable=False)  # e.g. "Miami GP 2026"
    race_date = Column(DateTime, nullable=False, index=True)
    position = Column(Integer, nullable=True)  # 1-20, NULL for DNF/DSQ
    status = Column(String, nullable=True)  # "Finished", "DNF", "DSQ", etc
    points = Column(Integer, nullable=True)
    season = Column(Integer, default=2026)
    source = Column(String, default="openf1")  # 'openf1', 'manual'
    is_sprint = Column(Boolean, default=False, index=True)  # True for Sprint races
    laps_completed = Column(Integer, nullable=True)  # for DNF severity heuristic
    inserted_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint('driver_name', 'race_date', name='uq_race_driver_date'),)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        import logging
        logging.getLogger("jarvis.db").error(f"create_tables failed: {e}")
    # Auto-add columns that may be missing on existing Postgres deployments
    # (Base.metadata.create_all only creates new tables, not new columns).
    # Safe to run on every boot — uses ADD COLUMN IF NOT EXISTS.
    try:
        from sqlalchemy import text
        adds = [
            "ALTER TABLE auctions ADD COLUMN IF NOT EXISTS is_lot BOOLEAN DEFAULT FALSE",
            "ALTER TABLE auctions ADD COLUMN IF NOT EXISTS is_graded BOOLEAN DEFAULT FALSE",
            "ALTER TABLE auctions ADD COLUMN IF NOT EXISTS is_sealed BOOLEAN DEFAULT FALSE",
            "ALTER TABLE auctions ADD COLUMN IF NOT EXISTS grade_num REAL",
            "ALTER TABLE auctions ADD COLUMN IF NOT EXISTS psa_cert TEXT",
            "ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_legend BOOLEAN DEFAULT FALSE",
        ]
        with engine.begin() as conn:
            for sql in adds:
                try:
                    conn.execute(text(sql))
                except Exception as col_err:
                    # SQLite doesn't support IF NOT EXISTS on ADD COLUMN; ignore.
                    import logging
                    logging.getLogger("jarvis.db").debug(f"col add skipped ({sql[:50]}): {col_err}")
    except Exception as outer:
        import logging
        logging.getLogger("jarvis.db").warning(f"auto-migrate skipped: {outer}")
    # Seed card_sets lookup (idempotent — INSERT ON CONFLICT DO NOTHING).
    # Only 2025 is enabled_in_ui; the rest are silent backfill targets.
    try:
        from sqlalchemy import text
        seed_rows = [
            ("topps-chrome-2025", 2025, "Topps Chrome", "Topps Chrome F1 2025", "2025-topps-chrome", True, True),
            ("topps-chrome-2024", 2024, "Topps Chrome", "Topps Chrome F1 2024", "2024-topps-chrome", False, False),
            ("topps-chrome-2023", 2023, "Topps Chrome", "Topps Chrome F1 2023", "2023-topps-chrome", False, False),
            ("topps-chrome-2022", 2022, "Topps Chrome", "Topps Chrome F1 2022", "2022-topps-chrome", False, False),
            ("topps-chrome-2021", 2021, "Topps Chrome", "Topps Chrome F1 2021", "2021-topps-chrome", False, False),
            ("topps-chrome-2020", 2020, "Topps Chrome", "Topps Chrome F1 2020", "2020-topps-chrome", False, False),
            ("topps-chrome-sapphire-2024", 2024, "Topps Chrome Sapphire", "Topps Chrome Sapphire F1 2024", "2024-sapphire", False, False),
            ("topps-chrome-sapphire-2023", 2023, "Topps Chrome Sapphire", "Topps Chrome Sapphire F1 2023", "2023-sapphire", False, False),
            ("topps-flagship-2024", 2024, "Topps Flagship", "Topps Flagship F1 2024", "2024-flagship", False, False),
            ("topps-finest-2024", 2024, "Topps Finest", "Topps Finest F1 2024", "2024-finest", False, False),
        ]
        with engine.begin() as conn:
            is_pg = "postgresql" in str(engine.url)
            for row in seed_rows:
                if is_pg:
                    sql = ("INSERT INTO card_sets (id, year, brand, name, slug, enabled_for_live_tracking, enabled_in_ui) "
                           "VALUES (:id,:year,:brand,:name,:slug,:lt,:ui) ON CONFLICT (id) DO NOTHING")
                else:
                    sql = ("INSERT OR IGNORE INTO card_sets (id, year, brand, name, slug, enabled_for_live_tracking, enabled_in_ui) "
                           "VALUES (:id,:year,:brand,:name,:slug,:lt,:ui)")
                try:
                    conn.execute(text(sql), {"id": row[0], "year": row[1], "brand": row[2], "name": row[3],
                                              "slug": row[4], "lt": row[5], "ui": row[6]})
                except Exception as seed_err:
                    import logging
                    logging.getLogger("jarvis.db").debug(f"seed skipped {row[0]}: {seed_err}")
    except Exception as seed_outer:
        import logging
        logging.getLogger("jarvis.db").warning(f"card_sets seed skipped: {seed_outer}")
    # Migration: replace the legacy `unique=True` constraint on auctions.ebay_listing_id
    # with a partial unique index that ignores NULLs. SQLAlchemy's column-level
    # `unique=True` produced a surprising constraint name (`auctions_ebay_listing_id_key`
    # in Postgres) and a regular unique index that allowed multiple NULLs anyway
    # — confusing. Partial index makes the semantics explicit. Postgres-only;
    # SQLite ignores partial-unique constructs in DDL and the try/except swallows it.
    try:
        from sqlalchemy import text
        if "postgresql" in str(engine.url):
            with engine.begin() as conn:
                # Drop the auto-generated unique constraint if present. Name pattern is
                # `<table>_<col>_key` for unique= on a column. Wrapped per-stmt try/except
                # because the constraint may already be gone on fresh DBs.
                for drop_sql in (
                    "ALTER TABLE auctions DROP CONSTRAINT IF EXISTS auctions_ebay_listing_id_key",
                    # Older SQLAlchemy versions sometimes emitted this name instead.
                    "ALTER TABLE auctions DROP CONSTRAINT IF EXISTS uq_auctions_ebay_listing_id",
                    # The non-unique btree index from `index=True` is still useful for lookups
                    # — leave `ix_auctions_ebay_listing_id` in place (don't drop).
                ):
                    try:
                        conn.execute(text(drop_sql))
                    except Exception as drop_err:
                        import logging
                        logging.getLogger("jarvis.db").debug(
                            f"ebay_listing_id constraint drop skipped: {drop_err}"
                        )
                # Create the partial unique index — multiple NULLs allowed, but no
                # duplicate non-NULL values. IF NOT EXISTS keeps it idempotent.
                try:
                    conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_auctions_ebay_listing_id_notnull "
                        "ON auctions(ebay_listing_id) WHERE ebay_listing_id IS NOT NULL"
                    ))
                except Exception as create_err:
                    import logging
                    logging.getLogger("jarvis.db").warning(
                        f"partial unique index create skipped: {create_err}"
                    )
    except Exception as e:
        import logging
        logging.getLogger("jarvis.db").warning(f"ebay_listing_id migration skipped: {e}")
    # Index: speeds up /api/auctions?buying=auction filter, was timing out
    # at 60s+ on production. Partial index on the LIKE pattern dramatically
    # narrows the scan. Postgres-only — SQLite doesn't support LIKE in
    # partial index predicates, so the try/except swallows that on local dev.
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_auctions_active_auction "
                "ON auctions (end_time) "
                "WHERE status = 'active' AND buying_options LIKE '%AUCTION%'"
            ))
            conn.commit()
    except Exception as e:
        import logging
        logging.getLogger("jarvis.db").warning(f"index creation skipped: {e}")
    # Index: speeds up per-driver form-score lookups (last N races by date desc).
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_race_results_driver_date "
                "ON race_results (driver_name, race_date DESC)"
            ))
            conn.commit()
    except Exception as e:
        import logging
        logging.getLogger("jarvis.db").warning(f"race_results index creation: {e}")
    # Index: ensure sold_cards.driver_name has an index (the model declares
    # `index=True`, so Base.metadata.create_all already covers fresh DBs, but
    # this catches any historical Postgres DB where the column was added
    # without the auto-index). Idempotent — no-op if it already exists.
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_sold_cards_driver_name "
                "ON sold_cards (driver_name)"
            ))
            conn.commit()
    except Exception as e:
        import logging
        logging.getLogger("jarvis.db").warning(f"sold_cards driver_name index: {e}")
    # Mark historic / Legends-set drivers so the UI can section them apart
    # from the current grid. Eddie's directive: legends are usually less
    # liquid in the raw market and shouldn't lead the drivers list.
    try:
        from sqlalchemy import text
        LEGEND_NAMES = [
            "Ayrton Senna", "James Hunt", "Damon Hill", "Michael Schumacher",
            "Juan Pablo Montoya", "Jacques Villeneuve", "Gerhard Berger",
            "Nigel Mansell", "Niki Lauda", "Alain Prost",
        ]
        with engine.begin() as conn:
            for ln in LEGEND_NAMES:
                conn.execute(
                    text("UPDATE cards SET is_legend = :t WHERE driver_name ILIKE :n")
                    if "postgresql" in str(engine.url)
                    else text("UPDATE cards SET is_legend = :t WHERE LOWER(driver_name) = LOWER(:n)"),
                    {"t": True, "n": ln},
                )
    except Exception as e:
        import logging
        logging.getLogger("jarvis.db").warning(f"is_legend tag step: {e}")
