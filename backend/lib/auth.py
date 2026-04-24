"""Lightweight Supabase JWT verifier — extracts user_id from Authorization header.

Resilient: if pyjwt isn't installed (Vercel build cache lag or fresh deploy
before requirements.txt picks up), the module imports successfully but every
caller is treated as anonymous. The site keeps working; only per-user features
silently disable until pyjwt lands.
"""
import os
from fastapi import Header, HTTPException
from typing import Optional

try:
    import jwt as _jwt
    _JWT_OK = True
except ImportError:
    _jwt = None
    _JWT_OK = False

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


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
