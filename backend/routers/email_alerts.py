"""Resend email integration. Requires RESEND_API_KEY env var.

Sign up at resend.com (free tier: 3k emails/mo, 100/day). Set RESEND_API_KEY
and optionally RESEND_FROM_EMAIL in Vercel env vars. The `from` address must
be on a verified domain in Resend — default is alerts@f1cardvault.com.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/email", tags=["email"])

RESEND_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "alerts@f1cardvault.com")


async def send_email(to: str, subject: str, html: str) -> dict:
    """Low-level Resend send — returns {sent, status, body} or {sent, reason}."""
    if not RESEND_KEY:
        return {"sent": False, "reason": "no_resend_key"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_KEY}"},
                json={"from": FROM_EMAIL, "to": to, "subject": subject, "html": html},
            )
            return {
                "sent": r.status_code < 300,
                "status": r.status_code,
                "body": r.text[:200],
            }
    except Exception as e:
        return {"sent": False, "reason": "request_failed", "error": str(e)[:200]}


@router.post("/test")
async def send_test_email(to: str = Query(..., description="Recipient email")):
    """Test endpoint — sends a sample email to verify Resend wiring."""
    if not to or "@" not in to:
        raise HTTPException(status_code=400, detail="invalid email")
    return await send_email(
        to,
        "F1 Card Vault — Test alert",
        (
            "<h2>It works!</h2>"
            "<p>Your email alerts are configured. We'll notify you when "
            "cards on your watchlist drop below your alert price.</p>"
        ),
    )


@router.get("/health")
def email_health():
    """Quick config check — does not send. Used by admin UI to show status."""
    return {
        "configured": bool(RESEND_KEY),
        "from": FROM_EMAIL if RESEND_KEY else None,
    }
