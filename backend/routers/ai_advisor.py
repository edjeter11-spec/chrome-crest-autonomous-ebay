"""
AI-powered portfolio advisor + listing fraud scoring via Claude Haiku.

Endpoints:
  POST /api/ai/portfolio-advice   — recommends cards to sell/hold
  POST /api/ai/score-listing      — evaluates an eBay listing for legitimacy

Both gracefully return 503 when ANTHROPIC_API_KEY is unset.
"""
import json
import os
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db, Portfolio, Card, Auction, SoldCard

router = APIRouter(prefix="/api/ai", tags=["ai_advisor"])


def _extract_json(text: str) -> dict:
    """Strip ```json fences and extract the first JSON object."""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("no JSON object in model response")
    return json.loads(m.group(0))


def _median_for(db: Session, driver: str, parallel: str, days: int = 90) -> float | None:
    cutoff = datetime.utcnow() - timedelta(days=days)
    q = db.query(SoldCard.sale_price).filter(
        SoldCard.driver_name == driver,
        SoldCard.sale_date >= cutoff,
        SoldCard.sale_price > 0,
        SoldCard.is_duplicate == False,  # noqa: E712
    )
    if parallel and parallel != "Base":
        q = q.filter(SoldCard.parallel == parallel)
    prices = sorted([float(r[0]) for r in q.all() if r[0]])
    if not prices:
        return None
    n = len(prices)
    return prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2


@router.post("/portfolio-advice")
def portfolio_advice(db: Session = Depends(get_db)):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "status": "no_key",
            "message": "Set ANTHROPIC_API_KEY in Vercel env to enable advisor",
        }

    # Pull portfolio rows with current market medians
    items = db.query(Portfolio).all()
    if not items:
        return {"status": "empty", "message": "Portfolio is empty — add holdings first."}

    rows = []
    for p in items:
        card = db.query(Card).filter(Card.id == p.card_id).first()
        if not card:
            continue
        median = _median_for(db, card.driver_name or "", card.parallel or "")
        cost = (p.purchase_price or 0) * (p.quantity or 1)
        value = (median or 0) * (p.quantity or 1) if median else None
        profit_pct = None
        if median and cost > 0:
            profit_pct = round((median * (p.quantity or 1) - cost) / cost * 100, 1)
        rows.append({
            "portfolio_id": p.id,
            "driver": card.driver_name,
            "parallel": card.parallel,
            "grade": card.grade,
            "qty": p.quantity or 1,
            "purchase_price": round(p.purchase_price or 0, 2),
            "current_median": round(median, 2) if median else None,
            "profit_pct": profit_pct,
        })

    prompt = (
        "You are a sports-card portfolio advisor. Below is a collector's holdings "
        "with cost basis and current market medians. Recommend up to 5 cards to "
        "SELL NOW and up to 3 to HOLD. Focus on profit-taking, stale positions, "
        "and risk management.\n\n"
        f"Portfolio:\n{json.dumps(rows, indent=2)}\n\n"
        "Respond with ONLY a valid JSON object (no prose, no markdown fences):\n"
        "{\n"
        '  "sell": [{"card":"Driver – Parallel – Grade","reason":"...","current_value":N,"profit_pct":N}],\n'
        '  "hold": [{"card":"Driver – Parallel – Grade","reason":"..."}]\n'
        "}"
    )

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    except Exception as e:
        raise HTTPException(502, f"Claude call failed: {str(e)[:300]}")

    try:
        parsed = _extract_json(text)
    except Exception:
        return {
            "status": "parse_error",
            "raw": text[:600],
            "sell": [],
            "hold": [],
        }

    parsed.setdefault("sell", [])
    parsed.setdefault("hold", [])
    parsed["status"] = "ok"
    parsed["portfolio_size"] = len(rows)
    return parsed


@router.post("/score-listing")
async def score_listing(body: dict, db: Session = Depends(get_db)):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "status": "no_key",
            "message": "Set ANTHROPIC_API_KEY in Vercel env to enable listing scorer",
        }

    ebay_url = (body or {}).get("ebay_url", "").strip()
    if not ebay_url:
        raise HTTPException(400, "ebay_url required")

    # Prefer existing auction data before scraping
    auction = db.query(Auction).filter(Auction.ebay_url == ebay_url).first()
    title = auction.title if auction else None
    seller = auction.seller if auction else None
    price = auction.current_price if auction else None
    feedback = auction.seller_feedback if auction else None
    image_url = auction.image_url if auction else None

    # Fallback: lightweight HTML fetch
    if not title:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                r = await client.get(ebay_url, headers={"User-Agent": "Mozilla/5.0"})
                html = r.text[:40000]
                m = re.search(r"<title>([^<]+)</title>", html, re.I)
                if m:
                    title = m.group(1).strip()
        except Exception:
            pass

    if not title:
        raise HTTPException(400, "Could not load listing title from URL")

    prompt = (
        "You are evaluating an eBay trading-card listing for legitimacy and fraud risk. "
        "Score from 0 (clear scam / misleading) to 100 (clearly legitimate). "
        "Focus on: title clarity, misleading language (e.g. 'rookie' on non-rookies), "
        "seller pattern, unrealistic pricing, common scam indicators.\n\n"
        f"Listing URL: {ebay_url}\n"
        f"Title: {title}\n"
        f"Current price: ${price or 'unknown'}\n"
        f"Seller: {seller or 'unknown'}\n"
        f"Seller feedback: {feedback or 'unknown'}\n"
        f"Image: {image_url or 'n/a'}\n\n"
        "Respond with ONLY a valid JSON object (no prose, no markdown):\n"
        "{\n"
        '  "legitimacy_score": 0-100,\n'
        '  "red_flags": ["string", ...],\n'
        '  "green_flags": ["string", ...],\n'
        '  "summary": "one-paragraph verdict"\n'
        "}"
    )

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    except Exception as e:
        raise HTTPException(502, f"Claude call failed: {str(e)[:300]}")

    try:
        parsed = _extract_json(text)
    except Exception:
        return {
            "status": "parse_error",
            "raw": text[:600],
            "legitimacy_score": None,
            "red_flags": [],
            "green_flags": [],
            "summary": "Could not parse model response",
        }

    score = parsed.get("legitimacy_score")
    if isinstance(score, (int, float)):
        parsed["legitimacy_score"] = max(0, min(100, int(score)))
    parsed.setdefault("red_flags", [])
    parsed.setdefault("green_flags", [])
    parsed.setdefault("summary", "")
    parsed["status"] = "ok"
    parsed["title"] = title
    return parsed
