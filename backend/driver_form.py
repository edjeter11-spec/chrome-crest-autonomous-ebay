"""
Driver form scoring — shared by /api/drivers/form (frontend FormBadge/
MomentumChip) and the snipe-scoring engine (scraper.calculate_snipe_score).

Form reflects recent race results (last ~6 events, Race + Sprint, recency-
weighted) as a proxy for market hype: a driver coming off a win/podium
tends to see card prices climb within days as buyer interest spikes, so
"cheap vs. 90-day median" is a WEAKER signal right after a big result (the
market hasn't repriced yet — today's median undersells the card) and a
STRONGER signal right after a bad result (hype is fading, a "cheap" price
may still be a real discount, not a rebound in progress).
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

# Position → points table (also used by the /api/drivers/form route)
POSITION_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 3, 10: 2}
RECENCY_WEIGHTS = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25]
FORM_LOOKBACK_DAYS = 120  # ~4 race weekends + sprints


def _dnf_points(laps):
    """Crashed-into / lap-1 incident -> light penalty.
    Long DNF (mechanical or driver error) -> full penalty."""
    if laps is None:
        return 0
    if laps <= 3:
        return 5
    if laps <= 15:
        return 2
    return 0


def compute_form_for_results(results: list) -> dict:
    """Given a driver's RaceResult rows (any order, will be re-sorted desc by
    date), return {form_score, tier, races_counted, latest_race}. Shared core
    so the bulk /api/drivers/form sweep and a single-driver lookup produce
    identical numbers."""
    recent = sorted(results, key=lambda r: r.race_date, reverse=True)[:6]
    total = 0.0
    weight_sum = 0.0
    for i, r in enumerate(recent):
        recency = RECENCY_WEIGHTS[i] if i < len(RECENCY_WEIGHTS) else 0.15
        sprint_mod = 0.5 if getattr(r, "is_sprint", False) else 1.0
        w = recency * sprint_mod
        if r.status == "DNS":
            continue
        elif r.status == "DSQ":
            pts = 0
        elif r.status == "DNF":
            pts = _dnf_points(getattr(r, "laps_completed", None))
        elif r.position and r.position <= 10:
            pts = POSITION_POINTS.get(r.position, 1)
        else:
            pts = 1
        total += pts * w
        weight_sum += w
    score = round(total / weight_sum, 1) if weight_sum else 0.0

    if score >= 20:
        tier = "hot"
    elif score >= 10:
        tier = "climbing"
    elif score >= 5:
        tier = "stable"
    else:
        tier = "cold"

    latest = recent[0] if recent else None
    return {
        "form_score": score,
        "tier": tier,
        "races_counted": len(recent),
        "latest_race": {
            "name": latest.race_name,
            "date": latest.race_date.isoformat() if latest.race_date else None,
            "position": latest.position,
            "status": latest.status,
        } if latest else None,
    }


# In-process cache: driver_name -> (form dict, expires_at). Snipe scoring
# runs per-listing across hundreds of active auctions per cron tick — this
# avoids a RaceResult query per listing. 30min TTL: form only changes when
# new race results land (Mon/Thu cron), so this is generous, not stale-risk.
_FORM_CACHE: dict = {}
_FORM_TTL_SEC = 1800


def get_driver_form(db: Session, driver_name: str) -> dict:
    """Cached per-driver form lookup. Returns the same shape as
    compute_form_for_results, or a zeroed/cold default if no recent results."""
    if not driver_name:
        return {"form_score": 0.0, "tier": "cold", "races_counted": 0, "latest_race": None}

    now = datetime.utcnow()
    cached = _FORM_CACHE.get(driver_name)
    if cached and cached[1] > now:
        return cached[0]

    from database import RaceResult
    cutoff = now - timedelta(days=FORM_LOOKBACK_DAYS)
    rows = (
        db.query(RaceResult)
        .filter(RaceResult.driver_name.ilike(driver_name), RaceResult.race_date >= cutoff)
        .all()
    )
    result = compute_form_for_results(rows) if rows else {
        "form_score": 0.0, "tier": "cold", "races_counted": 0, "latest_race": None,
    }
    _FORM_CACHE[driver_name] = (result, now + timedelta(seconds=_FORM_TTL_SEC))
    return result


def form_price_modifier(form: dict) -> float:
    """Map a form dict to a snipe-price-threshold multiplier.

    Hype after a big result inflates prices before the comp median catches
    up (sold_cards lags the live market by however long it takes buyers to
    actually complete purchases) — so "cheap vs. median" needs a STRICTER
    bar (lower multiplier = harder to qualify as cheap) right after a win.
    Cold form means the opposite: no hype tailwind, so a discount vs. the
    existing median is more likely a real, durable discount rather than a
    stale-comp illusion — LOOSER bar (higher multiplier).

    Returned value multiplies the snipe price-ratio thresholds directly
    (see calculate_snipe_score) — 1.0 = no adjustment.
    """
    tier = form.get("tier", "cold")
    latest = form.get("latest_race") or {}
    is_recent_win = latest.get("position") == 1
    if tier == "hot" and is_recent_win:
        return 0.85  # fresh win — demand a deeper discount to call it cheap
    if tier == "hot":
        return 0.92
    if tier == "climbing":
        return 0.97
    if tier == "cold":
        return 1.08  # no hype tailwind — an ordinary discount counts for more
    return 1.0  # stable
