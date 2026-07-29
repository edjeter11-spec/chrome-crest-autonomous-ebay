# F1 Card Vault

F1 trading-card tracker, scanner, and auction sniper. Repo name is legacy (`chrome-crest-autonomous-ebay`); brand and live domain are **F1 Card Vault**.

**Live:** https://f1cardvault.com (canonical is **apex**; `www` 307s → apex)
**Git branch:** `master`

## Stack
- Backend: FastAPI (Python) on Vercel lambda (`backend/main.py`)
- Frontend: React + Vite (`frontend/`)
- DB: Neon Postgres + Supabase (auth + portfolio tables w/ RLS)
- Auth: Supabase — Google OAuth + email/password
- Scraping: Playwright + stealth (GH Actions cron)
- AI: Anthropic Haiku vision for card-scan
- Affiliate: eBay Partner Network (EPN)

## Commands
- Frontend dev: `cd frontend && npm run dev`
- Backend dev: `cd backend && uvicorn main:app --reload`
- **Before deploy:** `cd frontend && npm run build` (dist is gitignored — Vercel uploads local dist)
- `vercel --prod --yes`

## Cold-start mitigation
Python lambda cold start ≈ 13s TTFB (warm ≈ 0.2s). `/api/cron/keepalive` (*/4 min) self-fetches + pre-warms CDN-cached endpoints:
- `with-verdicts?limit=500` (home default strip)
- `with-verdicts?buying=auction`
- CDN cache: `s-maxage=300, swr=1800`
- `scheduler` import is deferred into local-dev-only branch so it doesn't load scraper/ebay_api on every cold start.

## Env vars (Vercel)
- `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_APP_SECRET`, `ADMIN_TOKEN` — Browse API OAuth2 (keyset approved post-Marketplace-Deletion exemption, 5000 calls/day)
- `VITE_EBAY_CAMPID=5339150649` — EPN affiliate. **DO NOT mark "Sensitive"** — `vercel pull` will hide it and local builds will silently drop it.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — project `pujpmjqunwlizcbybmyd` (NOT `grbswzfizblkekrzhadw` — that one is abandoned)
- `ANTHROPIC_API_KEY` — card-scan vision

## OAuth
Google client id `64026774709-l11qeivdqituue1kslcng5spaprnmc2e.apps.googleusercontent.com`. Redirect URI = **Supabase callback** (not site domain). When rotating, add `https://www.f1cardvault.com` to Authorized JS origins.

## Data pipelines
- `/api/ebay/refresh` (15-min cron) → Browse API → `auctions` table (ACTIVE only)
- `scripts/scrape_runner.py` (GH Actions cron) → Playwright/stealth → `sold_cards` + active upsert. Includes broad queries + per-driver $40+ premium queries for deep comp history.
- SportsCardsPro scraper emits synthetic rows → sales endpoints default `exclude_source=SportsCardsPro`.

## Site behavior quirks
- Backend stores `auctions.end_time` as **naive UTC** — frontend `parseUtc()` appends `Z`.
- BiggestSnipes filters to listings with `last_updated < 15min` to avoid showing stale $X vs real current_bid.
- iOS web-push only works after Add-to-Home-Screen; Sniper PushCTA detects non-PWA Safari and shows install steps instead of a broken Enable button.
- Scanned cards live in Supabase `user_portfolio`, merged into Holdings, shown with user photo + "AI" badge; comp lookup uses driver+parallel only (AI grade = prediction = treated as Raw).
- "Jump to Parallel" passes filters via URL; `SalesDatabase` seeds state from `useSearchParams`.

## Mobile bottom tabs
Home · Deals · Sales · Mine · Snipe (Grade Profit merged into Arbitrage; AI Grader embedded inside Mine).

## House rules
- Never re-add the `frontend/dist` to git; always build before `vercel --prod`.
- Never mark `VITE_EBAY_CAMPID` Sensitive.
- Use `parseUtc()` for any auction time on the frontend.
- Don't import scraper/ebay_api at module top-level in backend — defer.
