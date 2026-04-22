"""User Sniper rules — match active auctions vs per-user rules, notify via push.

Rules live in Supabase (`user_snipe_rules`, `user_snipe_matches`). This router
runs the match engine (invoked by Vercel cron) and handles paste-URL checks.
"""
import os
import re
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Query, Header
from sqlalchemy.orm import Session

from database import get_db, Auction, Card, PushSubscription

router = APIRouter(prefix="/api/sniper", tags=["sniper"])
log = logging.getLogger("sniper")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "") or os.getenv("VITE_SUPABASE_ANON_KEY", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def _sb_headers(service: bool = True) -> dict:
    key = SUPABASE_SERVICE_KEY if service else SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _sb_get(path: str, params: Optional[dict] = None, service: bool = True, jwt: Optional[str] = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = _sb_headers(service=service)
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    r = requests.get(url, headers=headers, params=params or {}, timeout=15)
    r.raise_for_status()
    return r.json()


def _sb_post(path: str, body, service: bool = True):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = requests.post(url, headers=_sb_headers(service=service), data=json.dumps(body), timeout=15)
    if r.status_code >= 300:
        log.warning(f"supabase POST {path} -> {r.status_code}: {r.text[:200]}")
    return r


def _sb_patch(path: str, body, service: bool = True):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = requests.patch(url, headers=_sb_headers(service=service), data=json.dumps(body), timeout=15)
    if r.status_code >= 300:
        log.warning(f"supabase PATCH {path} -> {r.status_code}: {r.text[:200]}")
    return r


def _parse_ebay_listing_id(url: str) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"/itm/(?:[^/]+/)?(\d{9,})", url)
    if m:
        return m.group(1)
    m = re.search(r"(\d{11,})", url)
    return m.group(1) if m else None


def _rule_matches_auction(rule: dict, auction: Auction, db: Session) -> tuple[bool, str]:
    """Return (matched, reason)."""
    card = auction.card
    driver = (card.driver_name if card else "") or ""
    parallel = (card.parallel if card else "") or ""
    title = auction.title or ""

    r_driver = (rule.get("driver_name") or "").strip()
    r_parallel = (rule.get("parallel") or "").strip()
    r_grade = (rule.get("grade") or "").strip()

    if r_driver and r_driver.lower() != driver.lower():
        return False, "driver mismatch"
    if r_parallel:
        if r_parallel.lower() not in parallel.lower() and r_parallel.lower() not in title.lower():
            return False, "parallel mismatch"
    if r_grade:
        if r_grade.lower() not in title.lower() and r_grade.lower() != (card.grade or "").lower() if card else True:
            if r_grade.lower() not in title.lower():
                return False, "grade mismatch"

    total = (auction.current_price or 0) + (auction.shipping_cost or 0)
    max_price = rule.get("max_price")
    max_pct = rule.get("max_percent_of_median")

    if max_price is not None:
        if total > float(max_price):
            return False, f"price ${total:.0f} > cap ${float(max_price):.0f}"

    median_val = None
    if max_pct is not None:
        try:
            from scraper import median_comp_price, _extract_grade_from_title
            grade = r_grade or _extract_grade_from_title(title)
            median_val, n = median_comp_price(db, driver, parallel, grade)
            if not (median_val and n >= 3):
                return False, "no median"
            pct = (total / median_val) * 100 if median_val > 0 else 999
            if pct > float(max_pct):
                return False, f"{pct:.0f}% > {float(max_pct):.0f}% of median"
        except Exception as e:
            log.warning(f"median lookup failed: {e}")
            return False, "median error"

    if rule.get("ending_soon_only"):
        if not auction.end_time:
            return False, "no end_time"
        left = auction.end_time - datetime.utcnow()
        if left > timedelta(hours=6) or left < timedelta(0):
            return False, "not ending soon"

    return True, "ok"


def _auth_ok(request: Request, token_q: Optional[str], admin_header: Optional[str]) -> bool:
    if not ADMIN_TOKEN:
        return False
    if token_q == ADMIN_TOKEN or admin_header == ADMIN_TOKEN:
        return True
    # Vercel cron: Authorization: Bearer <CRON_SECRET>
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        tok = auth.split(None, 1)[1]
        cron_secret = os.getenv("CRON_SECRET", "")
        if cron_secret and tok == cron_secret:
            return True
        if tok == ADMIN_TOKEN:
            return True
    return False


@router.api_route("/check", methods=["GET", "POST"])
def run_match_engine(
    request: Request,
    token: Optional[str] = Query(None),
    x_admin_token: Optional[str] = Header(None),
    use_fresh_lookup: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Cron-invoked: scan every active rule vs every active auction.

    If use_fresh_lookup=true, fetch current item details from eBay Browse API
    for each rule before scoring (slower but fresher). Default: use cached DB.
    """
    if not _auth_ok(request, token, x_admin_token):
        raise HTTPException(401, "unauthorized")
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        return {"status": "no_service_key", "message": "Set SUPABASE_URL + SUPABASE_SERVICE_KEY env vars"}

    try:
        rules = _sb_get("user_snipe_rules", {"active": "eq.true", "select": "*"})
    except Exception as e:
        log.error(f"failed to load rules: {e}")
        raise HTTPException(500, "supabase read failed")

    auctions = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time > datetime.utcnow(),
    ).all()

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    seven_days_ago = now - timedelta(days=7)

    rules_checked = 0
    matches_found = 0
    notified = 0

    for rule in rules:
        rules_checked += 1
        rule_id = rule["id"]
        user_id = rule["user_id"]
        max_per_day = int(rule.get("max_per_day") or 3)

        # Dedup / per-day count
        try:
            recent = _sb_get("user_snipe_matches", {
                "rule_id": f"eq.{rule_id}",
                "matched_at": f"gte.{seven_days_ago.isoformat()}",
                "select": "auction_id,matched_at",
            })
        except Exception:
            recent = []
        seen_auctions = {r.get("auction_id") for r in recent if r.get("auction_id")}
        today_count = sum(1 for r in recent if r.get("matched_at") and r["matched_at"] >= today_start.isoformat())

        for auction in auctions:
            if today_count >= max_per_day:
                break
            if auction.id in seen_auctions:
                continue

            # If fresh lookup requested, refresh this listing from eBay Browse API first
            if use_fresh_lookup and auction.ebay_listing_id:
                try:
                    import asyncio
                    from ebay_api import get_item_details
                    fresh = asyncio.run(get_item_details(auction.ebay_listing_id))
                    if fresh:
                        # Update auction prices from fresh data
                        auction.current_price = fresh.get("current_price", auction.current_price)
                        auction.shipping_cost = fresh.get("shipping_cost", auction.shipping_cost)
                        auction.end_time = fresh.get("end_time", auction.end_time)
                except Exception as e:
                    log.warning(f"fresh lookup failed for {auction.ebay_listing_id}: {e}")

            matched, _reason = _rule_matches_auction(rule, auction, db)
            if not matched:
                continue

            median_val = None
            try:
                from scraper import median_comp_price, _extract_grade_from_title
                card = auction.card
                grade = (rule.get("grade") or "") or _extract_grade_from_title(auction.title or "")
                if card:
                    median_val, _ = median_comp_price(db, card.driver_name, card.parallel, grade)
            except Exception:
                pass

            total = (auction.current_price or 0) + (auction.shipping_cost or 0)
            match_row = {
                "rule_id": rule_id,
                "user_id": user_id,
                "auction_id": auction.id,
                "ebay_listing_id": auction.ebay_listing_id,
                "title": (auction.title or "")[:500],
                "current_price": total,
                "median_price": median_val,
            }
            resp = _sb_post("user_snipe_matches", match_row)
            if resp.status_code >= 300:
                continue
            matches_found += 1
            today_count += 1
            seen_auctions.add(auction.id)

            # Update rule counters
            _sb_patch(
                f"user_snipe_rules?id=eq.{rule_id}",
                {"last_triggered_at": now.isoformat(), "trigger_count": (rule.get("trigger_count") or 0) + 1},
            )

            # Push
            try:
                from routers.push import send_push_to_all
                label = rule.get("name") or "Sniper match"
                body = f"${total:.0f}: {(auction.title or '')[:80]}"
                url = auction.ebay_url or f"/auctions?alert={auction.id}"
                sent = send_push_to_all(db, title=f"🎯 {label}", body=body, url=url, tag=f"snipe-{rule_id}")
                notified += sent
            except Exception as e:
                log.warning(f"push failed: {e}")

    return {"rules_checked": rules_checked, "matches_found": matches_found, "notified": notified}


@router.post("/check-url")
def check_url(
    url: str = Query(...),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Paste-a-URL instant check: which of the caller's active rules match?"""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        return {"status": "no_supabase", "matches": []}

    jwt = None
    if authorization and authorization.lower().startswith("bearer "):
        jwt = authorization.split(None, 1)[1]
    if not jwt:
        raise HTTPException(401, "missing auth")

    listing_id = _parse_ebay_listing_id(url)
    if not listing_id:
        return {"status": "no_listing_id", "matches": []}

    auction = db.query(Auction).filter(Auction.ebay_listing_id == listing_id).first()
    if not auction:
        return {"status": "unknown_listing", "matches": [], "message": "Not in our tracked auctions DB"}

    try:
        rules = _sb_get("user_snipe_rules", {"active": "eq.true", "select": "*"}, service=False, jwt=jwt)
    except Exception as e:
        log.error(f"load rules (jwt) failed: {e}")
        raise HTTPException(401, "auth failed")

    results = []
    for rule in rules:
        matched, reason = _rule_matches_auction(rule, auction, db)
        results.append({
            "rule_id": rule["id"],
            "name": rule.get("name"),
            "matched": matched,
            "reason": reason,
        })

    total = (auction.current_price or 0) + (auction.shipping_cost or 0)
    return {
        "status": "ok",
        "auction": {
            "id": auction.id,
            "title": auction.title,
            "total_cost": total,
            "end_time": auction.end_time.isoformat() if auction.end_time else None,
        },
        "matches": results,
    }


@router.get("/fresh-snipes/{limit}")
def get_fresh_snipes(limit: int = 6, db: Session = Depends(get_db)):
    """Public: return top N "snipe-worthy" auctions with fresh eBay lookups.

    Scans active auctions ending within 6h, filters to rare parallels + high value,
    and returns with current prices & verdicts. Used by Dashboard on mount for
    real-time Biggest Snipes display.
    """
    import asyncio
    from ebay_api import get_item_details

    BORING_PARALLELS = {"Base", "B&W Ray Wave", "B&W Lazer", "Floor It", "Four & More"}
    RARE_PRINT_RE = r"/(5|10|15|20|25|50|75)\b"

    auctions = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time > datetime.utcnow(),
        Auction.end_time <= datetime.utcnow() + timedelta(hours=6),
    ).all()

    candidates = []
    for a in auctions:
        # Skip boring parallels
        parallel = a.card.parallel if a.card else ""
        if parallel in BORING_PARALLELS:
            continue

        price = a.current_price or 0
        title = (a.title or "").lower()

        # Skip low-value unless rare print run or autograph
        if price < 20 and not re.search(RARE_PRINT_RE, title) and "auto" not in title:
            continue

        # Attempt fresh fetch to get real-time bid info
        if a.ebay_listing_id:
            try:
                fresh = asyncio.run(get_item_details(a.ebay_listing_id))
                if fresh:
                    a.current_price = fresh.get("current_price", price)
                    a.shipping_cost = fresh.get("shipping_cost", a.shipping_cost or 0)
                    a.end_time = fresh.get("end_time", a.end_time)
            except Exception as e:
                log.debug(f"fresh fetch {a.ebay_listing_id}: {e}")

        candidates.append(a)

    # Sort by verdict > score > time remaining
    def score_key(a):
        v = a.verdict or ""
        rank = 2 if v == "STRONG_BUY" else (1 if v == "GOOD_BUY" else 0)
        secs_left = max(0, (a.end_time - datetime.utcnow()).total_seconds()) if a.end_time else 0
        return (-rank, -(a.snipe_score or 0), secs_left)

    sorted_auctions = sorted(candidates, key=score_key)[:limit]

    return {
        "status": "ok",
        "auctions": [
            {
                "id": a.id,
                "ebay_listing_id": a.ebay_listing_id,
                "title": a.title,
                "current_price": a.current_price,
                "shipping_cost": a.shipping_cost,
                "end_time": a.end_time.isoformat() if a.end_time else None,
                "driver_name": a.card.driver_name if a.card else None,
                "parallel": a.card.parallel if a.card else None,
                "verdict": a.verdict,
                "snipe_score": a.snipe_score,
                "median_price": a.median_price,
            }
            for a in sorted_auctions
        ],
    }
