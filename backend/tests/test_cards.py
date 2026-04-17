"""
Unit + integration tests for /api/cards endpoints.
"""
import pytest
from conftest import make_card, make_auction


class TestListCards:
    def test_empty_db_returns_zero(self, client):
        r = client.get("/api/cards")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 0
        assert body["cards"] == []

    def test_returns_seeded_cards(self, client, db):
        make_card(db, driver_name="Lewis Hamilton")
        make_card(db, driver_name="Charles Leclerc")
        db.commit()
        r = client.get("/api/cards")
        assert r.status_code == 200
        assert r.json()["total"] == 2

    def test_filter_by_driver(self, client, db):
        make_card(db, driver_name="Lewis Hamilton")
        make_card(db, driver_name="Max Verstappen")
        db.commit()
        r = client.get("/api/cards?driver=lewis")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["cards"][0]["driver_name"] == "Lewis Hamilton"

    def test_filter_by_parallel(self, client, db):
        make_card(db, parallel="Base")
        make_card(db, parallel="Gold")
        db.commit()
        r = client.get("/api/cards?parallel=Gold")
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_filter_by_grade(self, client, db):
        make_card(db, grade="Raw")
        make_card(db, grade="PSA 10")
        db.commit()
        r = client.get("/api/cards?grade=PSA+10")
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_pagination_limit(self, client, db):
        for i in range(10):
            make_card(db, card_number=str(i))
        db.commit()
        r = client.get("/api/cards?limit=3")
        assert r.status_code == 200
        assert len(r.json()["cards"]) == 3

    def test_pagination_offset(self, client, db):
        for i in range(5):
            make_card(db, card_number=str(i), driver_name=f"Driver {i}")
        db.commit()
        r_all = client.get("/api/cards?limit=5&offset=0").json()["cards"]
        r_offset = client.get("/api/cards?limit=5&offset=2").json()["cards"]
        assert len(r_offset) == 3
        assert r_offset[0]["driver_name"] == r_all[2]["driver_name"]

    def test_limit_capped_at_500(self, client):
        r = client.get("/api/cards?limit=999")
        assert r.status_code == 422  # validation error from Query(le=500)


class TestGetCard:
    def test_get_existing_card(self, client, db):
        card = make_card(db, driver_name="Lando Norris", base_value=35.0)
        db.commit()
        r = client.get(f"/api/cards/{card.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["driver_name"] == "Lando Norris"
        assert body["base_value"] == 35.0

    def test_get_nonexistent_card_404(self, client):
        r = client.get("/api/cards/99999")
        assert r.status_code == 404

    def test_card_fields_present(self, client, db):
        card = make_card(db)
        db.commit()
        body = client.get(f"/api/cards/{card.id}").json()
        required = ["id", "driver_name", "year", "parallel", "grade", "base_value",
                    "investment_score", "team", "team_color", "career_wins", "championships"]
        for field in required:
            assert field in body, f"Missing field: {field}"


class TestDriversSummary:
    def test_returns_list(self, client, db):
        make_card(db, driver_name="Max Verstappen", parallel="Base", grade="Raw")
        db.commit()
        r = client.get("/api/cards/drivers-summary")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sorted_by_investment_score_desc(self, client, db):
        make_card(db, driver_name="A Driver", investment_score=90.0, parallel="Base", grade="Raw")
        make_card(db, driver_name="B Driver", investment_score=50.0, parallel="Base", grade="Raw")
        db.commit()
        result = client.get("/api/cards/drivers-summary").json()
        scores = [d["investment_score"] for d in result]
        assert scores == sorted(scores, reverse=True)

    def test_active_auction_count(self, client, db):
        card = make_card(db, parallel="Base", grade="Raw")
        make_auction(db, card, status="active", ebay_listing_id="ebay-1")
        make_auction(db, card, status="ended", ebay_listing_id="ebay-2")
        db.commit()
        result = client.get("/api/cards/drivers-summary").json()
        entry = next(d for d in result if d["driver_name"] == card.driver_name)
        assert entry["active_auctions"] == 1

    def test_parallels_breakdown(self, client, db):
        make_card(db, driver_name="Hamilton", parallel="Base", grade="Raw", base_value=20.0)
        make_card(db, driver_name="Hamilton", parallel="Base", grade="PSA 10", base_value=60.0)
        db.commit()
        result = client.get("/api/cards/drivers-summary").json()
        entry = next(d for d in result if d["driver_name"] == "Hamilton")
        assert len(entry["parallels"]) >= 1
        base_par = next(p for p in entry["parallels"] if p["parallel"] == "Base")
        assert base_par["raw_value"] == 20.0
        assert base_par["psa10_value"] == 60.0


class TestPriceHistory:
    def test_empty_history(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.get(f"/api/cards/{card.id}/price-history")
        assert r.status_code == 200
        assert r.json()["history"] == []

    def test_history_with_records(self, client, db):
        from datetime import datetime
        from database import PriceHistory
        card = make_card(db)
        db.add(PriceHistory(card_id=card.id, price=45.0, sale_date=datetime.utcnow(), source="eBay"))
        db.add(PriceHistory(card_id=card.id, price=55.0, sale_date=datetime.utcnow(), source="eBay"))
        db.commit()
        r = client.get(f"/api/cards/{card.id}/price-history")
        assert r.status_code == 200
        assert len(r.json()["history"]) == 2
