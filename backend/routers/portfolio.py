from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db, Portfolio, Card, SoldCard
from datetime import datetime, timedelta
from typing import Optional
from lib.auth import get_user_id, require_user_id

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _latest_avg_value(db: Session, driver: str | None, parallel: str | None, grade: str | None) -> float | None:
    """Latest avg sold price for the given driver+parallel+grade combo (90-day window)."""
    if not driver:
        return None
    since = datetime.utcnow() - timedelta(days=90)
    q = db.query(func.avg(SoldCard.sale_price)).filter(
        SoldCard.driver_name == driver,
        SoldCard.sale_price > 0,
        SoldCard.sale_date >= since,
    )
    if parallel:
        q = q.filter(SoldCard.parallel == parallel)
    if grade and grade != "Raw":
        q = q.filter(SoldCard.grade.ilike(f"{grade}%"))
    val = q.scalar()
    if val is None and parallel:
        # Loosen: drop parallel filter
        q2 = db.query(func.avg(SoldCard.sale_price)).filter(
            SoldCard.driver_name == driver,
            SoldCard.sale_price > 0,
            SoldCard.sale_date >= since,
        )
        val = q2.scalar()
    return float(val) if val is not None else None


EBAY_FEE_PCT = 0.13
EST_SHIPPING = 4.0


def item_to_dict(p: Portfolio, db: Session) -> dict:
    card = p.card
    live_val = None
    if card:
        live_val = _latest_avg_value(db, card.driver_name, card.parallel, card.grade)
    if live_val is None:
        live_val = p.current_value or (card.base_value if card else 0) or 0
    qty = p.quantity or 1
    cost = (p.purchase_price or 0) * qty
    value = (live_val or 0) * qty
    pnl = value - cost
    pnl_pct = (pnl / cost * 100) if cost > 0 else 0
    # Realistic (net-of-fees) P&L: 13% eBay final value fee + $4 shipping cost per card
    realistic_per_card = (live_val or 0) * (1 - EBAY_FEE_PCT) - EST_SHIPPING
    realistic_value = realistic_per_card * qty
    realistic_pnl = realistic_value - cost
    realistic_pnl_pct = (realistic_pnl / cost * 100) if cost > 0 else 0
    return {
        "id": p.id,
        "card_id": p.card_id,
        "purchase_price": p.purchase_price,
        "purchase_date": p.purchase_date.isoformat() if p.purchase_date else None,
        "current_value": round(live_val or 0, 2),
        "realistic_value": round(realistic_value, 2),
        "realistic_pnl": round(realistic_pnl, 2),
        "realistic_pnl_pct": round(realistic_pnl_pct, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
        "has_valuation": live_val is not None and live_val > 0,
        "quantity": qty,
        "notes": p.notes,
        "ebay_listing_id": p.ebay_listing_id,
        "card": {
            "id": card.id,
            "driver_name": card.driver_name,
            "parallel": card.parallel,
            "grade": card.grade,
            "team": card.team,
            "team_color": card.team_color,
            "image_url": card.image_url,
        } if card else None,
    }


@router.get("")
def list_portfolio(
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    q = db.query(Portfolio)
    if user_id:
        q = q.filter(Portfolio.user_id == user_id)
    else:
        # Anonymous view — show only legacy rows with no owner (backward compatible)
        q = q.filter(Portfolio.user_id.is_(None))
    items = q.all()
    rows = [item_to_dict(i, db) for i in items]
    rows.sort(key=lambda r: r["pnl_pct"], reverse=True)
    return {"items": rows}


@router.post("")
async def add_to_portfolio(
    body: dict,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    """
    Accepts either:
      - {card_id, purchase_price, quantity, notes}
      - {title, driver, parallel, grade, purchase_price, purchase_date, quantity, notes, ebay_item_id?}
    If card_id not provided, matches an existing Card by driver+parallel+grade — else creates one.
    """
    card_id = body.get("card_id")
    if not card_id:
        driver = (body.get("driver") or "").strip()
        parallel = (body.get("parallel") or "").strip() or None
        grade = (body.get("grade") or "Raw").strip()
        if not driver:
            raise HTTPException(400, "driver or card_id required")
        card = db.query(Card).filter(
            Card.driver_name == driver,
            Card.parallel == parallel,
            Card.grade == grade,
        ).first()
        if not card:
            card = Card(
                driver_name=driver,
                parallel=parallel,
                grade=grade,
                year=2025,
                set_name="Topps Chrome F1",
                base_value=float(body.get("purchase_price") or 0),
            )
            db.add(card)
            db.commit()
            db.refresh(card)
        card_id = card.id
    else:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            raise HTTPException(404, "Card not found")

    purchase_date = body.get("purchase_date")
    try:
        pdate = datetime.fromisoformat(purchase_date) if purchase_date else datetime.utcnow()
    except Exception:
        pdate = datetime.utcnow()

    item = Portfolio(
        card_id=card_id,
        purchase_price=float(body.get("purchase_price") or 0),
        purchase_date=pdate,
        current_value=_latest_avg_value(db, card.driver_name, card.parallel, card.grade) or card.base_value or 0,
        quantity=int(body.get("quantity") or 1),
        notes=body.get("notes"),
        ebay_listing_id=body.get("ebay_item_id"),
        user_id=user_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item_to_dict(item, db)


@router.post("/bulk")
def bulk_add(
    body: dict,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    """
    Bulk import from CSV. Accepts {rows: [{driver, parallel, grade, purchase_price,
    purchase_date, quantity, notes}, ...]}. Creates placeholder Cards as needed.
    Returns {inserted, skipped, errors[]}.
    """
    rows = body.get("rows") or []
    inserted = 0
    skipped = 0
    errors: list = []

    for idx, row in enumerate(rows):
        try:
            driver = (row.get("driver") or row.get("driver_name") or "").strip()
            if not driver:
                skipped += 1
                errors.append(f"Row {idx + 1}: missing driver")
                continue
            parallel = (row.get("parallel") or "").strip() or None
            grade = (row.get("grade") or "Raw").strip()
            try:
                purchase_price = float(row.get("purchase_price") or 0)
            except Exception:
                purchase_price = 0.0
            try:
                quantity = int(row.get("quantity") or 1)
            except Exception:
                quantity = 1
            notes = (row.get("notes") or "").strip() or None

            pdate_raw = row.get("purchase_date")
            try:
                if pdate_raw:
                    pdate = datetime.fromisoformat(str(pdate_raw).replace("Z", ""))
                else:
                    pdate = datetime.utcnow()
            except Exception:
                pdate = datetime.utcnow()

            # Find or create card
            card = db.query(Card).filter(
                Card.driver_name == driver,
                Card.parallel == parallel,
                Card.grade == grade,
            ).first()
            if not card:
                card = Card(
                    driver_name=driver,
                    parallel=parallel,
                    grade=grade,
                    year=2025,
                    set_name="Topps Chrome F1",
                    base_value=purchase_price,
                )
                db.add(card)
                db.commit()
                db.refresh(card)

            live_val = _latest_avg_value(db, driver, parallel, grade) or card.base_value or purchase_price
            item = Portfolio(
                card_id=card.id,
                purchase_price=purchase_price,
                purchase_date=pdate,
                current_value=live_val,
                quantity=quantity,
                notes=notes,
                user_id=user_id,
            )
            db.add(item)
            inserted += 1
        except Exception as e:
            skipped += 1
            errors.append(f"Row {idx + 1}: {str(e)[:120]}")

    db.commit()
    return {"inserted": inserted, "skipped": skipped, "errors": errors[:20]}


@router.patch("/{item_id}")
def update_portfolio_item(
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    item = db.query(Portfolio).filter(Portfolio.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    # Ownership check: if the row has an owner, caller must match it
    if item.user_id and item.user_id != user_id:
        raise HTTPException(403, "forbidden")
    allowed = {"quantity", "purchase_price", "notes", "current_value"}
    for k, v in body.items():
        if k in allowed:
            setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item_to_dict(item, db)


@router.delete("/{item_id}")
def remove_from_portfolio(
    item_id: int,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(get_user_id),
):
    item = db.query(Portfolio).filter(Portfolio.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    if item.user_id and item.user_id != user_id:
        raise HTTPException(403, "forbidden")
    db.delete(item)
    db.commit()
    return {"ok": True}
