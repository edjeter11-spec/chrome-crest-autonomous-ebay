"""Weekly digest email — top STRONG BUYs rendered to HTML, optionally sent via Resend."""
import os
from typing import Optional
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from routers.auctions import list_with_verdicts

router = APIRouter(prefix="/api/digest", tags=["digest"])

EBAY_CAMPID = os.getenv("EBAY_CAMPID", "")
EBAY_CUSTOMID = os.getenv("EBAY_CUSTOMID", "f1cardhub")
EBAY_ROTATOR = "711-53200-19255-0"


def ebay_affiliate_url(url: str) -> str:
    if not url or not EBAY_CAMPID:
        return url or ""
    try:
        p = urlparse(url)
        if "ebay." not in (p.hostname or ""):
            return url
        q = dict(parse_qsl(p.query))
        q.update({
            "mkcid": "1",
            "mkrid": EBAY_ROTATOR,
            "siteid": "0",
            "campid": EBAY_CAMPID,
            "customid": EBAY_CUSTOMID,
            "toolid": "10001",
            "mkevt": "1",
        })
        return urlunparse(p._replace(query=urlencode(q)))
    except Exception:
        return url


def _build_html(picks: list[dict]) -> str:
    if not picks:
        return (
            "<h2>F1 Card Hub — Weekly Digest</h2>"
            "<p>No STRONG BUYs on the board right now. Check back soon.</p>"
        )
    rows = []
    for p in picks:
        driver = p.get("driver") or "—"
        parallel = p.get("parallel") or ""
        price = p.get("price") or 0
        median = p.get("median") or 0
        pct = p.get("pct_below") or 0
        link = p.get("link") or "#"
        rows.append(
            f"<tr>"
            f"<td style='padding:10px 8px;border-bottom:1px solid #eee;'>"
            f"<strong>{driver}</strong> {parallel}"
            f"</td>"
            f"<td style='padding:10px 8px;border-bottom:1px solid #eee;text-align:right;'>"
            f"${price:.0f}"
            f"</td>"
            f"<td style='padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#888;'>"
            f"${median:.0f}"
            f"</td>"
            f"<td style='padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#2e7d32;'>"
            f"{pct}% off"
            f"</td>"
            f"<td style='padding:10px 8px;border-bottom:1px solid #eee;text-align:right;'>"
            f"<a href='{link}' style='color:#dc2626;font-weight:bold;'>View</a>"
            f"</td>"
            f"</tr>"
        )
    return (
        "<div style='font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;'>"
        "<h2 style='color:#111;margin-bottom:4px;'>F1 Card Hub — Weekly STRONG BUYs</h2>"
        "<p style='color:#666;margin-top:0;'>Top 5 deals below median right now on eBay.</p>"
        "<table style='width:100%;border-collapse:collapse;font-size:14px;'>"
        "<thead><tr style='text-align:left;color:#555;'>"
        "<th style='padding:8px;'>Card</th>"
        "<th style='padding:8px;text-align:right;'>Price</th>"
        "<th style='padding:8px;text-align:right;'>Median</th>"
        "<th style='padding:8px;text-align:right;'>Discount</th>"
        "<th style='padding:8px;'></th>"
        "</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
        "<p style='color:#999;font-size:11px;margin-top:24px;'>"
        "As an eBay Partner, F1 Card Hub may be compensated when you make a qualifying purchase. "
        "Prices are informational, not investment advice."
        "</p>"
        "</div>"
    )


@router.post("/send")
def send_digest(
    x_admin_token: Optional[str] = Header(default=None, alias="X-Admin-Token"),
    db: Session = Depends(get_db),
):
    admin_token = os.getenv("ADMIN_TOKEN")
    if not admin_token or x_admin_token != admin_token:
        raise HTTPException(status_code=401, detail="unauthorized")

    payload = list_with_verdicts(
        status="active", buying=None, snipe_only=False, driver=None,
        limit=500, offset=0, db=db,
    )
    auctions = payload.get("auctions", []) if isinstance(payload, dict) else []
    strong = [a for a in auctions if a.get("verdict") == "STRONG_BUY"]
    strong.sort(key=lambda a: a.get("snipe_score") or 0, reverse=True)
    top = strong[:5]

    picks = []
    for a in top:
        comp = a.get("verdict_comp") or {}
        median = comp.get("median_total") or 0
        price = (a.get("current_price") or 0) + (a.get("shipping_cost") or 0)
        pct_below = int(round((1 - price / median) * 100)) if median else 0
        card = a.get("card") or {}
        picks.append({
            "driver": card.get("driver_name"),
            "parallel": card.get("parallel"),
            "price": price,
            "median": median,
            "pct_below": pct_below,
            "link": ebay_affiliate_url(a.get("ebay_url") or ""),
        })

    html = _build_html(picks)
    subject = f"F1 Card Hub — {len(picks)} STRONG BUY{'s' if len(picks) != 1 else ''} this week"

    resend_key = os.getenv("RESEND_API_KEY")
    if not resend_key:
        return {"status": "dry_run", "count": len(picks), "preview_html": html}

    to_email = os.getenv("DIGEST_TO_EMAIL", "edjeter11@gmail.com")
    from_email = os.getenv("DIGEST_FROM_EMAIL", "F1 Card Hub <digest@f1cardhub.com>")

    import requests
    r = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {resend_key}",
            "Content-Type": "application/json",
        },
        json={"from": from_email, "to": to_email, "subject": subject, "html": html},
        timeout=15,
    )
    if not r.ok:
        raise HTTPException(status_code=502, detail=f"resend failed: {r.text}")
    return {"status": "sent", "count": len(picks), "to": to_email, "resend": r.json()}
