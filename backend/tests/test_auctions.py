"""
Unit + integration tests for /api/auctions endpoints.
"""
import pytest
import json
from datetime import datetime, timedelta
from conftest import make_card, make_auction


class TestListAuctions:
    def test_empty_returns_zero(self, client):
        r = client.get("/api/auctions")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 0
        assert body["auctions"] == []

    def test_returns_active_by_default(self, client, db):
        card = make_card(db)
        make_auction(db, card, status="active", ebay_listing_id="e1")
        make_auction(db, card, status="ended", ebay_listing_id="e2")
        db.commit()
        r = client.get("/api/auctions")
        assert r.json()["total"] == 1

    def test_status_filter_ended(self, client, db):
        card = make_card(db)
        make_auction(db, card, status="active", ebay_listing_id="e1")
        make_auction(db, card, status="ended", ebay_listing_id="e2")
        db.commit()
        r = client.get("/api/auctions?status=ended")
        assert r.json()["total"] == 1

    def test_driver_filter(self, client, db):
        card_max = make_card(db, driver_name="Max Verstappen")
        card_lew = make_card(db, driver_name="Lewis Hamilton", card_number="2")
        make_auction(db, card_max, ebay_listing_id="e1")
        make_auction(db, card_lew, ebay_listing_id="e2")
        db.commit()
        r = client.get("/api/auctions?driver=lewis")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["auctions"][0]["card"]["driver_name"] == "Lewis Hamilton"

    def test_snipe_only_filter(self, client, db):
        card = make_card(db)
        make_auction(db, card, snipe_eligible=True, ebay_listing_id="e1", snipe_score=75.0)
        make_auction(db, card, snipe_eligible=False, ebay_listing_id="e2", snipe_score=20.0)
        db.commit()
        r = client.get("/api/auctions?snipe_only=true")
        assert r.json()["total"] == 1

    def test_sorted_by_snipe_score_desc(self, client, db):
        card = make_card(db)
        make_auction(db, card, snipe_score=40.0, ebay_listing_id="low")
        make_auction(db, card, snipe_score=90.0, ebay_listing_id="high")
        make_auction(db, card, snipe_score=60.0, ebay_listing_id="mid")
        db.commit()
        auctions = client.get("/api/auctions").json()["auctions"]
        scores = [a["snipe_score"] for a in auctions]
        assert scores == sorted(scores, reverse=True)

    def test_limit_and_offset(self, client, db):
        card = make_card(db)
        for i in range(8):
            make_auction(db, card, ebay_listing_id=f"e{i}", snipe_score=float(i))
        db.commit()
        r = client.get("/api/auctions?limit=3&offset=2")
        assert len(r.json()["auctions"]) == 3

    def test_auction_dict_has_time_left(self, client, db):
        card = make_card(db)
        future = datetime.utcnow() + timedelta(hours=2)
        make_auction(db, card, end_time=future, ebay_listing_id="e1")
        db.commit()
        auction = client.get("/api/auctions").json()["auctions"][0]
        assert "time_left" in auction
        assert auction["time_left"] > 0

    def test_time_left_zero_for_past_end(self, client, db):
        card = make_card(db)
        past = datetime.utcnow() - timedelta(hours=1)
        make_auction(db, card, end_time=past, status="active", ebay_listing_id="e-past")
        db.commit()
        auction = client.get("/api/auctions").json()["auctions"][0]
        assert auction["time_left"] == 0

    def test_buying_options_parsed_from_json(self, client, db):
        card = make_card(db)
        make_auction(db, card, ebay_listing_id="e1", buying_options='["AUCTION","BEST_OFFER"]')
        db.commit()
        auction = client.get("/api/auctions").json()["auctions"][0]
        assert isinstance(auction["buying_options"], list)
        assert "AUCTION" in auction["buying_options"]

    def test_null_buying_options_returns_empty_list(self, client, db):
        card = make_card(db)
        make_auction(db, card, ebay_listing_id="e1", buying_options=None)
        db.commit()
        auction = client.get("/api/auctions").json()["auctions"][0]
        assert auction["buying_options"] == []


class TestGetAuction:
    def test_get_existing(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, current_price=42.0, ebay_listing_id="e1")
        db.commit()
        r = client.get(f"/api/auctions/{a.id}")
        assert r.status_code == 200
        assert r.json()["current_price"] == 42.0

    def test_get_nonexistent_404(self, client):
        r = client.get("/api/auctions/99999")
        assert r.status_code == 404

    def test_includes_card_info(self, client, db):
        card = make_card(db, driver_name="Lando Norris", parallel="Gold")
        a = make_auction(db, card, ebay_listing_id="e1")
        db.commit()
        body = client.get(f"/api/auctions/{a.id}").json()
        assert body["card"]["driver_name"] == "Lando Norris"
        assert body["card"]["parallel"] == "Gold"


class TestSnipeTargets:
    def test_returns_only_eligible(self, client, db):
        card = make_card(db)
        future = datetime.utcnow() + timedelta(hours=1)
        make_auction(db, card, snipe_eligible=True, ebay_listing_id="s1",
                     snipe_score=80.0, end_time=future)
        make_auction(db, card, snipe_eligible=False, ebay_listing_id="s2",
                     snipe_score=30.0, end_time=future)
        db.commit()
        r = client.get("/api/auctions/snipe/targets")
        assert r.status_code == 200
        targets = r.json()["targets"]
        assert len(targets) == 1
        assert targets[0]["snipe_eligible"] is True

    def test_excludes_ended_auctions(self, client, db):
        card = make_card(db)
        past = datetime.utcnow() - timedelta(hours=1)
        make_auction(db, card, snipe_eligible=True, ebay_listing_id="ended1",
                     end_time=past, status="active")
        db.commit()
        r = client.get("/api/auctions/snipe/targets")
        assert len(r.json()["targets"]) == 0

    def test_max_20_targets(self, client, db):
        card = make_card(db)
        future = datetime.utcnow() + timedelta(hours=2)
        for i in range(25):
            make_auction(db, card, snipe_eligible=True,
                         ebay_listing_id=f"t{i}", snipe_score=70.0, end_time=future)
        db.commit()
        targets = client.get("/api/auctions/snipe/targets").json()["targets"]
        assert len(targets) <= 20


class TestWatchlistToggle:
    def test_toggle_to_watchlist(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, status="active", ebay_listing_id="e1")
        db.commit()
        r = client.post(f"/api/auctions/{a.id}/watchlist")
        assert r.status_code == 200
        assert r.json()["watching"] is True
        assert r.json()["status"] == "watchlist"

    def test_toggle_back_to_active(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, status="watchlist", ebay_listing_id="e1")
        db.commit()
        r = client.post(f"/api/auctions/{a.id}/watchlist")
        assert r.status_code == 200
        assert r.json()["watching"] is False
        assert r.json()["status"] == "active"

    def test_toggle_nonexistent_404(self, client):
        r = client.post("/api/auctions/99999/watchlist")
        assert r.status_code == 404


class TestSellerEndpoint:
    def test_seller_tier_top_rated(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, seller="goodseller", seller_feedback=2000, ebay_listing_id="e1")
        db.commit()
        r = client.get(f"/api/auctions/{a.id}/seller")
        assert r.status_code == 200
        body = r.json()
        assert body["tier"] == "Top Rated"
        assert body["feedback_score"] == 2000

    def test_seller_tier_new(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, seller="newseller", seller_feedback=5, ebay_listing_id="e1")
        db.commit()
        r = client.get(f"/api/auctions/{a.id}/seller")
        body = r.json()
        assert body["tier"] == "New"

    def test_seller_tier_top_rated_plus(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, seller="megaseller", seller_feedback=15000, ebay_listing_id="e1")
        db.commit()
        r = client.get(f"/api/auctions/{a.id}/seller")
        assert r.json()["tier"] == "Top Rated Plus"

    def test_seller_nonexistent_404(self, client):
        r = client.get("/api/auctions/99999/seller")
        assert r.status_code == 404


class TestBidHistory:
    def test_returns_bid_history_structure(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, bid_count=5, ebay_listing_id="e1")
        db.commit()
        r = client.get(f"/api/auctions/{a.id}/bid-history")
        assert r.status_code == 200
        body = r.json()
        assert body["total_bids"] == 5
        assert "bid_history" in body
        assert len(body["bid_history"]) <= 10

    def test_zero_bids_empty_history(self, client, db):
        card = make_card(db)
        a = make_auction(db, card, bid_count=0, ebay_listing_id="e1")
        db.commit()
        r = client.get(f"/api/auctions/{a.id}/bid-history")
        assert r.json()["total_bids"] == 0
        assert r.json()["bid_history"] == []

    def test_bid_history_nonexistent_404(self, client):
        r = client.get("/api/auctions/99999/bid-history")
        assert r.status_code == 404
