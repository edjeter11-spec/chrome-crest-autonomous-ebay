"""Lightweight Supabase JWT verifier — extracts user_id from Authorization header.

Resilient: if pyjwt isn't installed (Vercel build cache lag or fresh deploy
before requirements.txt picks up), the module imports successfully but every
caller is treated as anonymous. The site keeps working; only per-user features
silently disable until pyjwt lands.
"""
import hmac
import os
from fastapi import Header, HTTPException, Request
from typing import Optional

try:
    import jwt as _jwt
    _JWT_OK = True
except ImportError:
    _jwt = None
    _JWT_OK = False

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "").strip()


def get_user_id(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Returns the supabase user_id if a valid JWT is provided. Otherwise None (anonymous)."""
    if not _JWT_OK or not SUPABASE_JWT_SECRET:
        return None
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    try:
        payload = _jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload.get("sub")
    except Exception:
        return None


def require_user_id(authorization: Optional[str] = Header(None)) -> str:
    """Same as get_user_id but raises 401 if no valid token."""
    uid = get_user_id(authorization)
    if not uid:
        raise HTTPException(401, "authentication required")
    return uid


# --- Admin / cron gates ------------------------------------------------------
# Shared by main.py and routers (routers cannot import main.py — circular).
# Header-only: no ?token= query params (they leak into logs/referrers), no
# User-Agent checks (UA is attacker-controlled). Constant-time compares.

def require_admin(request: Request):
    """Admin gate — X-Admin-Token header only. 503 when ADMIN_TOKEN unset
    (admin disabled, no open-mode fallback), 403 on mismatch."""
    admin_token = os.getenv("ADMIN_TOKEN", "")
    if not admin_token:
        raise HTTPException(503, "admin disabled")
    given = request.headers.get("x-admin-token", "")
    if not given or not hmac.compare_digest(given, admin_token):
        raise HTTPException(403, "unauthorized")


def require_cron_or_admin(request: Request):
    """Allow Vercel cron (Authorization: Bearer CRON_SECRET) or admin
    (X-Admin-Token header). Header-only — no query params, no User-Agent
    checks (UA is attacker-controlled). Constant-time compares."""
    cron_secret = os.getenv("CRON_SECRET", "")
    admin_token = os.getenv("ADMIN_TOKEN", "")
    if not cron_secret and not admin_token:
        # Local-dev fallback: with BOTH secrets unset, allow the request so
        # dev isn't bricked — but never on Vercel.
        if os.getenv("VERCEL") != "1":
            return
        raise HTTPException(status_code=403, detail="forbidden")
    auth = request.headers.get("authorization", "")
    bearer = auth[7:] if auth.lower().startswith("bearer ") else ""
    if cron_secret and bearer and hmac.compare_digest(bearer, cron_secret):
        return
    given = request.headers.get("x-admin-token", "")
    if admin_token and given and hmac.compare_digest(given, admin_token):
        return
    raise HTTPException(status_code=403, detail="forbidden")


def client_ip(request: Request) -> str:
    """Trusted client IP behind Vercel's proxy.

    Uses x-real-ip (Vercel-set) first, then the RIGHTMOST x-forwarded-for
    entry (appended by the trusted proxy — leftmost entries are client-
    supplied and spoofable), then the socket peer."""
    real = (request.headers.get("x-real-ip") or "").strip()
    if real:
        return real
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request and request.client else "unknown"
