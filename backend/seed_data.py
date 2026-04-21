"""
Seeds the card catalog (drivers + parallels) only.
Auctions come exclusively from the live eBay API — no fake data.
"""
from sqlalchemy.orm import Session
from database import Card

ALL_DRIVERS = [
    # ── F1 Current Grid ────────────────────────────────────────────────────────
    {"name": "Max Verstappen",      "series": "F1", "rookie": False, "team": "Red Bull Racing",  "team_color": "#3671C6", "nationality": "Dutch",        "tier": "S", "multiplier": 9.0,  "wins": 63,  "championships": 4, "card_num": "101", "score": 97},
    {"name": "Yuki Tsunoda",        "series": "F1", "rookie": False, "team": "Red Bull Racing",  "team_color": "#3671C6", "nationality": "Japanese",     "tier": "C", "multiplier": 2.0,  "wins": 0,   "championships": 0, "card_num": "102", "score": 60},
    {"name": "Charles Leclerc",     "series": "F1", "rookie": False, "team": "Ferrari",           "team_color": "#DC0000", "nationality": "Monegasque",   "tier": "A", "multiplier": 5.5,  "wins": 8,   "championships": 0, "card_num": "103", "score": 84},
    {"name": "Lewis Hamilton",      "series": "F1", "rookie": False, "team": "Ferrari",           "team_color": "#DC0000", "nationality": "British",      "tier": "S", "multiplier": 8.5,  "wins": 103, "championships": 7, "card_num": "104", "score": 95},
    {"name": "Lando Norris",        "series": "F1", "rookie": False, "team": "McLaren",           "team_color": "#FF8000", "nationality": "British",      "tier": "A", "multiplier": 5.0,  "wins": 4,   "championships": 0, "card_num": "105", "score": 83},
    {"name": "Oscar Piastri",       "series": "F1", "rookie": False, "team": "McLaren",           "team_color": "#FF8000", "nationality": "Australian",   "tier": "B", "multiplier": 4.0,  "wins": 2,   "championships": 0, "card_num": "106", "score": 78},
    {"name": "George Russell",      "series": "F1", "rookie": False, "team": "Mercedes",          "team_color": "#00D2BE", "nationality": "British",      "tier": "B", "multiplier": 3.2,  "wins": 2,   "championships": 0, "card_num": "107", "score": 74},
    {"name": "Andrea Kimi Antonelli","series": "F1","rookie": True,  "team": "Mercedes",          "team_color": "#00D2BE", "nationality": "Italian",      "tier": "S", "multiplier": 10.0, "wins": 2,   "championships": 0, "card_num": "108", "score": 99},
    {"name": "Fernando Alonso",     "series": "F1", "rookie": False, "team": "Aston Martin",      "team_color": "#006F62", "nationality": "Spanish",      "tier": "A", "multiplier": 4.5,  "wins": 32,  "championships": 2, "card_num": "109", "score": 82},
    {"name": "Lance Stroll",        "series": "F1", "rookie": False, "team": "Aston Martin",      "team_color": "#006F62", "nationality": "Canadian",     "tier": "C", "multiplier": 1.8,  "wins": 0,   "championships": 0, "card_num": "110", "score": 55},
    {"name": "Liam Lawson",         "series": "F1", "rookie": True,  "team": "Racing Bulls",      "team_color": "#6692FF", "nationality": "New Zealander","tier": "B", "multiplier": 2.5,  "wins": 0,   "championships": 0, "card_num": "111", "score": 72},
    {"name": "Isack Hadjar",        "series": "F1", "rookie": True,  "team": "Racing Bulls",      "team_color": "#6692FF", "nationality": "French",       "tier": "C", "multiplier": 2.0,  "wins": 0,   "championships": 0, "card_num": "112", "score": 61},
    {"name": "Esteban Ocon",        "series": "F1", "rookie": False, "team": "Haas",              "team_color": "#B6BABD", "nationality": "French",       "tier": "C", "multiplier": 1.6,  "wins": 1,   "championships": 0, "card_num": "113", "score": 54},
    {"name": "Oliver Bearman",      "series": "F1", "rookie": True,  "team": "Haas",              "team_color": "#B6BABD", "nationality": "British",      "tier": "C", "multiplier": 2.3,  "wins": 0,   "championships": 0, "card_num": "114", "score": 66},
    {"name": "Franco Colapinto",    "series": "F1", "rookie": True,  "team": "Williams",          "team_color": "#005AFF", "nationality": "Argentine",    "tier": "C", "multiplier": 2.0,  "wins": 0,   "championships": 0, "card_num": "115", "score": 62},
    {"name": "Alexander Albon",     "series": "F1", "rookie": False, "team": "Williams",          "team_color": "#005AFF", "nationality": "Thai",         "tier": "C", "multiplier": 1.9,  "wins": 0,   "championships": 0, "card_num": "116", "score": 58},
    {"name": "Carlos Sainz",        "series": "F1", "rookie": False, "team": "Williams",          "team_color": "#005AFF", "nationality": "Spanish",      "tier": "B", "multiplier": 3.5,  "wins": 3,   "championships": 0, "card_num": "117", "score": 76},
    {"name": "Nico Hulkenberg",     "series": "F1", "rookie": False, "team": "Sauber",            "team_color": "#52E252", "nationality": "German",       "tier": "C", "multiplier": 1.5,  "wins": 0,   "championships": 0, "card_num": "118", "score": 52},
    {"name": "Gabriel Bortoleto",   "series": "F1", "rookie": True,  "team": "Sauber",            "team_color": "#52E252", "nationality": "Brazilian",    "tier": "B", "multiplier": 2.8,  "wins": 0,   "championships": 0, "card_num": "119", "score": 73},
    {"name": "Pierre Gasly",        "series": "F1", "rookie": False, "team": "Alpine",            "team_color": "#0090FF", "nationality": "French",       "tier": "C", "multiplier": 1.7,  "wins": 1,   "championships": 0, "card_num": "120", "score": 56},
    {"name": "Jack Doohan",         "series": "F1", "rookie": True,  "team": "Alpine",            "team_color": "#0090FF", "nationality": "Australian",   "tier": "C", "multiplier": 2.2,  "wins": 0,   "championships": 0, "card_num": "121", "score": 63},
    {"name": "Sergio Perez",        "series": "F1", "rookie": False, "team": "Red Bull Racing",   "team_color": "#3671C6", "nationality": "Mexican",      "tier": "B", "multiplier": 2.8,  "wins": 13,  "championships": 0, "card_num": "122", "score": 70},
    {"name": "Valtteri Bottas",     "series": "F1", "rookie": False, "team": "Mercedes Reserve",  "team_color": "#00D2BE", "nationality": "Finnish",      "tier": "C", "multiplier": 1.5,  "wins": 10,  "championships": 0, "card_num": "123", "score": 50},
    {"name": "Zhou Guanyu",         "series": "F1", "rookie": False, "team": "Ferrari Reserve",   "team_color": "#DC0000", "nationality": "Chinese",      "tier": "C", "multiplier": 1.4,  "wins": 0,   "championships": 0, "card_num": "124", "score": 48},
    # ── F2 Prospects ────────────────────────────────────────────────────────────
    {"name": "Leonardo Fornaroli",  "series": "F2", "rookie": True,  "team": "F2",                "team_color": "#8B5CF6", "nationality": "Italian",      "tier": "C", "multiplier": 1.5,  "wins": 0,   "championships": 0, "card_num": "201", "score": 45},
    {"name": "Arvid Lindblad",      "series": "F2", "rookie": True,  "team": "F2",                "team_color": "#8B5CF6", "nationality": "Swedish",      "tier": "C", "multiplier": 1.8,  "wins": 0,   "championships": 0, "card_num": "202", "score": 50},
    {"name": "Josep Maria Marti",   "series": "F2", "rookie": True,  "team": "F2",                "team_color": "#8B5CF6", "nationality": "Spanish",      "tier": "C", "multiplier": 1.5,  "wins": 0,   "championships": 0, "card_num": "203", "score": 44},
    {"name": "Richard Verschoor",   "series": "F2", "rookie": False, "team": "F2",                "team_color": "#8B5CF6", "nationality": "Dutch",        "tier": "C", "multiplier": 1.4,  "wins": 0,   "championships": 0, "card_num": "204", "score": 42},
    {"name": "Dino Beganovic",      "series": "F2", "rookie": False, "team": "F2",                "team_color": "#8B5CF6", "nationality": "Swedish",      "tier": "C", "multiplier": 1.4,  "wins": 0,   "championships": 0, "card_num": "205", "score": 43},
    {"name": "Gabriele Mini",       "series": "F2", "rookie": True,  "team": "F2",                "team_color": "#8B5CF6", "nationality": "Italian",      "tier": "C", "multiplier": 1.5,  "wins": 0,   "championships": 0, "card_num": "206", "score": 46},
    {"name": "Jak Crawford",        "series": "F2", "rookie": False, "team": "F2",                "team_color": "#8B5CF6", "nationality": "American",     "tier": "C", "multiplier": 1.6,  "wins": 0,   "championships": 0, "card_num": "207", "score": 48},
    {"name": "Victor Martins",      "series": "F2", "rookie": False, "team": "F2",                "team_color": "#8B5CF6", "nationality": "French",       "tier": "C", "multiplier": 1.4,  "wins": 0,   "championships": 0, "card_num": "208", "score": 44},
    {"name": "Joshua Durksen",      "series": "F2", "rookie": True,  "team": "F2",                "team_color": "#8B5CF6", "nationality": "Paraguayan",   "tier": "C", "multiplier": 1.3,  "wins": 0,   "championships": 0, "card_num": "209", "score": 40},
    {"name": "Luke Browning",       "series": "F2", "rookie": False, "team": "F2",                "team_color": "#8B5CF6", "nationality": "British",      "tier": "C", "multiplier": 1.3,  "wins": 0,   "championships": 0, "card_num": "210", "score": 40},
    # ── F3 Prospects ────────────────────────────────────────────────────────────
    {"name": "Tuukka Taponen",      "series": "F3", "rookie": True,  "team": "F3",                "team_color": "#EC4899", "nationality": "Finnish",      "tier": "C", "multiplier": 1.3,  "wins": 0,   "championships": 0, "card_num": "301", "score": 38},
    {"name": "Ugo Ugochukwu",       "series": "F3", "rookie": True,  "team": "F3",                "team_color": "#EC4899", "nationality": "American",     "tier": "C", "multiplier": 1.5,  "wins": 0,   "championships": 0, "card_num": "302", "score": 42},
    {"name": "James Wharton",       "series": "F3", "rookie": True,  "team": "F3",                "team_color": "#EC4899", "nationality": "Australian",   "tier": "C", "multiplier": 1.4,  "wins": 0,   "championships": 0, "card_num": "303", "score": 40},
    {"name": "Louis Sharp",         "series": "F3", "rookie": True,  "team": "F3",                "team_color": "#EC4899", "nationality": "British",      "tier": "C", "multiplier": 1.3,  "wins": 0,   "championships": 0, "card_num": "304", "score": 38},
    {"name": "Noah Stromsted",      "series": "F3", "rookie": True,  "team": "F3",                "team_color": "#EC4899", "nationality": "Danish",       "tier": "C", "multiplier": 1.3,  "wins": 0,   "championships": 0, "card_num": "305", "score": 37},
    {"name": "Javier Sagrera",      "series": "F3", "rookie": True,  "team": "F3",                "team_color": "#EC4899", "nationality": "Spanish",      "tier": "C", "multiplier": 1.3,  "wins": 0,   "championships": 0, "card_num": "306", "score": 37},
    # ── F1 Legends ──────────────────────────────────────────────────────────────
    {"name": "Michael Schumacher",  "series": "Legends", "rookie": False, "team": "Ferrari (Legend)",    "team_color": "#DC0000", "nationality": "German",   "tier": "B", "multiplier": 4.0,  "wins": 91,  "championships": 7, "card_num": "401", "score": 75},
    {"name": "Alain Prost",         "series": "Legends", "rookie": False, "team": "McLaren (Legend)",    "team_color": "#FF8000", "nationality": "French",   "tier": "B", "multiplier": 3.5,  "wins": 51,  "championships": 4, "card_num": "402", "score": 70},
    {"name": "Nigel Mansell",       "series": "Legends", "rookie": False, "team": "Williams (Legend)",   "team_color": "#005AFF", "nationality": "British",  "tier": "A", "multiplier": 5.0,  "wins": 31,  "championships": 1, "card_num": "403", "score": 80},
    {"name": "Ayrton Senna",        "series": "Legends", "rookie": False, "team": "McLaren (Legend)",    "team_color": "#FF8000", "nationality": "Brazilian","tier": "B", "multiplier": 4.5,  "wins": 41,  "championships": 3, "card_num": "404", "score": 78},
    {"name": "Mario Andretti",      "series": "Legends", "rookie": False, "team": "Lotus (Legend)",      "team_color": "#FFD700", "nationality": "American", "tier": "A", "multiplier": 4.5,  "wins": 12,  "championships": 1, "card_num": "405", "score": 78},
    {"name": "Mika Hakkinen",       "series": "Legends", "rookie": False, "team": "McLaren (Legend)",    "team_color": "#FF8000", "nationality": "Finnish",  "tier": "A", "multiplier": 5.5,  "wins": 20,  "championships": 2, "card_num": "406", "score": 82},
    {"name": "Damon Hill",          "series": "Legends", "rookie": False, "team": "Williams (Legend)",   "team_color": "#005AFF", "nationality": "British",  "tier": "A", "multiplier": 4.0,  "wins": 22,  "championships": 1, "card_num": "407", "score": 75},
    {"name": "Jacques Villeneuve",  "series": "Legends", "rookie": False, "team": "Williams (Legend)",   "team_color": "#005AFF", "nationality": "Canadian", "tier": "B", "multiplier": 3.0,  "wins": 11,  "championships": 1, "card_num": "408", "score": 65},
    {"name": "Emerson Fittipaldi",  "series": "Legends", "rookie": False, "team": "McLaren (Legend)",    "team_color": "#FF8000", "nationality": "Brazilian","tier": "A", "multiplier": 4.0,  "wins": 14,  "championships": 2, "card_num": "409", "score": 72},
    {"name": "Juan Pablo Montoya",  "series": "Legends", "rookie": False, "team": "Williams (Legend)",   "team_color": "#005AFF", "nationality": "Colombian","tier": "B", "multiplier": 3.0,  "wins": 7,   "championships": 0, "card_num": "410", "score": 63},
    {"name": "Gerhard Berger",      "series": "Legends", "rookie": False, "team": "Ferrari (Legend)",    "team_color": "#DC0000", "nationality": "Austrian", "tier": "B", "multiplier": 3.0,  "wins": 10,  "championships": 0, "card_num": "411", "score": 62},
    {"name": "James Hunt",          "series": "Legends", "rookie": False, "team": "McLaren (Legend)",    "team_color": "#FF8000", "nationality": "British",  "tier": "A", "multiplier": 4.5,  "wins": 10,  "championships": 1, "card_num": "412", "score": 74},
]

# Keep F1_DRIVERS pointing to just the F1 current grid for backward compat
F1_DRIVERS = [d for d in ALL_DRIVERS if d["series"] == "F1"]

PARALLELS = [
    {"name": "Base", "mult": 1.0},
    {"name": "Refractor", "mult": 1.8},
    {"name": "Prism Refractor", "mult": 2.5},
    {"name": "Blue /150", "mult": 3.0},
    {"name": "Green /99", "mult": 4.0},
    {"name": "Gold /50", "mult": 7.0},
    {"name": "Orange /25", "mult": 10.0},
    {"name": "Red /5", "mult": 20.0},
    # Autograph variants
    {"name": "Autograph", "mult": 8.0},
    {"name": "Auto Blue /150", "mult": 14.0},
    {"name": "Auto Green /99", "mult": 20.0},
    {"name": "Auto Gold /50", "mult": 30.0},
    {"name": "Auto Orange /25", "mult": 50.0},
    {"name": "Auto Red /5", "mult": 100.0},
    {"name": "Auto SuperFractor 1/1", "mult": 250.0},
    # Insert autos
    {"name": "Speed Wheels Auto", "mult": 10.0},
    {"name": "Neon Nations Auto", "mult": 10.0},
    {"name": "Floor It Auto", "mult": 10.0},
    {"name": "Vegas at Night Auto", "mult": 12.0},
    {"name": "Diamond 75th Auto", "mult": 11.0},
]

GRADE_MULT = {"Raw": 0.65, "PSA 10": 3.2}
BASE_PRICE = 8.0


def _make_card(driver: dict, parallel: dict, grade: str) -> Card:
    base_val = round(BASE_PRICE * driver["multiplier"] * parallel["mult"] * GRADE_MULT[grade], 2)
    color = driver["team_color"].lstrip("#")
    return Card(
        driver_name=driver["name"],
        year=2025,
        set_name="Topps Chrome F1",
        card_number=driver["card_num"],
        parallel=parallel["name"],
        grade=grade,
        image_url=f"https://placehold.co/200x280/{color}/FFFFFF?text={driver['name'].split()[-1]}",
        base_value=base_val,
        investment_score=float(driver["score"]),
        team=driver["team"],
        team_color=driver["team_color"],
        nationality=driver["nationality"],
        career_wins=driver["wins"],
        championships=driver["championships"],
        series=driver.get("series", "F1"),
        is_rookie=driver.get("rookie", False),
    )


def seed_all(db: Session):
    """Seed card catalog only. Auctions are populated by live eBay API sync."""
    if db.query(Card).count() > 0:
        return

    for driver in ALL_DRIVERS:
        for parallel in PARALLELS:
            for grade in ["Raw", "PSA 10"]:
                db.add(_make_card(driver, parallel, grade))

    db.commit()


def seed_missing_drivers(db: Session) -> int:
    """Insert cards for any driver not yet in the DB. Safe to call on prod."""
    added = 0
    for driver in ALL_DRIVERS:
        exists = db.query(Card).filter(Card.driver_name == driver["name"]).first()
        if not exists:
            for parallel in PARALLELS:
                for grade in ["Raw", "PSA 10"]:
                    db.add(_make_card(driver, parallel, grade))
                    added += 1
        else:
            # Update series/rookie on existing cards
            db.query(Card).filter(Card.driver_name == driver["name"]).update(
                {"series": driver.get("series", "F1"), "is_rookie": driver.get("rookie", False)}
            )
    db.commit()
    return added
