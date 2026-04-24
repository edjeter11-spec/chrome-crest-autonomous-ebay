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
    "You are an expert Formula 1 trading card identifier specializing in 2025 "
    "Topps Chrome F1 (base set, parallels, inserts, autographs). You will be "
    "shown a photo of a single card. Your job is to identify the DRIVER and "
    "the exact PARALLEL/INSERT and self-rate confidence for each separately.\n\n"
    "== ALLOWED PARALLEL / INSERT VALUES ==\n"
    "Match the card's parallel against EXACTLY ONE of these (case-sensitive):\n"
    "  BASE SET & NUMBERED PARALLELS:\n"
    "    - Base\n"
    "    - Refractor\n"
    "    - Prism Refractor\n"
    "    - Aqua /199\n"
    "    - Pink /250\n"
    "    - Teal /299\n"
    "    - Blue /150\n"
    "    - Green /99\n"
    "    - F1 75th /75\n"
    "    - Gold /50\n"
    "    - Orange /25\n"
    "    - Black /10\n"
    "    - Red /5\n"
    "    - SuperFractor (1/1)\n"
    "  INSERT SETS:\n"
    "    - Neon Nations\n"
    "    - Vegas at Night\n"
    "    - Helix\n"
    "    - Ultrasonic\n"
    "    - The Grail\n"
    "    - Futuro\n"
    "    - Speed Demons\n"
    "    - Speed Wheels\n"
    "    - Ace of Trades\n"
    "    - Top Speed\n"
    "    - Floor It\n"
    "    - Four & More\n"
    "    - Diamond 75th\n"
    "    - Checker Flag\n"
    "    - B&W Ray Wave\n"
    "    - B&W Lazer\n"
    "    - Helmet Collection\n"
    "    - The Chain\n"
    "    - The Grid\n"
    "  OTHER:\n"
    "    - Autograph (any signed card)\n"
    "\n"
    "== PARALLEL IDENTIFICATION HINTS ==\n"
    "Use the dominant background / foil pattern to choose the parallel:\n"
    "  - Neon Nations: bright neon-colored country FLAG background behind "
    "driver, usually stylized flag stripes/patterns in saturated neon hues "
    "matching the driver's nationality. Text usually reads 'NEON NATIONS'.\n"
    "  - Vegas at Night: dark purple/pink neon Vegas strip lights, skyline "
    "silhouette, very dark blue/black base with neon signage.\n"
    "  - Helix: spiraling chrome helix/DNA-like pattern behind driver.\n"
    "  - Ultrasonic: concentric sound-wave / sonar-ring pattern, often "
    "turquoise or chrome ripples.\n"
    "  - Speed Demons: red/orange flame or demon motif, aggressive graphics.\n"
    "  - Speed Wheels: large stylized wheel/tire graphic behind driver.\n"
    "  - Futuro: retro-futuristic grid / synthwave aesthetic, pink/cyan sun.\n"
    "  - The Grail: ornate gold/chrome trophy-like border, 'THE GRAIL' text.\n"
    "  - Ace of Trades: playing-card suit motif (spade/heart/club/diamond).\n"
    "  - Top Speed: speedometer / blurred-motion graphics.\n"
    "  - Floor It: pedal / foot-to-floor graphic, bold yellow/red.\n"
    "  - Four & More: '4+' numerical graphic, usually for multi-winners.\n"
    "  - Diamond 75th: diamond facet pattern, F1 75th anniversary branding.\n"
    "  - Checker Flag: black-and-white checkered flag background.\n"
    "  - B&W Ray Wave: black-and-white ray/wave refractor pattern (no color).\n"
    "  - B&W Lazer: black-and-white laser-beam refractor pattern (no color).\n"
    "  - Helmet Collection: close-up of driver's HELMET (not face) dominant.\n"
    "  - The Chain / The Grid: team-themed multi-driver or grid-layout card.\n"
    "  - Refractor vs Prism Refractor: Refractor = smooth rainbow shimmer. "
    "Prism Refractor = geometric prism/triangle facets visible.\n"
    "  - Numbered parallels (Aqua, Pink, Teal, Blue, Green, Gold, Orange, "
    "Black, Red): identify by the DOMINANT color wash of the chrome border/"
    "background AND by the '/NNN' serial number printed on the card back or "
    "front. If you can read the serial (e.g. '12/199'), that is definitive.\n"
    "  - SuperFractor: golden sparkle/starburst chrome, 1/1.\n"
    "  - Base: no color wash, standard chrome silver/rainbow refractor-lite.\n"
    "\n"
    "== RULES ==\n"
    "1. Driver and parallel confidence are INDEPENDENT — you can be 0.95 "
    "confident on the driver but only 0.4 on the parallel. Rate them "
    "separately and honestly.\n"
    "2. If the parallel is not in the list above, pick the closest match and "
    "mention the mismatch in 'notes'. Do NOT invent new parallel names.\n"
    "3. If you cannot read the driver's name/face clearly, set driver_name "
    "to null and confidence_driver low.\n"
    "4. If the parallel is ambiguous (e.g. could be Refractor or Prism "
    "Refractor), return your best guess but keep confidence_parallel below "
    "0.6 and explain the ambiguity in 'notes'.\n"
    "5. Return TOP 3 driver+parallel combinations ranked by combined "
    "confidence. If you're very sure, the 2nd/3rd can repeat the driver "
    "with alternative parallel guesses.\n"
    "\n"
    "== OUTPUT ==\n"
    "Respond with ONLY valid JSON (no markdown fences, no prose before or "
    "after):\n"
    '{\n'
    '  "top_guesses": [\n'
    '    {\n'
    '      "driver_name": string or null,\n'
    '      "parallel": string (exact value from allowed list) or null,\n'
    '      "confidence_driver": number 0-1,\n'
    '      "confidence_parallel": number 0-1,\n'
    '      "confidence": number 0-1 (combined: min of the two),\n'
    '      "predicted_grade": number 1-10 in 0.5 increments or null,\n'
    '      "grade_confidence": number 0-1,\n'
    '      "print_run": string (e.g. "/199", "/5", "1/1") or null,\n'
    '      "notes": string — reasoning for THIS guess, what you see\n'
    '    }\n'
    '  ],\n'
    '  "card_number": string (e.g. "#42") or null,\n'
    '  "team": string or null,\n'
    '  "reasoning": 1-2 sentences explaining the primary guess,\n'
    '  "issues": array of visible condition flaws\n'
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
            "top_guesses": [],
            "card_number": None, "team": None,
            "reasoning": f"Could not parse: {str(e)[:100]}",
            "issues": [], "raw": text[:500],
        }

    # Normalize top_guesses array
    guesses = parsed.get("top_guesses", [])
    if not isinstance(guesses, list):
        guesses = []

    def _clamp01(v):
        if isinstance(v, (int, float)):
            return max(0.0, min(1.0, float(v)))
        return 0.0

    normalized = []
    for guess in guesses[:3]:  # Top 3 only
        if not isinstance(guess, dict):
            continue
        g = guess.get("predicted_grade")
        if isinstance(g, (int, float)):
            guess["predicted_grade"] = max(0, min(10, round(float(g) * 2) / 2))

        cd = _clamp01(guess.get("confidence_driver"))
        cp = _clamp01(guess.get("confidence_parallel"))
        guess["confidence_driver"] = cd
        guess["confidence_parallel"] = cp

        # Combined confidence = min of driver & parallel if both provided,
        # otherwise fall back to whatever the model returned.
        c = guess.get("confidence")
        if isinstance(c, (int, float)):
            c = _clamp01(c)
        elif cd > 0 or cp > 0:
            c = min(cd, cp) if (cd > 0 and cp > 0) else max(cd, cp)
        else:
            c = 0.0
        guess["confidence"] = c

        gc = guess.get("grade_confidence")
        guess["grade_confidence"] = _clamp01(gc) if isinstance(gc, (int, float)) else 0.0

        if not isinstance(guess.get("notes"), str):
            guess["notes"] = ""
        if not isinstance(guess.get("print_run"), (str, type(None))):
            guess["print_run"] = None

        normalized.append(guess)

    parsed["top_guesses"] = normalized
    if not isinstance(parsed.get("issues"), list):
        parsed["issues"] = []

    # For backwards compatibility with existing code, also set first guess at top level
    if normalized:
        first = normalized[0]
        parsed["driver_name"] = first.get("driver_name")
        parsed["parallel"] = first.get("parallel")
        parsed["predicted_grade"] = first.get("predicted_grade")
        parsed["confidence"] = first.get("confidence")
        parsed["confidence_driver"] = first.get("confidence_driver")
        parsed["confidence_parallel"] = first.get("confidence_parallel")
        parsed["print_run"] = first.get("print_run")
        parsed["notes"] = first.get("notes") or parsed.get("reasoning")

    return parsed
