"""
Unit + integration tests for /api/wishlist endpoints.
"""
import pytest
from conftest import make_card


class TestListWishlist:
    def test_empty_wishlist(self, client):
        r = client.get("/api/wishlist")
        assert r.status_code == 200
        assert r.json()["items"] == []

    def test_sorted_by_priority_desc(self, client, db):
        card1 = make_card(db, card_number="1")
        card2 = make_card(db, card_number="2")
        card3 = make_card(db, card_number="3")
        db.commit()
        for card, priority in [(card1, 1), (card2, 5), (card3, 3)]:
            client.post("/api/wishlist", json={
                "card_id": card.id, "max_price": 50.0, "priority": priority
            })
        items = client.get("/api/wishlist").json()["items"]
        priorities = [i["priority"] for i in items]
        assert priorities == sorted(priorities, reverse=True)


class TestAddToWishlist:
    def test_add_valid_item(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/wishlist", json={
            "card_id": card.id,
            "max_price": 100.0,
            "priority": 4,
            "auto_snipe": True,
            "notes": "Must have",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["max_price"] == 100.0
        assert body["priority"] == 4
        assert body["auto_snipe"] is True
        assert body["notes"] == "Must have"

    def test_add_invalid_card_404(self, client):
        r = client.post("/api/wishlist", json={"card_id": 99999, "max_price": 50.0})
        assert r.status_code == 404

    def test_duplicate_returns_existing(self, client, db):
        card = make_card(db)
        db.commit()
        r1 = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 50.0})
        r2 = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 99.0})
        assert r1.json()["id"] == r2.json()["id"]
        # Only one item should exist
        assert len(client.get("/api/wishlist").json()["items"]) == 1

    def test_priority_defaults_to_3(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 30.0})
        assert r.json()["priority"] == 3

    def test_auto_snipe_defaults_false(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 30.0})
        assert r.json()["auto_snipe"] is False

    def test_includes_card_base_value(self, client, db):
        card = make_card(db, base_value=65.0)
        db.commit()
        r = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 50.0})
        assert r.json()["card"]["base_value"] == 65.0

    def test_missing_max_price_422(self, client, db):
        card = make_card(db)
        db.commit()
        r = client.post("/api/wishlist", json={"card_id": card.id})
        assert r.status_code == 422


class TestUpdateWishlistItem:
    def test_update_max_price(self, client, db):
        card = make_card(db)
        db.commit()
        item_id = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 30.0}).json()["id"]
        r = client.patch(f"/api/wishlist/{item_id}", json={"max_price": 75.0})
        assert r.status_code == 200
        assert r.json()["max_price"] == 75.0

    def test_update_auto_snipe(self, client, db):
        card = make_card(db)
        db.commit()
        item_id = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 30.0}).json()["id"]
        r = client.patch(f"/api/wishlist/{item_id}", json={"auto_snipe": True})
        assert r.json()["auto_snipe"] is True

    def test_update_priority(self, client, db):
        card = make_card(db)
        db.commit()
        item_id = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 30.0}).json()["id"]
        r = client.patch(f"/api/wishlist/{item_id}", json={"priority": 5})
        assert r.json()["priority"] == 5

    def test_update_nonexistent_404(self, client):
        r = client.patch("/api/wishlist/99999", json={"max_price": 10.0})
        assert r.status_code == 404

    def test_partial_update_preserves_other_fields(self, client, db):
        card = make_card(db)
        db.commit()
        item_id = client.post("/api/wishlist", json={
            "card_id": card.id, "max_price": 30.0, "priority": 4, "auto_snipe": True
        }).json()["id"]
        r = client.patch(f"/api/wishlist/{item_id}", json={"max_price": 99.0})
        body = r.json()
        assert body["priority"] == 4
        assert body["auto_snipe"] is True


class TestDeleteWishlistItem:
    def test_delete_existing(self, client, db):
        card = make_card(db)
        db.commit()
        item_id = client.post("/api/wishlist", json={"card_id": card.id, "max_price": 30.0}).json()["id"]
        r = client.delete(f"/api/wishlist/{item_id}")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert client.get("/api/wishlist").json()["items"] == []

    def test_delete_nonexistent_404(self, client):
        r = client.delete("/api/wishlist/99999")
        assert r.status_code == 404
