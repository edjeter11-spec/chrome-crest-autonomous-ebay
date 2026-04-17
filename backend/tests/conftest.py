"""
Shared pytest fixtures for F1 Chrome Crest backend tests.
Uses an in-memory SQLite database so tests never touch f1cards.db.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Point at an in-memory database before importing anything that touches the DB
os.environ.setdefault("DB_PATH", ":memory:")
os.environ.setdefault("EBAY_APP_ID", "")
os.environ.setdefault("EBAY_APP_SECRET", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "")
# Disable scheduler (APScheduler) by mimicking Vercel environment
os.environ["VERCEL"] = "1"

from database import Base, get_db, Card, Auction, Portfolio, Wishlist, Alert, PriceHistory

# ── in-memory engine shared across all tests ──────────────────────────────────
TEST_ENGINE = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)
Base.metadata.create_all(bind=TEST_ENGINE)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def db():
    """Fresh DB session; rolls back after each test."""
    connection = TEST_ENGINE.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def client(db):
    """FastAPI test client wired to the in-memory DB."""
    from unittest.mock import patch, AsyncMock, MagicMock
    from main import app
    app.dependency_overrides[get_db] = lambda: db

    # Patch out startup side-effects that cross module boundaries
    with patch("seed_data.seed_all", return_value=None), \
         patch("main.has_real_credentials", return_value=False):
        with TestClient(app, raise_server_exceptions=True) as c:
            yield c
    app.dependency_overrides.clear()


# ── seed helpers ──────────────────────────────────────────────────────────────

def make_card(db, **kwargs) -> Card:
    defaults = dict(
        driver_name="Max Verstappen",
        year=2025,
        set_name="Topps Chrome F1",
        card_number="1",
        parallel="Base",
        grade="Raw",
        image_url="https://example.com/max.jpg",
        base_value=50.0,
        investment_score=92.0,
        team="Red Bull Racing",
        team_color="#3671C6",
        nationality="Dutch",
        career_wins=61,
        championships=4,
    )
    defaults.update(kwargs)
    card = Card(**defaults)
    db.add(card)
    db.flush()
    return card


def make_auction(db, card: Card, **kwargs) -> Auction:
    defaults = dict(
        ebay_listing_id=f"ebay-{id(kwargs)}",
        title="2025 Topps Chrome F1 Max Verstappen Base Raw",
        current_price=30.0,
        buy_now_price=None,
        bid_count=2,
        end_time=datetime.utcnow() + timedelta(hours=3),
        seller="topdealer99",
        seller_feedback=1500,
        condition="Near Mint",
        snipe_eligible=True,
        snipe_score=72.0,
        status="active",
        ebay_url="https://www.ebay.com/itm/123",
        image_url="https://example.com/auction.jpg",
        shipping_cost=0.0,
        is_real_ebay=True,
        buying_options='["AUCTION"]',
    )
    defaults.update(kwargs)
    a = Auction(card_id=card.id, **defaults)
    db.add(a)
    db.flush()
    return a
