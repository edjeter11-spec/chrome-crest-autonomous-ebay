"""User Sniper rules — match active auctions vs per-user rules, notify via push.

Rules live in Supabase (`user_snipe_rules`, `user_snipe_matches`). This router
runs the match engine (invoked by Vercel cron) and handles paste-URL checks.
"""
import os
import re
import json
import asyncio
import logging
import threading
from datetime import datetime, timedelta
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query, Header, Body
from sqlalchemy.orm import Session

from database import get_db, Auction, Card, PushSubscription
from lib.discord_alerts import post_to_discord
from lib.parallels import effective_parallel

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


def _sb_post(path: str, body, service: bool = True, jwt: Optional[str] = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = _sb_headers(service=service)
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    r = requests.post(url, headers=headers, data=json.dumps(body), timeout=15)
    if r.status_code >= 300:
        log.warning(f"supabase POST {path} -> {r.status_code}: {r.text[:200]}")
    return r


def _sb_patch(path: str, body, service: bool = True, jwt: Optional[str] = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = _sb_headers(service=service)
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    r = requests.patch(url, headers=headers, data=json.dumps(body), timeout=15)
    if r.status_code >= 300:
        log.warning(f"supabase PATCH {path} -> {r.status_code}: {r.text[:200]}")
    return r


def _fire_discord(webhook_url: str, auction_payload: dict, rule_name: str) -> None:
    """Fire-and-forget Discord post from a sync context. Runs in a daemon thread."""
    def _runner():
        try:
            asyncio.run(post_to_discord(webhook_url, auction_payload, rule_name))
        except Exception as e:
            log.warning(f"discord thread failed: {e}")
    threading.Thread(target=_runner, daemon=True).start()


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
    # Title-derived — a user rule for "Teal /299" must match on what the
    # listing actually is, not on whichever card row the scraper joined it to.
    parallel = effective_parallel(auction.title, card.parallel if card else None) or ""
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

    return _match_and_notify(db, rules, auctions, use_fresh_lookup=use_fresh_lookup)


def run_critical_match_pass(db: Session) -> dict:
    """Lightweight critical-only pass for /api/cron/sync-imminent (*/15).

    The full match engine only runs every few hours, so a rule hit on an
    auction ending in minutes used to be discovered too late. This scans just
    the critical slice — snipe_score >= 90 OR ending within 15 min — against
    all active rules. Dedup via user_snipe_matches makes re-runs free.
    """
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        return {"status": "no_service_key"}
    try:
        rules = _sb_get("user_snipe_rules", {"active": "eq.true", "select": "*"})
    except Exception as e:
        log.error(f"critical pass: failed to load rules: {e}")
        return {"status": "rules_load_failed"}
    if not rules:
        return {"rules_checked": 0, "matches_found": 0, "notified": 0}

    from sqlalchemy import or_
    now = datetime.utcnow()
    auctions = db.query(Auction).filter(
        Auction.status == "active",
        Auction.end_time > now,
        or_(
            Auction.snipe_score >= 90,
            Auction.end_time <= now + timedelta(minutes=15),
        ),
    ).all()
    if not auctions:
        return {"rules_checked": len(rules), "matches_found": 0, "notified": 0}
    return _match_and_notify(db, rules, auctions, use_fresh_lookup=False)


def _match_and_notify(db: Session, rules: list, auctions: list, use_fresh_lookup: bool = False) -> dict:
    """Core loop: score `auctions` against `rules`, record matches, push to the
    rule's owner. Shared by the full cron engine and the critical-only pass."""
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
                    median_val, _ = median_comp_price(
                        db,
                        card.driver_name,
                        effective_parallel(auction.title, card.parallel),
                        grade,
                    )
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

            # Push — scoped to the rule's owner only. Rules without a user_id
            # get no push (never broadcast one user's private hits to everyone).
            try:
                from routers.push import send_push_to_user
                label = rule.get("name") or "Sniper match"
                body = f"${total:.0f}: {(auction.title or '')[:80]}"
                url = auction.ebay_url or f"/auctions?alert={auction.id}"
                sent = send_push_to_user(db, user_id, title=f"🎯 {label}", body=body, url=url, tag=f"snipe-{rule_id}")
                notified += sent
            except Exception as e:
                log.warning(f"push failed: {e}")

            # Discord (per-rule webhook, optional)
            try:
                if rule.get("discord_enabled") and rule.get("discord_webhook_url"):
                    time_left_secs = 0
                    if auction.end_time:
                        time_left_secs = max(0, int((auction.end_time - datetime.utcnow()).total_seconds()))
                    auction_payload = {
                        "title": auction.title,
                        "current_price": total,
                        "median_price": median_val,
                        "ebay_url": auction.ebay_url,
                        "image_url": getattr(auction, "image_url", None),
                        "time_left": time_left_secs,
                    }
                    _fire_discord(
                        rule["discord_webhook_url"],
                        auction_payload,
                        rule.get("name") or "Snipe Match",
                    )
            except Exception as e:
                log.warning(f"discord dispatch failed: {e}")

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


@router.patch("/rules/{rule_id}")
def update_rule(
    rule_id: str,
    driver_name: Optional[str] = None,
    parallel: Optional[str] = None,
    grade: Optional[str] = None,
    max_price: Optional[float] = None,
    max_percent_of_median: Optional[float] = None,
    ending_soon_only: Optional[bool] = None,
    max_per_day: Optional[int] = None,
    active: Optional[bool] = None,
    discord_enabled: Optional[bool] = None,
    discord_webhook_url: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """Update a snipe rule. User must own the rule (enforce via JWT validation)."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        raise HTTPException(500, "supabase not configured")

    jwt = None
    if authorization and authorization.lower().startswith("bearer "):
        jwt = authorization.split(None, 1)[1]
    if not jwt:
        raise HTTPException(401, "missing auth")

    try:
        # Fetch the rule to verify ownership
        rules = _sb_get(f"user_snipe_rules?id=eq.{rule_id}&select=*", service=False, jwt=jwt)
        if not rules:
            raise HTTPException(404, "rule not found or not accessible")
    except Exception as e:
        log.error(f"failed to fetch rule: {e}")
        raise HTTPException(401, "auth failed")

    # Build update payload (only include provided fields)
    update_data = {}
    if driver_name is not None:
        update_data["driver_name"] = driver_name or None
    if parallel is not None:
        update_data["parallel"] = parallel or None
    if grade is not None:
        update_data["grade"] = grade or None
    if max_price is not None:
        update_data["max_price"] = max_price or None
    if max_percent_of_median is not None:
        update_data["max_percent_of_median"] = max_percent_of_median or None
    if ending_soon_only is not None:
        update_data["ending_soon_only"] = ending_soon_only
    if max_per_day is not None:
        update_data["max_per_day"] = max_per_day
    if active is not None:
        update_data["active"] = active
    if discord_enabled is not None:
        update_data["discord_enabled"] = discord_enabled
    if discord_webhook_url is not None:
        update_data["discord_webhook_url"] = discord_webhook_url or None

    if update_data:
        resp = _sb_patch(f"user_snipe_rules?id=eq.{rule_id}", update_data, service=False, jwt=jwt)
        if resp.status_code >= 300:
            log.warning(f"update rule {rule_id} failed: {resp.text[:200]}")
            raise HTTPException(resp.status_code, "failed to update rule")

    return {"status": "ok", "message": "rule updated"}


@router.get("/rules/export")
def export_rules(
    authorization: Optional[str] = Header(None),
):
    """Export user's active snipe rules as JSON for backup/sharing."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        raise HTTPException(500, "supabase not configured")

    jwt = None
    if authorization and authorization.lower().startswith("bearer "):
        jwt = authorization.split(None, 1)[1]
    if not jwt:
        raise HTTPException(401, "missing auth")

    try:
        rules = _sb_get("user_snipe_rules", {"active": "eq.true", "select": "*"}, service=False, jwt=jwt)
    except Exception as e:
        log.error(f"export rules failed: {e}")
        raise HTTPException(401, "auth failed")

    # Return clean rule objects without internal IDs/timestamps
    export_data = []
    for rule in rules:
        export_data.append({
            "driver_name": rule.get("driver_name"),
            "parallel": rule.get("parallel"),
            "grade": rule.get("grade"),
            "max_price": rule.get("max_price"),
            "max_percent_of_median": rule.get("max_percent_of_median"),
            "ending_soon_only": rule.get("ending_soon_only", False),
            "max_per_day": rule.get("max_per_day", 3),
            "name": rule.get("name"),
            "discord_enabled": rule.get("discord_enabled", False),
            "discord_webhook_url": rule.get("discord_webhook_url"),
        })

    return {
        "status": "ok",
        "exported_at": datetime.utcnow().isoformat(),
        "count": len(export_data),
        "rules": export_data,
    }


@router.post("/rules/import")
def import_rules(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """Import snipe rules from JSON file. Validates structure, creates active rules."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        raise HTTPException(500, "supabase not configured")

    jwt = None
    if authorization and authorization.lower().startswith("bearer "):
        jwt = authorization.split(None, 1)[1]
    if not jwt:
        raise HTTPException(401, "missing auth")

    # Get current user from JWT via Supabase
    try:
        user_resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {jwt}"}
        )
        if user_resp.status_code != 200:
            raise HTTPException(401, "invalid token")
        user_data = user_resp.json()
        user_id = user_data.get("id")
    except Exception as e:
        log.error(f"failed to get user from JWT: {e}")
        raise HTTPException(401, "auth failed")

    rules_to_import = body.get("rules", [])
    if not isinstance(rules_to_import, list):
        raise HTTPException(400, "rules must be an array")

    created = 0
    errors = []

    for idx, rule in enumerate(rules_to_import):
        try:
            # Validate required fields exist (allow empty)
            if not isinstance(rule, dict):
                errors.append(f"Rule {idx}: not an object")
                continue

            # Build insert row
            row = {
                "user_id": user_id,
                "driver_name": rule.get("driver_name"),
                "parallel": rule.get("parallel"),
                "grade": rule.get("grade"),
                "max_price": rule.get("max_price"),
                "max_percent_of_median": rule.get("max_percent_of_median"),
                "ending_soon_only": bool(rule.get("ending_soon_only", False)),
                "max_per_day": int(rule.get("max_per_day", 3)),
                "active": True,
                "name": rule.get("name") or "Imported rule",
                "discord_enabled": bool(rule.get("discord_enabled", False)),
                "discord_webhook_url": rule.get("discord_webhook_url") or None,
            }

            # Validate numeric fields
            if row["max_price"] is not None:
                row["max_price"] = float(row["max_price"])
            if row["max_percent_of_median"] is not None:
                row["max_percent_of_median"] = float(row["max_percent_of_median"])

            resp = _sb_post("user_snipe_rules", row, service=False, jwt=jwt)
            if resp.status_code >= 300:
                errors.append(f"Rule {idx}: {resp.text[:100]}")
            else:
                created += 1
        except Exception as e:
            errors.append(f"Rule {idx}: {str(e)[:100]}")

    return {
        "status": "ok" if created > 0 else "partial",
        "created": created,
        "errors": errors if errors else None,
        "total_attempted": len(rules_to_import),
    }


@router.get("/fresh-snipes/{limit}")
def get_fresh_snipes(limit: int = 6, response: Response = None, db: Session = Depends(get_db)):
    """Public: return top N snipe-worthy auctions from DB (no eBay API calls).

    Previously made a live eBay Browse API call per-candidate (50+ calls),
    which always timed out the 5s dashboard fetch. Now uses DB data only —
    sub-100ms response, no quota burn.
    """
    from sqlalchemy.orm import joinedload
    if response is not None:
        # Lightweight DB query but called on every dashboard load — 5min
        # fresh + 30min SWR matches the */15 keepalive warm cadence so the
        # dashboard's 5s Promise.race never hits a cold function.
        response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=1800"

    BORING_PARALLELS = {"Base", "B&W Ray Wave", "B&W Lazer", "Floor It", "Four & More"}
    RARE_PRINT_RE = re.compile(r"/(5|10|15|20|25|50|75|99|150|199|250|299)\b")
    AUTO_RE = re.compile(r"\bauto(graph)?\b|\bsigned\b", re.IGNORECASE)

    now = datetime.utcnow()
    window = now + timedelta(hours=24)

    rows = (
        db.query(Auction)
        .options(joinedload(Auction.card))
        .filter(
            Auction.status == "active",
            Auction.end_time > now,
            (Auction.end_time <= window) | (Auction.snipe_eligible == True),
            # Snipes are bid auctions, not BIN. Verdicts on BINs are valid
            # info but they're not snipes — that's a different concept.
            Auction.buying_options.like('%AUCTION%'),
        )
        .order_by(Auction.end_time.asc())
        .limit(300)
        .all()
    )

    candidates = []
    for a in rows:
        # Title-derived: a.card.parallel is a driver-level join fallback and
        # disagreed with the title on 77% of active auctions, so BORING_PARALLELS
        # was filtering the wrong rows (real Ray Waves slipped through as
        # "Autograph", real autographs got dropped as "Base").
        parallel = effective_parallel(a.title, a.card.parallel if a.card else None) or ""
        title = (a.title or "").lower()
        price = a.current_price or 0

        if parallel in BORING_PARALLELS:
            continue
        # Empty parallel = Base/unknown. Only keep if auto or rare print run.
        if not parallel and not AUTO_RE.search(title) and not RARE_PRINT_RE.search(title):
            continue
        if price < 5 and not RARE_PRINT_RE.search(title) and not AUTO_RE.search(title):
            continue

        candidates.append(a)

    # Sort: snipe_eligible first, then by score desc, then ending soonest.
    candidates.sort(key=lambda a: (
        0 if a.snipe_eligible else 1,
        -(a.snipe_score or 0),
        (a.end_time - now).total_seconds() if a.end_time else 999999,
    ))

    top = candidates[:limit]

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
                "buying_options": json.loads(a.buying_options) if a.buying_options else [],
                "driver_name": a.card.driver_name if a.card else None,
                "parallel": effective_parallel(a.title, a.card.parallel if a.card else None),
                "snipe_score": a.snipe_score,
                "snipe_eligible": a.snipe_eligible,
                "ebay_url": a.ebay_url,
                "image_url": a.image_url,
                "bid_count": a.bid_count,
                "last_updated": a.last_updated.isoformat() if a.last_updated else None,
            }
            for a in top
        ],
    }
