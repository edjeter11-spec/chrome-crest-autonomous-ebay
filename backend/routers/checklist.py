"""2025 Topps Chrome F1 set checklist with live valuations."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db, SoldCard, Auction, Card
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/checklist", tags=["checklist"])

# Synthesized 2025 Topps Chrome F1 base set checklist.
# Cards 1-30 = 2025 F1 drivers (numbered roughly by tier/team), 31-60 = F2/F3,
# 61-80 = Legends, 81-200 = Inserts placeholder.
F1_CHECKLIST_ORDER = [
    "Max Verstappen", "Lando Norris", "Charles Leclerc", "Oscar Piastri",
    "George Russell", "Lewis Hamilton", "Fernando Alonso", "Carlos Sainz",
    "Andrea Kimi Antonelli", "Liam Lawson", "Yuki Tsunoda", "Pierre Gasly",
    "Alexander Albon", "Esteban Ocon", "Lance Stroll", "Nico Hulkenberg",
    "Isack Hadjar", "Oliver Bearman", "Franco Colapinto", "Gabriel Bortoleto",
    "Jack Doohan", "Sergio Perez", "Valtteri Bottas", "Zhou Guanyu",
    "Daniel Ricciardo",
]

F2_CHECKLIST_ORDER = [
    "Leonardo Fornaroli", "Arvid Lindblad", "Luke Browning", "Victor Martins",
    "Pepe Marti", "Dino Beganovic", "Jak Crawford", "Gabriele Mini",
    "Alexander Dunne", "Richard Verschoor",
]

F3_CHECKLIST_ORDER = [
    "Tuukka Taponen", "Ugo Ugochukwu", "James Wharton", "Louis Sharp",
    "Callum Voisin", "Nikita Bedrin", "Nikola Tsolov", "Charlie Wurz",
    "Christian Mansell", "Rafael Camara",
]

LEGENDS_CHECKLIST_ORDER = [
    "Michael Schumacher", "Ayrton Senna", "Alain Prost", "Sebastian Vettel",
    "Kimi Raikkonen", "Niki Lauda", "Nigel Mansell", "Mika Hakkinen",
    "Jackie Stewart", "Damon Hill",
]

# Insert sets for the higher card numbers
INSERT_SETS = [
    "Speed Wheels", "Neon Nations", "Floor It", "Vegas at Night",
    "Diamond 75th", "Helix", "Ultrasonic", "Top Speed", "The Grail",
    "Futuro", "Four & More", "Checker Flag",
]


def _build_checklist() -> list:
    out = []
    num = 1
    # 1-25 F1 drivers, base
    for d in F1_CHECKLIST_ORDER:
        out.append({"card_num": num, "driver": d, "parallel": "Base", "category": "F1"})
        num += 1
    # 26-35 F2
    for d in F2_CHECKLIST_ORDER:
        out.append({"card_num": num, "driver": d, "parallel": "Base", "category": "F2"})
        num += 1
    # 36-45 F3
    for d in F3_CHECKLIST_ORDER:
        out.append({"card_num": num, "driver": d, "parallel": "Base", "category": "F3"})
        num += 1
    # 46-55 Legends
    for d in LEGENDS_CHECKLIST_ORDER:
        out.append({"card_num": num, "driver": d, "parallel": "Base", "category": "Legends"})
        num += 1
    # 56-200 insert slots — cycle drivers × inserts
    all_drivers = F1_CHECKLIST_ORDER[:15]  # top 15 get insert appearances
    insert_i = 0
    driver_i = 0
    while num <= 200:
        driver = all_drivers[driver_i % len(all_drivers)]
        parallel = INSERT_SETS[insert_i % len(INSERT_SETS)]
        category = "Insert"
        out.append({"card_num": num, "driver": driver, "parallel": parallel, "category": category})
        num += 1
        driver_i += 1
        if driver_i % len(all_drivers) == 0:
            insert_i += 1
    return out


@router.get("/2025-topps-chrome-f1")
def chrome_f1_checklist(db: Session = Depends(get_db)):
    checklist = _build_checklist()

    # Batch fetch avg prices + on-market status for efficiency
    since = datetime.utcnow() - timedelta(days=30)

    # Latest avg price per (driver, parallel) over 30 days
    rows = db.query(
        SoldCard.driver_name,
        SoldCard.parallel,
        func.avg(SoldCard.sale_price).label("avg_p"),
        func.count(SoldCard.id).label("cnt"),
    ).filter(
        SoldCard.driver_name.isnot(None),
        SoldCard.sale_date >= since,
        SoldCard.sale_price > 0,
    ).group_by(SoldCard.driver_name, SoldCard.parallel).all()

    price_map: dict = {}
    count_map: dict = {}
    for r in rows:
        key = ((r.driver_name or "").lower(), (r.parallel or "").lower())
        price_map[key] = round(float(r.avg_p or 0), 2)
        count_map[key] = int(r.cnt or 0)

    # Also compute a "driver-only" fallback avg for when the specific parallel is empty
    driver_only = db.query(
        SoldCard.driver_name,
        func.avg(SoldCard.sale_price).label("avg_p"),
    ).filter(
        SoldCard.driver_name.isnot(None),
        SoldCard.sale_date >= since,
        SoldCard.sale_price > 0,
    ).group_by(SoldCard.driver_name).all()
    driver_price: dict = {(r.driver_name or "").lower(): round(float(r.avg_p or 0), 2) for r in driver_only}

    # On-market — for each driver/parallel, any active auction?
    live_rows = db.query(Card.driver_name, Card.parallel, func.count(Auction.id))\
        .join(Auction, Auction.card_id == Card.id)\
        .filter(Auction.status == "active")\
        .group_by(Card.driver_name, Card.parallel).all()
    live_map = {((r[0] or "").lower(), (r[1] or "").lower()): int(r[2] or 0) for r in live_rows}

    out = []
    total_avg_all = 0.0
    for row in checklist:
        key = ((row["driver"] or "").lower(), (row["parallel"] or "").lower())
        avg = price_map.get(key) or driver_price.get(key[0]) or 0
        cnt = count_map.get(key, 0)
        live_count = live_map.get(key, 0)
        total_avg_all += avg
        out.append({
            **row,
            "latest_avg_price": avg,
            "sold_count_30d": cnt,
            "on_market_now": live_count > 0,
            "live_count": live_count,
        })
    return {
        "set": "2025 Topps Chrome F1",
        "total_cards": len(out),
        "total_market_value": round(total_avg_all, 2),
        "cards": out,
    }
