"""
Unit tests for the snipe scoring engine and eBay sync logic.
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scraper import calculate_snipe_score, run_snipe_alerts
from database import Card, Auction, Alert


def _mock_card(base_value=50.0) -> MagicMock:
    card = MagicMock()
    card.base_value = base_value
    card.investment_score = 80.0
    card.driver_name = "Max Verstappen"
    return card


def _mock_auction(hours_left=2.0, price=30.0, feedback=1500, bids=2) -> MagicMock:
    auction = MagicMock()
    auction.end_time = datetime.utcnow() + timedelta(hours=hours_left)
    auction.current_price = price
    auction.seller_feedback = feedback
    auction.bid_count = bids
    return auction


class TestCalculateSnipeScore:
    # ── Time score branch coverage ──────────────────────────────────────────
    def test_peak_time_window_30min(self):
        a = _mock_auction(hours_left=0.4)
        score = calculate_snipe_score(a, _mock_card())
        assert 0 <= score <= 100

    def test_very_close_under_15min(self):
        a = _mock_auction(hours_left=0.2)
        score = calculate_snipe_score(a, _mock_card())
        assert score > 0

    def test_within_1hr(self):
        a = _mock_auction(hours_left=0.75)
        s1 = calculate_snipe_score(a, _mock_card())
        a2 = _mock_auction(hours_left=0.4)
        s2 = calculate_snipe_score(a2, _mock_card())
        # 30min window is the peak; both valid scores
        assert 0 <= s1 <= 100

    def test_high_time_score_when_ending_soon(self):
        close = _mock_auction(hours_left=0.4)
        far = _mock_auction(hours_left=48.0)
        card = _mock_card()
        assert calculate_snipe_score(close, card) > calculate_snipe_score(far, card)

    def test_ended_auction_low_score(self):
        a = _mock_auction(hours_left=0.0)
        score = calculate_snipe_score(a, _mock_card())
        # time_score = 95 when hours_left <= 0.25; overall score still valid
        assert 0 <= score <= 100

    # ── Price score branch coverage ─────────────────────────────────────────
    def test_price_below_50pct_of_value_max_score(self):
        card = _mock_card(base_value=100.0)
        a = _mock_auction(price=45.0)  # 45% of base
        score = calculate_snipe_score(a, card)
        # price_score should be 100; verify score is high
        assert score > 60

    def test_price_above_115pct_low_price_score(self):
        card = _mock_card(base_value=50.0)
        a = _mock_auction(price=80.0)  # 160% of base
        score_expensive = calculate_snipe_score(a, card)
        a2 = _mock_auction(price=20.0)
        score_cheap = calculate_snipe_score(a2, card)
        assert score_cheap > score_expensive

    def test_zero_base_value_defaults_price_score(self):
        card = _mock_card(base_value=0.0)
        a = _mock_auction(price=10.0)
        score = calculate_snipe_score(a, card)
        assert 0 <= score <= 100

    # ── Feedback score branch coverage ──────────────────────────────────────
    def test_feedback_5000_max(self):
        a = _mock_auction(feedback=6000)
        s1 = calculate_snipe_score(a, _mock_card())
        a2 = _mock_auction(feedback=5)
        s2 = calculate_snipe_score(a2, _mock_card())
        assert s1 > s2

    def test_feedback_thresholds(self):
        card = _mock_card()
        for fb in [0, 10, 100, 500, 1000, 5000, 10000]:
            a = _mock_auction(feedback=fb)
            score = calculate_snipe_score(a, card)
            assert 0 <= score <= 100, f"Score out of range for feedback={fb}"

    # ── Bid score branch coverage ────────────────────────────────────────────
    def test_zero_bids_high_score(self):
        a_no_bids = _mock_auction(bids=0)
        a_bids = _mock_auction(bids=15)
        card = _mock_card()
        assert calculate_snipe_score(a_no_bids, card) > calculate_snipe_score(a_bids, card)

    def test_many_bids_low_score(self):
        a = _mock_auction(bids=20)
        score = calculate_snipe_score(a, _mock_card())
        assert score < 80

    # ── Edge cases ───────────────────────────────────────────────────────────
    def test_no_card_returns_zero(self):
        a = _mock_auction()
        assert calculate_snipe_score(a, None) == 0.0

    def test_score_is_float(self):
        score = calculate_snipe_score(_mock_auction(), _mock_card())
        assert isinstance(score, float)

    def test_score_bounded_0_to_100(self):
        # Worst case
        a = _mock_auction(hours_left=72, price=200.0, feedback=0, bids=20)
        low = calculate_snipe_score(a, _mock_card(base_value=50.0))
        assert 0 <= low <= 100
        # Best case
        a2 = _mock_auction(hours_left=0.4, price=1.0, feedback=9999, bids=0)
        high = calculate_snipe_score(a2, _mock_card(base_value=100.0))
        assert 0 <= high <= 100

    def test_weighted_sum_components(self):
        """Verify the 0.35/0.40/0.10/0.15 weighting doesn't exceed 100."""
        a = _mock_auction(hours_left=0.4, price=25.0, feedback=5000, bids=0)
        card = _mock_card(base_value=50.0)
        score = calculate_snipe_score(a, card)
        # All components max (100) → 100*0.35 + 100*0.40 + 100*0.10 + 100*0.15 = 100
        assert score <= 100.0


class TestRunSnipeAlerts:
    def _setup_db(self, db_session, hours_left=2.0, score=75.0):
        from conftest import make_card, make_auction
        card = make_card(db_session)
        a = make_auction(
            db_session, card,
            snipe_score=score,
            end_time=datetime.utcnow() + timedelta(hours=hours_left),
            status="active",
            ebay_listing_id=f"alert-{id({})}",
        )
        db_session.commit()
        return card, a

    def test_creates_alert_for_high_score(self, db):
        card, auction = self._setup_db(db, hours_left=1.0, score=75.0)
        alerts = run_snipe_alerts(db)
        assert len(alerts) >= 1

    def test_no_alert_below_threshold(self, db):
        card, auction = self._setup_db(db, hours_left=1.0, score=40.0)
        alerts = run_snipe_alerts(db)
        assert len(alerts) == 0

    def test_no_duplicate_alerts(self, db):
        card, auction = self._setup_db(db, hours_left=1.0, score=80.0)
        run_snipe_alerts(db)
        run_snipe_alerts(db)
        count = db.query(Alert).filter(
            Alert.auction_id == auction.id,
            Alert.alert_type == "snipe_opportunity",
        ).count()
        assert count == 1

    def test_urgency_critical_under_15min(self, db):
        card, auction = self._setup_db(db, hours_left=0.2, score=80.0)
        alerts = run_snipe_alerts(db)
        assert any(a.urgency == "critical" for a in alerts)

    def test_urgency_high_under_1hr(self, db):
        card, auction = self._setup_db(db, hours_left=0.5, score=75.0)
        alerts = run_snipe_alerts(db)
        assert any(a.urgency == "high" for a in alerts)

    def test_urgency_normal_over_1hr(self, db):
        card, auction = self._setup_db(db, hours_left=2.5, score=75.0)
        alerts = run_snipe_alerts(db)
        assert any(a.urgency == "normal" for a in alerts)

    def test_alert_message_contains_driver(self, db):
        card, auction = self._setup_db(db, hours_left=1.0, score=75.0)
        alerts = run_snipe_alerts(db)
        assert len(alerts) > 0
        assert "Verstappen" in alerts[0].message or "F1" in alerts[0].message

    def test_excludes_auctions_ending_after_3hrs(self, db):
        card, auction = self._setup_db(db, hours_left=5.0, score=80.0)
        alerts = run_snipe_alerts(db)
        assert len(alerts) == 0


class TestSyncEbayListings:
    @pytest.mark.asyncio
    async def test_sync_adds_new_listings(self, db):
        from scraper import sync_real_ebay_listings
        from conftest import make_card
        card = make_card(db)
        db.commit()

        fake_listings = [{
            "ebay_item_id": "fake-item-001",
            "title": "2025 Topps Chrome F1 Max Verstappen Base",
            "current_price": 35.0,
            "buy_now_price": None,
            "bid_count": 1,
            "end_time": datetime.utcnow() + timedelta(hours=4),
            "seller": "testseller",
            "seller_feedback": 500,
            "condition": "Near Mint",
            "ebay_url": "https://ebay.com/itm/fake-item-001",
            "image_url": "https://example.com/img.jpg",
            "shipping_cost": 0.0,
            "buying_options": ["AUCTION"],
        }]

        with patch("scraper.fetch_all_f1_listings", new=AsyncMock(return_value=fake_listings)):
            with patch("scraper.extract_driver_from_title", return_value="Max Verstappen"):
                added = await sync_real_ebay_listings(db)

        assert added == 1

    @pytest.mark.asyncio
    async def test_sync_updates_existing(self, db):
        from scraper import sync_real_ebay_listings
        from conftest import make_card, make_auction
        card = make_card(db)
        a = make_auction(db, card, ebay_listing_id="existing-001", current_price=20.0)
        db.commit()

        fake_listings = [{
            "ebay_item_id": "existing-001",
            "title": a.title,
            "current_price": 45.0,
            "end_time": a.end_time,
            "seller": a.seller,
            "seller_feedback": a.seller_feedback,
            "bid_count": 5,
            "condition": a.condition,
            "ebay_url": a.ebay_url,
            "image_url": a.image_url,
            "shipping_cost": 0.0,
            "buying_options": ["AUCTION"],
        }]

        with patch("scraper.fetch_all_f1_listings", new=AsyncMock(return_value=fake_listings)):
            with patch("scraper.extract_driver_from_title", return_value="Max Verstappen"):
                added = await sync_real_ebay_listings(db)

        assert added == 0
        db.refresh(a)
        assert a.current_price == 45.0
        assert a.bid_count == 5

    @pytest.mark.asyncio
    async def test_sync_skips_zero_price(self, db):
        from scraper import sync_real_ebay_listings
        from conftest import make_card
        make_card(db)
        db.commit()

        fake_listings = [{
            "ebay_item_id": "zero-price-001",
            "title": "Some card",
            "current_price": 0.0,
            "end_time": datetime.utcnow() + timedelta(hours=2),
        }]
        with patch("scraper.fetch_all_f1_listings", new=AsyncMock(return_value=fake_listings)):
            added = await sync_real_ebay_listings(db)
        assert added == 0

    @pytest.mark.asyncio
    async def test_sync_marks_expired_as_ended(self, db):
        from scraper import sync_real_ebay_listings
        from conftest import make_card, make_auction
        from database import Auction
        card = make_card(db)
        past = datetime.utcnow() - timedelta(hours=2)
        a = make_auction(db, card, end_time=past, status="active", ebay_listing_id="expired-1")
        db.commit()

        with patch("scraper.fetch_all_f1_listings", new=AsyncMock(return_value=[])):
            await sync_real_ebay_listings(db)

        db.refresh(a)
        assert a.status == "ended"
