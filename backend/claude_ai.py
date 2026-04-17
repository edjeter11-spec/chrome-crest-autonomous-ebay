import os
import anthropic
from database import SessionLocal, Card, PriceHistory, Auction
from sqlalchemy import desc

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


def get_card_context(card_id: int) -> dict:
    db = SessionLocal()
    try:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            return {}

        recent_prices = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card_id)
            .order_by(desc(PriceHistory.sale_date))
            .limit(10)
            .all()
        )

        active_auctions = (
            db.query(Auction)
            .filter(Auction.card_id == card_id, Auction.status == "active")
            .all()
        )

        price_trend = []
        for ph in recent_prices:
            price_trend.append(ph.price)

        return {
            "card": card,
            "price_trend": price_trend,
            "active_auctions": len(active_auctions),
            "lowest_auction": min([a.current_price for a in active_auctions], default=None),
        }
    finally:
        db.close()


async def analyze_card(card_id: int, context: str = "") -> dict:
    data = get_card_context(card_id)
    if not data:
        return {"error": "Card not found"}

    card = data["card"]
    price_trend = data["price_trend"]

    price_trend_str = ", ".join([f"${p:.2f}" for p in price_trend]) if price_trend else "No recent sales"
    avg_price = sum(price_trend) / len(price_trend) if price_trend else card.base_value

    prompt = f"""You are an expert F1 trading card investment analyst. Analyze this card and provide a concise investment recommendation.

Card Details:
- Driver: {card.driver_name}
- Year: {card.year}
- Set: {card.set_name}
- Parallel: {card.parallel}
- Grade: {card.grade}
- Card Number: #{card.card_number}
- Current Market Value: ${card.base_value:.2f}
- Investment Score: {card.investment_score}/100
- Recent Sale Prices: {price_trend_str}
- Average Recent Price: ${avg_price:.2f}
- Active eBay Listings: {data['active_auctions']}
{f"- Lowest Active Listing: ${data['lowest_auction']:.2f}" if data['lowest_auction'] else ""}
{f"Additional Context: {context}" if context else ""}

Respond in this exact JSON format:
{{
  "recommendation": "BUY|HOLD|SELL|WATCH",
  "price_target": <number>,
  "reasoning": "<2-3 sentences>",
  "risk_level": "LOW|MEDIUM|HIGH",
  "confidence": "LOW|MEDIUM|HIGH",
  "key_factors": ["factor1", "factor2", "factor3"]
}}"""

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )

        import json
        text = message.content[0].text.strip()
        # Extract JSON from response
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)

        return {
            "card_id": card_id,
            "driver_name": card.driver_name,
            "recommendation": result.get("recommendation", "HOLD"),
            "investment_score": card.investment_score,
            "price_target": result.get("price_target", card.base_value * 1.2),
            "reasoning": result.get("reasoning", ""),
            "risk_level": result.get("risk_level", "MEDIUM"),
            "confidence": result.get("confidence", "MEDIUM"),
            "key_factors": result.get("key_factors", []),
        }

    except Exception as e:
        # Fallback without API key
        rec = "BUY" if card.investment_score >= 70 else "HOLD" if card.investment_score >= 50 else "SELL"
        return {
            "card_id": card_id,
            "driver_name": card.driver_name,
            "recommendation": rec,
            "investment_score": card.investment_score,
            "price_target": round(card.base_value * 1.25, 2),
            "reasoning": f"{card.driver_name}'s {card.parallel} parallel from {card.year} shows {'strong' if card.investment_score > 70 else 'moderate'} investment potential. "
                        f"Current market value ${card.base_value:.2f} with investment score {card.investment_score}/100. "
                        f"{'High demand from collectors with limited supply.' if card.investment_score > 75 else 'Market conditions suggest cautious approach.'}",
            "risk_level": "LOW" if card.investment_score >= 75 else "MEDIUM" if card.investment_score >= 50 else "HIGH",
            "confidence": "HIGH" if len(price_trend) >= 10 else "MEDIUM",
            "key_factors": [
                f"Investment score: {card.investment_score}/100",
                f"Parallel rarity: {card.parallel}",
                f"Grade quality: {card.grade}",
            ],
        }
