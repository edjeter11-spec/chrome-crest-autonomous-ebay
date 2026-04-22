# F1 Card Vault — Discord Bot Setup

The `/api/discord/price` endpoint returns a ready-to-post Discord embed payload.
You can use it two ways:

1. **Webhook one-liner** — no bot, just `curl`
2. **discord.py bot** — slash command `/price driver:<name> parallel:<opt>`

---

## 1. Webhook (quickest)

```bash
# Fetch the embed JSON from F1 Card Vault
PAYLOAD=$(curl -s "https://chrome-crest-autonomous-ebay.vercel.app/api/discord/price?driver=Lando+Norris&parallel=Refractor")

# Post to your Discord webhook
curl -X POST -H "Content-Type: application/json" \
     -d "$PAYLOAD" \
     "https://discord.com/api/webhooks/<CHANNEL>/<TOKEN>"
```

Create the webhook in Discord: Server Settings → Integrations → Webhooks → New Webhook.

---

## 2. discord.py bot (slash command)

```python
# bot.py
import os
import httpx
import discord
from discord import app_commands

API_BASE = "https://chrome-crest-autonomous-ebay.vercel.app"

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


@tree.command(name="price", description="Look up F1 card sold-comp prices")
@app_commands.describe(
    driver="Driver name, e.g. Lando Norris",
    parallel="Optional parallel: Refractor, SuperFractor, Aqua /199, etc.",
    grade="Optional grade: PSA 10, PSA 9, etc.",
)
async def price(interaction: discord.Interaction, driver: str, parallel: str = None, grade: str = None):
    await interaction.response.defer()
    params = {"driver": driver}
    if parallel:
        params["parallel"] = parallel
    if grade:
        params["grade"] = grade
    async with httpx.AsyncClient(timeout=10.0) as session:
        r = await session.get(f"{API_BASE}/api/discord/price", params=params)
        data = r.json()
    embed_dict = data["embeds"][0]
    embed = discord.Embed(
        title=embed_dict.get("title"),
        description=embed_dict.get("description"),
        color=embed_dict.get("color", 0x6366F1),
    )
    for f in embed_dict.get("fields", []):
        embed.add_field(name=f["name"], value=f["value"], inline=f.get("inline", False))
    if embed_dict.get("thumbnail"):
        embed.set_thumbnail(url=embed_dict["thumbnail"]["url"])
    if embed_dict.get("footer"):
        embed.set_footer(text=embed_dict["footer"]["text"])
    await interaction.followup.send(embed=embed)


@client.event
async def on_ready():
    await tree.sync()
    print(f"Logged in as {client.user}")


if __name__ == "__main__":
    client.run(os.environ["DISCORD_BOT_TOKEN"])
```

### Install

```bash
pip install "discord.py>=2.3" httpx
export DISCORD_BOT_TOKEN=<your bot token from https://discord.com/developers/applications>
python bot.py
```

### Bot creation checklist

1. https://discord.com/developers/applications → New Application
2. Bot tab → Reset Token → copy to `DISCORD_BOT_TOKEN`
3. OAuth2 → URL Generator → scopes: `bot`, `applications.commands` → permissions: `Send Messages`, `Embed Links` → open URL to add to your server
4. Run `python bot.py` — first `/price` use triggers slash-command sync

---

## Endpoint reference

```
GET /api/discord/price?driver=<name>&parallel=<opt>&grade=<opt>&days=<90>
```

Returns:
```json
{
  "content": null,
  "embeds": [{
    "title": "Lando Norris · Refractor",
    "description": "**Last 90d · 34 sold comps**",
    "color": 6448319,
    "fields": [
      { "name": "Median",  "value": "$42.50", "inline": true },
      { "name": "Average", "value": "$44.12", "inline": true },
      { "name": "Range",   "value": "$18 – $110", "inline": true },
      { "name": "Last sale", "value": "$39.00 · Apr 15", "inline": false }
    ],
    "thumbnail": { "url": "https://i.ebayimg.com/..." },
    "footer": { "text": "F1 Card Vault · Median reference" },
    "timestamp": "2026-04-16T..."
  }]
}
```
