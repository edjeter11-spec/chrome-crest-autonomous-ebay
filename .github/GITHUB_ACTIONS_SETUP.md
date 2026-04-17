# GitHub Actions Scraper Setup

The scraper at `scripts/scrape_runner.py` runs on GitHub Actions (free 2000 min/mo) and writes directly to the Neon Postgres DB. Bypasses every API quota and bot challenge that blocks Vercel-side scraping.

## One-time setup

### 1. Create a GitHub repo + push this code

```bash
cd "C:/Users/User/Desktop/chrome-crest-autonomous-ebay"
git init
git add .
git commit -m "Initial Chrome Crest"
gh repo create chrome-crest-autonomous-ebay --private --source=. --push
```

Or use the GitHub website to create the repo and push manually.

### 2. Add the DATABASE_URL secret

In the GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `DATABASE_URL`
- Value: (the Postgres URL from your Vercel env — pull it with `vercel env pull .env.prod` and copy the `DATABASE_URL` line)

### 3. Trigger the first run

Go to **Actions tab → "Scrape eBay (Playwright)" → Run workflow**.

It'll take ~5-10 minutes for the first run because it installs Chromium. Subsequent runs are faster.

## What it does

- Runs every 3 hours automatically
- Hits eBay search HTML directly (no API quota)
- Scrapes both sold + active auction listings for 10 queries
- Upserts non-base 2025 Topps Chrome F1 cards into the `sold_cards` table
- Writes ~50-200 fresh rows per run

## Monitoring

Check the **Actions tab** for run history. Each run logs how many rows were seen + upserted.
