"""Discord webhook poster — fire-and-forget, never blocks alert pipeline."""
import httpx
import logging

log = logging.getLogger("discord_alert")


async def post_to_discord(webhook_url: str, auction: dict, rule_name: str = ""):
    """Send a Discord embed for a snipe match. Returns True on success."""
    if not webhook_url or not webhook_url.startswith("https://discord.com/api/webhooks/"):
        return False
    try:
        title = (auction.get("title") or "F1 Card Snipe")[:200]
        price = auction.get("current_price") or 0
        median = auction.get("median_price") or 0
        url = auction.get("ebay_url") or ""
        image = auction.get("image_url")
        time_left = auction.get("time_left") or 0
        hrs = int(time_left // 3600)
        mins = int((time_left % 3600) // 60)
        embed = {
            "title": f"🎯 {rule_name or 'Snipe Match'}",
            "description": title,
            "url": url,
            "color": 0xDC2626,
            "fields": [
                {"name": "Current price", "value": f"${price:.2f}", "inline": True},
                {"name": "Median comp", "value": f"${median:.2f}" if median else "—", "inline": True},
                {"name": "Time left", "value": f"{hrs}h {mins}m" if hrs else f"{mins}m", "inline": True},
            ],
        }
        if image:
            embed["thumbnail"] = {"url": image}
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(webhook_url, json={"embeds": [embed], "username": "F1 Card Vault"})
            return r.status_code < 300
    except Exception as e:
        log.warning(f"discord post failed: {e}")
        return False
