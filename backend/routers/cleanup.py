"""
Card-lot DB sweep — scan active Auction titles and flip bundles / multi-card
lots to status='ended' so they stop polluting the single-card feed.

Admin-gated (matches the /api/ebay/refresh pattern): ADMIN_TOKEN via ?token=,
X-Admin-Token header, or vercel-cron UA.
"""
import os
import re

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from database import get_db, Auction

router = APIRouter(prefix="/api/cleanup", tags=["cleanup"])

# Mirrors the LOT_RE regex in frontend/src/pages/Auctions.jsx. Keep in sync.
LOT_RE = re.compile(
    r"\b(lot\s*(of\s*)?\d*|lot\*?\d+|\d+\s*[\-xX]\s*\d+|"
    r"\d+\s*(card|pc|pieces?|cards?)\s*(lot|bundle|set)?|"
    r"\(\d+\)\s*cards?|bundle|\d+\s*card\s*lot|pack\s*of\s*\d+|"
    r"team\s*set|card\s*lot)\b",
    re.I,
)
# Also catch "2x", "x2", "x 3" style quantity prefixes/suffixes.
MULT_RE = re.compile(r"\b[x×]\s*[2-9]\b|\b[2-9]\s*[x×]\b", re.I)


def _is_card_lot(title: str) -> bool:
    if not title:
        return False
    t = title.lower()
    return bool(LOT_RE.search(t) or MULT_RE.search(t))


def _admin_ok(request: Request) -> bool:
    admin_token = os.getenv("ADMIN_TOKEN", "")
    qtoken = request.query_params.get("token", "")
    header_token = request.headers.get("x-admin-token", "")
    ua = request.headers.get("user-agent", "").lower()
    if "vercel-cron" in ua:
        return True
    if not admin_token:
        return False
    return qtoken == admin_token or header_token == admin_token


@router.post("/card-lots")
def sweep_card_lots(request: Request, db: Session = Depends(get_db)):
    """
    Sweep all active Auction rows, flip bundle/lot titles to status='ended'.

    The Auction table has no is_duplicate column (only SoldCard does), so we
    use status='ended' as the kill-switch — same path the rest of the app uses
    to hide expired listings.
    """
    if not _admin_ok(request):
        return {"ok": False, "error": "unauthorized"}

    scanned = 0
    flagged = 0
    samples: list[str] = []

    # Only touch active rows so we don't thrash already-ended history.
    q = db.query(Auction).filter(Auction.status == "active")
    for a in q.yield_per(500):
        scanned += 1
        if _is_card_lot(a.title or ""):
            a.status = "ended"
            flagged += 1
            if len(samples) < 10:
                samples.append((a.title or "")[:120])

    if flagged:
        db.commit()

    return {
        "ok": True,
        "scanned": scanned,
        "flagged": flagged,
        "samples": samples,
    }
