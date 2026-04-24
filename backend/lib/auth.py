"""Lightweight Supabase JWT verifier — extracts user_id from Authorization header."""
import os
import jwt
from fastapi import Header, HTTPException
from typing import Optional

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


def get_user_id(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Returns the supabase user_id if a valid JWT is provided. Otherwise None (anonymous)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    try:
        # Supabase signs JWTs with HS256 + the JWT secret
        payload = jwt.decode(
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
