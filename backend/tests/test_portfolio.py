"""
Unit + integration tests for /api/portfolio endpoints.
"""
import pytest
from conftest import make_card


class TestListPortfolio:
    def test_empty_portfolio(self, client):
        r = client.get("/api/portfolio")
        assert r.status_code == 200
        assert r.json()["items"] == []

    def test_returns_added_items(self, client, db):
        card = make_card(db)
        db.commit()
        client.post("/api/portfolio", json={
            "card_id": card.id,
            "purchase_price": 45.0,
            "quantity": 1,
        })
        r = client.get("/api/portfolio")
        assert len(r.json()["items"]) == 1

    def test_item_contains_card_info(self, client, db):
        card = make_card(db, driver_name="Carlos Sainz", parallel="Refractor")
        db.commit()
        client.post("/api/portfolio", json={"card_id": card.id, "purchase_price": 25.0})
        item = client.get("/api/portfolio").json()["items"][0]
        assert item["card"]["driver_name"] == "Carlos Sainz"
        assert item["card"]["parallel"] == "Refractor"


class TestAddToPortfolio:
    def test_add_valid_card(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/portfolio", json={
            "card_id": card.id,
            "purchase_price": 35.0,
            "quantity": 2,
            "notes": "Great deal",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["purchase_price"] == 35.0
        assert body["quantity"] == 2
        assert body["notes"] == "Great deal"

    def test_add_invalid_card_404(self, client):
        r = client.post("/api/portfolio", json={
            "card_id": 99999,
            "purchase_price": 10.0,
        })
        assert r.status_code == 404

    def test_current_value_set_to_base_value(self, client, db):
        card = make_card(db, base_value=80.0)
        db.commit()
        r = client.post("/api/portfolio", json={"card_id": card.id, "purchase_price": 50.0})
        assert r.json()["current_value"] == 80.0

    def test_purchase_date_populated(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/portfolio", json={"card_id": card.id, "purchase_price": 20.0})
        assert r.json()["purchase_date"] is not None

    def test_missing_purchase_price_422(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/portfolio", json={"card_id": card.id})
        assert r.status_code == 422

    def test_quantity_defaults_to_1(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/portfolio", json={"card_id": card.id, "purchase_price": 20.0})
        assert r.json()["quantity"] == 1


class TestRemoveFromPortfolio:
    def test_remove_existing(self, client, db):
        card = make_card(db)
        db.commit()
        post_r = client.post("/api/portfolio", json={"card_id": card.id, "purchase_price": 20.0})
        item_id = post_r.json()["id"]
        r = client.delete(f"/api/portfolio/{item_id}")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # Verify it's gone
        assert client.get("/api/portfolio").json()["items"] == []

    def test_remove_nonexistent_404(self, client):
        r = client.delete("/api/portfolio/99999")
        assert r.status_code == 404

    def test_multiple_items_only_removes_target(self, client, db):
        card1 = make_card(db, card_number="1")
        card2 = make_card(db, card_number="2")
        db.commit()
        r1 = client.post("/api/portfolio", json={"card_id": card1.id, "purchase_price": 10.0})
        client.post("/api/portfolio", json={"card_id": card2.id, "purchase_price": 20.0})
        client.delete(f"/api/portfolio/{r1.json()['id']}")
        remaining = client.get("/api/portfolio").json()["items"]
        assert len(remaining) == 1
        assert remaining[0]["card_id"] == card2.id
