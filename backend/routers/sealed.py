"""Box-break expected value (EV) calculator for 2025 Topps Chrome F1 hobby box.

Set composition is approximated from Topps' published pack/box structure:
- 18 packs per box, 4 cards per pack = 72 cards/box
- ~1 autograph per box
- ~2 numbered color parallels per box (Aqua /199, Pink /250, Teal /299 tier)
- ~5 refractors per box
- ~2 inserts per box (Speed Wheels / Neon Nations / Vegas at Night mix)
- Remainder = base (~62 cards) — treated as ~$0.25 each in aggregate

Rare hit probabilities are modeled as fractional expected pulls per box.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db, SoldCard
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/sealed", tags=["sealed"])

# Expected pulls per hobby box. Values derived from published hit rates / box
# configurators. Anything < 1 is probabilistic — e.g. 0.1 = 1-in-10 boxes.
EXPECTED_PULLS = [
    {"parallel": "Base",           "expected": 62.0, "fallback_avg": 0.25},
    {"parallel": "Refractor",      "expected": 5.0,  "fallback_avg": 3.0},
    {"parallel": "Insert",         "expected": 2.0,  "fallback_avg": 8.0},  # avg of all inserts
    {"parallel": "Aqua /199",      "expected": 0.75, "fallback_avg": 45.0},
    {"parallel": "Pink /250",      "expected": 0.6,  "fallback_avg": 35.0},
    {"parallel": "Teal /299",      "expected": 0.5,  "fallback_avg": 30.0},
    {"parallel": "Blue /150",      "expected": 0.35, "fallback_avg": 55.0},
    {"parallel": "Green /99",      "expected": 0.2,  "fallback_avg": 90.0},
    {"parallel": "F1 75th /75",    "expected": 0.15, "fallback_avg": 120.0},
    {"parallel": "Gold /50",       "expected": 0.1,  "fallback_avg": 180.0},
    {"parallel": "Orange /25",     "expected": 0.04, "fallback_avg": 400.0},
    {"parallel": "Black /10",      "expected": 0.02, "fallback_avg": 900.0},
    {"parallel": "Red /5",         "expected": 0.008, "fallback_avg": 1800.0},
    {"parallel": "SuperFractor",   "expected": 0.003, "fallback_avg": 5000.0},
    {"parallel": "Autograph",      "expected": 1.0,  "fallback_avg": 65.0},
]


def _market_avg(db: Session, parallel: str, days: int = 90) -> float | None:
    since = datetime.utcnow() - timedelta(days=days)
    # For generic 'Insert', aggregate across known insert sets
    if parallel == "Insert":
        inserts = [
            "Speed Wheels", "Neon Nations", "Floor It", "Vegas at Night",
            "Diamond 75th", "Helix", "Ultrasonic", "Top Speed",
        ]
        val = db.query(func.avg(SoldCard.sale_price)).filter(
            SoldCard.sale_price > 0,
            SoldCard.sale_date >= since,
            SoldCard.parallel.in_(inserts),
        ).scalar()
        return float(val) if val else None
    val = db.query(func.avg(SoldCard.sale_price)).filter(
        SoldCard.sale_price > 0,
        SoldCard.sale_date >= since,
        SoldCard.parallel == parallel,
    ).scalar()
    return float(val) if val else None


def _verdict(ev: float, price: float) -> dict:
    """Green if EV beats box price, red if not. Mirror verdict.js style."""
    if price <= 0:
        return {"label": "SET PRICE", "color": "gray"}
    diff = ev - price
    pct = (diff / price) * 100
    if pct >= 10:
        label = "BUY"
        color = "green"
    elif pct >= -5:
        label = "HOLD"
        color = "yellow"
    else:
        label = "PASS"
        color = "red"
    return {
        "label": label,
        "color": color,
        "delta_usd": round(diff, 2),
        "delta_pct": round(pct, 1),
    }


@router.get("/ev")
def ev_calc(
    box_market_price: float = Query(200.0, description="User-set market price of sealed hobby box"),
    db: Session = Depends(get_db),
):
    breakdown = []
    total_ev = 0.0
    for item in EXPECTED_PULLS:
        parallel = item["parallel"]
        expected = item["expected"]
        live_avg = _market_avg(db, parallel)
        avg_used = round(live_avg if live_avg else item["fallback_avg"], 2)
        contribution = round(expected * avg_used, 2)
        total_ev += contribution
        breakdown.append({
            "parallel": parallel,
            "expected_pulls": expected,
            "avg_value_per_pull": avg_used,
            "contribution": contribution,
            "source": "market" if live_avg else "estimate",
        })

    total_ev = round(total_ev, 2)
    verdict = _verdict(total_ev, box_market_price)
    return {
        "set": "2025 Topps Chrome F1 Hobby Box",
        "box_market_price": box_market_price,
        "total_ev": total_ev,
        "verdict": verdict,
        "breakdown": breakdown,
        "pack_count": 18,
        "cards_per_pack": 4,
        "total_cards_per_box": 72,
        "assumption_note": "Hit rates approximated from published Topps Chrome F1 configurator; refine with real break data.",
    }
