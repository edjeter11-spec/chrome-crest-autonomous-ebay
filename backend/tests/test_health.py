"""
Tests for health, status, and WebSocket endpoints.
"""
import pytest


class TestHealthEndpoint:
    def test_health_ok(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert "service" in body
        assert "ebay_connected" in body

    def test_health_service_name(self, client):
        body = client.get("/api/health").json()
        assert "F1" in body["service"]


class TestEbayStatus:
    def test_ebay_status_endpoint(self, client):
        r = client.get("/api/ebay-status")
        assert r.status_code == 200
        body = r.json()
        assert "connected" in body
        assert "message" in body

    def test_no_credentials_not_connected(self, client):
        # In test env no real eBay creds are set
        body = client.get("/api/ebay-status").json()
        assert body["connected"] is False


class TestWebSocket:
    def test_websocket_connects_and_sends_data(self, client):
        with client.websocket_connect("/ws") as ws:
            data = ws.receive_json()
            assert data["type"] == "auction_update"
            assert "data" in data
            assert "alerts" in data
            assert "timestamp" in data
            assert "ebay_connected" in data

    def test_websocket_data_is_list(self, client):
        with client.websocket_connect("/ws") as ws:
            data = ws.receive_json()
            assert isinstance(data["data"], list)

    def test_websocket_auction_fields(self, client, db):
        from conftest import make_card, make_auction
        from datetime import timedelta, datetime
        card = make_card(db)
        make_auction(db, card, status="active", ebay_listing_id="ws-test-1")
        db.commit()
        with client.websocket_connect("/ws") as ws:
            data = ws.receive_json()
            if data["data"]:
                auction = data["data"][0]
                for field in ["id", "title", "current_price", "time_left", "snipe_score"]:
                    assert field in auction, f"Missing field: {field}"
