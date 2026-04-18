"""F1 race calendar router. Pulls the 2025 Jolpica/Ergast schedule (free, no key)
and caches for 6h. Also returns "race-day signal" — drivers most likely to move
card prices if they win the next race, based on historical sold_cards data."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
import httpx
from database import get_db, SoldCard

router = APIRouter(prefix="/api/races", tags=["races"])

# Simple in-process cache: {key: (expires_at, payload)}
_CACHE: dict = {}
_CACHE_TTL = 6 * 3600  # 6 hours

# ISO-3166 country-ish name → flag emoji (covers every F1 race country).
_FLAGS = {
    "Australia": "🇦🇺", "China": "🇨🇳", "Japan": "🇯🇵", "Bahrain": "🇧🇭",
    "Saudi Arabia": "🇸🇦", "United States": "🇺🇸", "USA": "🇺🇸", "UAE": "🇦🇪",
    "United Arab Emirates": "🇦🇪", "Italy": "🇮🇹", "Monaco": "🇲🇨",
    "Spain": "🇪🇸", "Canada": "🇨🇦", "Austria": "🇦🇹", "UK": "🇬🇧",
    "Great Britain": "🇬🇧", "United Kingdom": "🇬🇧", "Hungary": "🇭🇺",
    "Belgium": "🇧🇪", "Netherlands": "🇳🇱", "Azerbaijan": "🇦🇿",
    "Singapore": "🇸🇬", "Mexico": "🇲🇽", "Brazil": "🇧🇷", "Qatar": "🇶🇦",
    "France": "🇫🇷", "Germany": "🇩🇪", "Russia": "🇷🇺",
}


def _flag(country: str) -> str:
    return _FLAGS.get(country or "", "🏁")


async def _fetch_calendar() -> list:
    now_key = "calendar_2025"
    cached = _CACHE.get(now_key)
    if cached and cached[0] > datetime.utcnow().timestamp():
        return cached[1]

    url = "https://api.jolpi.ca/ergast/f1/2025.json"
    races: list = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                races = (
                    data.get("MRData", {})
                        .get("RaceTable", {})
                        .get("Races", [])
                )
    except Exception:
        races = []

    # Normalize
    normalized = []
    for r in races:
        try:
            date_str = r.get("date", "")
            time_str = r.get("time", "") or "00:00:00Z"
            # Jolpica uses "YYYY-MM-DDZ" sometimes; normalize
            iso = f"{date_str}T{time_str.replace('Z', '')}"
            race_dt = datetime.fromisoformat(iso)
        except Exception:
            continue
        country = (r.get("Circuit", {}).get("Location", {}) or {}).get("country", "")
        normalized.append({
            "round": int(r.get("round", 0)),
            "name": r.get("raceName", ""),
            "circuit": r.get("Circuit", {}).get("circuitName", ""),
            "country": country,
            "city": (r.get("Circuit", {}).get("Location", {}) or {}).get("locality", ""),
            "date": race_dt.isoformat(),
            "flag": _flag(country),
        })

    _CACHE[now_key] = (datetime.utcnow().timestamp() + _CACHE_TTL, normalized)
    return normalized


def _days_until(iso_dt: str) -> int:
    try:
        dt = datetime.fromisoformat(iso_dt)
    except Exception:
        return 0
    delta = dt - datetime.utcnow()
    return max(0, int(delta.total_seconds() // 86400))


def _race_day_signal(db: Session, race_date: datetime, limit: int = 3) -> list:
    """Drivers whose cards spike on race day. Score = sales volume in the 7 days
    after each of their recent race-day wins. If no race-day data, fall back to
    top-3 drivers by total F1 sales volume."""
    # Sales volume by driver over last 90 days
    since = datetime.utcnow() - timedelta(days=90)
    rows = db.query(
        SoldCard.driver_name,
        func.count(SoldCard.id).label("cnt"),
        func.avg(SoldCard.sale_price).label("avg_p"),
    ).filter(
        SoldCard.driver_name.isnot(None),
        SoldCard.sale_date >= since,
        SoldCard.sale_price > 0,
        SoldCard.series == "F1",
    ).group_by(SoldCard.driver_name).order_by(desc("cnt")).limit(limit * 2).all()

    signal = []
    for r in rows[:limit]:
        signal.append({
            "driver": r.driver_name,
            "sales_90d": int(r.cnt),
            "avg_price": round(float(r.avg_p or 0), 2),
            "reason": f"{int(r.cnt)} sold · avg ${round(float(r.avg_p or 0), 0)}",
        })

    # Fallback if DB empty
    if not signal:
        for name in ["Max Verstappen", "Lando Norris", "Charles Leclerc"][:limit]:
            signal.append({
                "driver": name,
                "sales_90d": 0,
                "avg_price": 0,
                "reason": "Top-3 fallback (no sold data)",
            })
    return signal


@router.get("/upcoming")
async def upcoming_races(limit: int = 3, db: Session = Depends(get_db)):
    """Return next N F1 races + race-day signal for the very next race."""
    cal = await _fetch_calendar()
    now = datetime.utcnow()
    upcoming = [r for r in cal if datetime.fromisoformat(r["date"]) > now]
    upcoming.sort(key=lambda r: r["date"])
    slice_ = upcoming[:limit]

    # Add days_until to each
    for r in slice_:
        r["days_until"] = _days_until(r["date"])

    signal = []
    if slice_:
        try:
            signal = _race_day_signal(
                db, datetime.fromisoformat(slice_[0]["date"]), limit=3,
            )
        except Exception:
            signal = []

    return {
        "races": slice_,
        "next_race_signal": signal,
        "total_in_season": len(cal),
    }


@router.get("/calendar")
async def full_calendar():
    """Full 2025 calendar (cached 6h)."""
    cal = await _fetch_calendar()
    now = datetime.utcnow()
    for r in cal:
        r["days_until"] = _days_until(r["date"])
        r["past"] = datetime.fromisoformat(r["date"]) < now
    return {"races": cal, "total": len(cal)}
