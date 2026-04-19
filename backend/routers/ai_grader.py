"""AI card grade predictor via Claude Haiku. Accepts an uploaded image and
returns {predicted_grade, confidence, reasoning, issues}."""

import base64
import json
import os
import re

from fastapi import APIRouter, File, UploadFile, HTTPException

router = APIRouter(prefix="/api/ai", tags=["ai_grader"])


PROMPT = (
    "You are an expert TCG/sports-card grader. The user uploaded a photo of "
    "a Formula 1 trading card (likely 2025 Topps Chrome F1). Evaluate the "
    "condition visible in the photo and predict the likely PSA grade (1-10, "
    "0.5 increments). Consider: corners, edges, centering, surface scratches, "
    "print defects, whitening.\n\n"
    "Respond with ONLY a valid JSON object (no markdown fences, no prose), "
    "with these exact keys:\n"
    '{\n'
    '  "predicted_grade": number (e.g. 9.5),\n'
    '  "confidence": number between 0 and 1,\n'
    '  "reasoning": short paragraph (2-3 sentences) explaining the grade,\n'
    '  "issues": array of short strings listing visible flaws (empty if none)\n'
    '}\n'
    "If you cannot tell (blurry, wrong angle, not a card), return "
    '{"predicted_grade": null, "confidence": 0, "reasoning": "...", "issues": [...]}.'
)


def _extract_json(text: str) -> dict:
    # Claude sometimes wraps in ```json fences despite instructions
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("no JSON object found in model response")
    return json.loads(m.group(0))


@router.post("/grade")
async def predict_grade(image: UploadFile = File(...)):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            503,
            "ANTHROPIC_API_KEY not configured on server. Add it to Vercel env vars to enable grade prediction.",
        )

    # Read & encode image
    try:
        data = await image.read()
        if not data:
            raise HTTPException(400, "Empty image")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(400, "Image too large (max 10MB)")
        b64 = base64.standard_b64encode(data).decode("ascii")
        media_type = image.content_type or "image/jpeg"
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to read image: {str(e)[:200]}")

    # Call Claude Haiku
    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        {"type": "text", "text": PROMPT},
                    ],
                }
            ],
        )
        text = ""
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                text += block.text
    except Exception as e:
        raise HTTPException(502, f"Claude API call failed: {str(e)[:300]}")

    try:
        parsed = _extract_json(text)
    except Exception as e:
        return {
            "predicted_grade": None,
            "confidence": 0,
            "reasoning": f"Could not parse model response: {str(e)[:100]}",
            "issues": [],
            "raw": text[:500],
        }

    # Sanity-clamp
    g = parsed.get("predicted_grade")
    if isinstance(g, (int, float)):
        parsed["predicted_grade"] = max(0, min(10, round(float(g) * 2) / 2))
    c = parsed.get("confidence")
    if isinstance(c, (int, float)):
        parsed["confidence"] = max(0, min(1, float(c)))
    if not isinstance(parsed.get("issues"), list):
        parsed["issues"] = []
    return parsed


SCAN_PROMPT = (
    "You are an expert F1 trading card identifier. The user uploaded a photo "
    "of a 2025 Topps Chrome Formula 1 card (base set, parallels, or autograph). "
    "Identify the card details AND predict the grade.\n\n"
    "Respond with ONLY valid JSON (no fences, no prose):\n"
    '{\n'
    '  "driver_name": string (e.g. "Max Verstappen") or null,\n'
    '  "parallel": string — one of: "Base", "Refractor", "Prism Refractor", "Aqua /199", "Pink /250", "Blue /150", "Green /99", "Gold /50", "Orange /25", "Black /10", "Red /5", "SuperFractor", "Autograph", "Neon Nations", "Vegas at Night", "Helix", "F1 75th /75", "Teal /299", "Diamond 75th", "Helmet Collection", "Ultrasonic", "Speed Demons", "Floor It", "Four & More", "B&W Ray Wave", "B&W Lazer", or null,\n'
    '  "card_number": string (e.g. "#42") or null,\n'
    '  "team": string or null,\n'
    '  "predicted_grade": number 1-10 (0.5 increments) or null,\n'
    '  "confidence": number 0-1,\n'
    '  "reasoning": 1-2 sentences,\n'
    '  "issues": array of visible flaws\n'
    '}'
)


@router.post("/scan-card")
async def scan_card(image: UploadFile = File(...)):
    """Full card identification + grade prediction from photo."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")

    try:
        data = await image.read()
        if not data:
            raise HTTPException(400, "Empty image")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(400, "Image too large (max 10MB)")
        b64 = base64.standard_b64encode(data).decode("ascii")
        media_type = image.content_type or "image/jpeg"
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to read image: {str(e)[:200]}")

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        {"type": "text", "text": SCAN_PROMPT},
                    ],
                }
            ],
        )
        text = ""
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                text += block.text
    except Exception as e:
        raise HTTPException(502, f"Claude API call failed: {str(e)[:300]}")

    try:
        parsed = _extract_json(text)
    except Exception as e:
        return {
            "driver_name": None, "parallel": None, "card_number": None, "team": None,
            "predicted_grade": None, "confidence": 0,
            "reasoning": f"Could not parse: {str(e)[:100]}",
            "issues": [], "raw": text[:500],
        }

    g = parsed.get("predicted_grade")
    if isinstance(g, (int, float)):
        parsed["predicted_grade"] = max(0, min(10, round(float(g) * 2) / 2))
    c = parsed.get("confidence")
    if isinstance(c, (int, float)):
        parsed["confidence"] = max(0, min(1, float(c)))
    if not isinstance(parsed.get("issues"), list):
        parsed["issues"] = []
    return parsed
