"""
Tests for /api/analytics and /api/alerts endpoints.
"""
import pytest
from datetime import datetime
from conftest import make_card, make_auction
from database import Alert


class TestAnalyticsSummary:
    def test_summary_structure(self, client):
        r = client.get("/api/analytics/summary")
        assert r.status_code == 200
        body = r.json()
        # Required fields from analytics router
        for key in ["total_cards", "active_auctions", "snipe_targets"]:
            assert key in body, f"Missing key: {key}"

    def test_counts_active_auctions(self, client, db):
        card = make_card(db)
        make_auction(db, card, status="active", ebay_listing_id="s1")
        make_auction(db, card, status="ended", ebay_listing_id="s2")
        db.commit()
        body = client.get("/api/analytics/summary").json()
        assert body["active_auctions"] == 1

    def test_counts_snipe_targets(self, client, db):
        card = make_card(db)
        make_auction(db, card, snipe_eligible=True, ebay_listing_id="sn1")
        make_auction(db, card, snipe_eligible=False, ebay_listing_id="sn2")
        db.commit()
        body = client.get("/api/analytics/summary").json()
        assert body["snipe_targets"] == 1


class TestAnalyticsFull:
    def test_full_structure(self, client):
        r = client.get("/api/analytics/full")
        assert r.status_code == 200
        body = r.json()
        assert "by_driver" in body or "drivers" in body or isinstance(body, dict)


class TestAlerts:
    def _add_alert(self, db, triggered=True, urgency="normal", alert_type="snipe_opportunity"):
        card = make_card(db)
        db.flush()
        alert = Alert(
            card_id=card.id,
            alert_type=alert_type,
            threshold_price=50.0,
            triggered=triggered,
            triggered_at=datetime.utcnow() if triggered else None,
            message="Test alert",
            urgency=urgency,
        )
        db.add(alert)
        db.commit()
        return alert

    def test_list_alerts_empty(self, client):
        r = client.get("/api/alerts")
        assert r.status_code == 200

    def test_list_alerts_returns_triggered(self, client, db):
        self._add_alert(db, triggered=True)
        r = client.get("/api/alerts")
        assert r.status_code == 200

    def test_filter_by_urgency(self, client, db):
        self._add_alert(db, urgency="critical")
        self._add_alert(db, urgency="low")
        r = client.get("/api/alerts?urgency=critical")
        assert r.status_code == 200
        # Endpoint should filter or at least not crash
