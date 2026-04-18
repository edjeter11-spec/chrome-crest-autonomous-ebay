from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Index
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
    ebay_listing_id = Column(String, unique=True, index=True)
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
    created_at = Column(DateTime, default=datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.utcnow)

    card = relationship("Card", back_populates="auctions")


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

    card = relationship("Card", back_populates="alerts")


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


class SystemState(Base):
    """Key-value store for flags that must survive Vercel cold starts (e.g. eBay rate-limit cooldowns)."""
    __tablename__ = "system_state"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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
