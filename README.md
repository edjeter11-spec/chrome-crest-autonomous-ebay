# F1 Chrome Crest — Autonomous eBay Sniping Platform

A full-stack platform for monitoring, analyzing, and autonomously bidding on F1 Chrome Crest trading cards on eBay. Features real-time auction tracking, AI-powered investment scoring, price history analytics, portfolio management, and a snipe bot with configurable thresholds.

---

## Features

- **Live Auction Monitor** — Real-time eBay auction feed with WebSocket updates
- **Autonomous Snipe Bot** — Configurable auto-bidding triggered by snipe score thresholds
- **Driver Analytics** — Investment scoring, win rates, championship data for all 2025 F1 drivers
- **Price History** — Historical sold listings scraped from eBay with trend charts
- **Portfolio Management** — Track owned cards, purchase price, current value, and P&L
- **Wishlist + Auto-Snipe** — Flag cards with max price caps and auto-bid rules
- **Alert System** — Price drop alerts, snipe opportunity notifications, urgency levels
- **PSA Grading Data** — Graded card population reports and grade-based pricing
- **Buy It Now Scanner** — Instant-purchase listings filtered by value score
- **Claude AI Analysis** — Optional AI-powered card valuations via Anthropic API
- **Image Proxy** — Server-side CDN proxying for eBay card images (avoids CORS/hotlink blocks)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI 0.115, Python 3.12, Uvicorn |
| ORM | SQLAlchemy 2.0 |
| Database | SQLite (local), PostgreSQL (production) |
| Scheduler | APScheduler 3.10 |
| Frontend | React 18, Vite 5, React Router 6 |
| Styling | Tailwind CSS 3 |
| Charts | Recharts 2 |
| Icons | Lucide React |
| AI | Anthropic Claude API (optional) |
| Deployment | Vercel |

---

## Project Structure

```
chrome-crest-autonomous-ebay/
├── start.py                  # Single-command dev server launcher
├── requirements.txt          # Python dependencies
├── vercel.json               # Vercel deployment config + cron schedule
├── .env.example              # Environment variable template
├── backend/
│   ├── main.py               # FastAPI app, routes, WebSocket, static serving
│   ├── database.py           # SQLAlchemy models + DB init
│   ├── models.py             # Pydantic request/response schemas
│   ├── scheduler.py          # APScheduler jobs (eBay sync every 5 min)
│   ├── ebay_api.py           # eBay Trading API (bidding, token management)
│   ├── ebay_finding_api.py   # eBay Finding API (search, active listings)
│   ├── scraper.py            # eBay listing scraper
│   ├── scrape_ebay_sold.py   # Sold listings scraper for price history
│   ├── scrape_psa.py         # PSA population report scraper
│   ├── card_image_scraper.py # Card image fetcher from eBay
│   ├── driver_photos.py      # Wikipedia driver headshot fetcher
│   ├── claude_ai.py          # Claude API integration for card analysis
│   ├── seed_data.py          # Initial seed data (drivers, cards)
│   ├── price_history_sync.py # Background price history sync jobs
│   ├── f1cards.db            # SQLite database (local dev only)
│   ├── routers/
│   │   ├── cards.py          # Card CRUD and search
│   │   ├── auctions.py       # Auction listing, snipe execution
│   │   ├── portfolio.py      # Portfolio tracking
│   │   ├── alerts.py         # Alert management
│   │   ├── analytics.py      # Analytics aggregation
│   │   └── wishlist.py       # Wishlist CRUD
│   └── tests/                # Pytest test suite
└── frontend/
    ├── src/
    │   ├── App.jsx            # Router setup, page imports
    │   ├── components/        # Layout, AuctionCard, DriverCard, StatCard, AuctionModal
    │   └── pages/             # Dashboard, Auctions, Portfolio, Wishlist,
    │                          # PriceHistory, Alerts, Analytics, Drivers,
    │                          # PSA, BuyItNow, GradedCards
    ├── vite.config.js         # Dev proxy: /api + /ws → localhost:8000
    ├── tailwind.config.js
    └── package.json
```

---

## Installation

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm 9+

### 1. Clone and install backend dependencies

```bash
git clone <repo-url>
cd chrome-crest-autonomous-ebay
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Configure environment variables

```bash
cp .env.example backend/.env
```

Edit `backend/.env` with your credentials (see [Environment Setup](#environment-setup)).

---

## Environment Setup

Create `backend/.env` from the template:

```env
# eBay Developer Credentials
# Register at https://developer.ebay.com/my/keys
EBAY_APP_ID=your_ebay_app_id
EBAY_APP_SECRET=your_ebay_app_secret
EBAY_SANDBOX=false

# Claude AI (optional — enables AI card analysis)
ANTHROPIC_API_KEY=your_anthropic_api_key

# Database (leave blank for SQLite in dev)
# DATABASE_URL=postgresql://user:pass@host/dbname
```

**eBay credentials** are required for live auction data and snipe execution. Without them, the app runs on seeded mock data.

**`ANTHROPIC_API_KEY`** is optional. The app functions fully without it — AI analysis endpoints return gracefully when absent.

**`DATABASE_URL`** defaults to `backend/f1cards.db` (SQLite). For production, set a PostgreSQL connection string.

---

## Running the Dev Server

### Option A — Single command (recommended)

Starts the FastAPI backend on port 8000. The backend serves the pre-built React frontend from `frontend/dist/`.

```bash
python start.py
```

App available at: **http://localhost:8000**
API docs (Swagger): **http://localhost:8000/docs**

### Option B — Full dev mode with hot reload

Run backend and frontend concurrently for hot-reloading on both sides:

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Frontend available at: **http://localhost:3000** (proxies `/api` and `/ws` to port 8000)

### Building the frontend

```bash
cd frontend
npm run build
```

Output goes to `frontend/dist/`. The backend automatically serves this at `/`.

---

## API Endpoints

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/dashboard` | Aggregated dashboard stats bundle |
| `POST` | `/api/sync` | Manual eBay auction sync |
| `POST` | `/api/cron/sync` | Vercel cron trigger (every 5 min) |
| `GET` | `/ws` | WebSocket — real-time auction stream |

### Cards

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cards` | List all cards (filter by driver, year, set) |
| `GET` | `/api/cards/{id}` | Get card detail |
| `POST` | `/api/cards` | Create card |
| `PUT` | `/api/cards/{id}` | Update card |
| `DELETE` | `/api/cards/{id}` | Delete card |

### Auctions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auctions` | List active auctions (sort, filter) |
| `GET` | `/api/auctions/{id}` | Auction detail |
| `POST` | `/api/auctions/{id}/execute-snipe` | Place bid via eBay Trading API |
| `GET` | `/api/auctions/bin` | Buy It Now listings |

### Portfolio

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/portfolio` | All portfolio entries |
| `POST` | `/api/portfolio` | Add card to portfolio |
| `PUT` | `/api/portfolio/{id}` | Update entry |
| `DELETE` | `/api/portfolio/{id}` | Remove entry |
| `GET` | `/api/portfolio/summary` | P&L, total value, ROI |

### Wishlist

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/wishlist` | All wishlist items |
| `POST` | `/api/wishlist` | Add item (set max price, auto-snipe flag) |
| `DELETE` | `/api/wishlist/{id}` | Remove item |

### Alerts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/alerts` | All alerts |
| `POST` | `/api/alerts` | Create alert |
| `PUT` | `/api/alerts/{id}/dismiss` | Dismiss alert |
| `DELETE` | `/api/alerts/{id}` | Delete alert |

### Analytics & Drivers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/analytics` | Market trends, volume, avg prices |
| `GET` | `/api/drivers` | All drivers with investment scores |
| `GET` | `/api/drivers/photo` | Wikipedia headshot URL for driver |
| `POST` | `/api/drivers/refresh-photos` | Re-fetch all driver photos |
| `GET` | `/api/price-history` | Price history (filter by driver/date) |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/seed-cards` | Seed card data from dataset |
| `POST` | `/api/admin/seed-auctions` | Seed mock auction data |
| `POST` | `/api/admin/rebuild` | Drop + rebuild database |
| `POST` | `/api/admin/scrape-card-images` | Trigger eBay image scrape job |

### Utility

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/proxy/image?url=...` | Proxy eBay CDN images server-side |

---

## Database Schema

SQLite (dev) / PostgreSQL (prod) via SQLAlchemy ORM.

### `cards`
| Column | Type | Description |
|--------|------|-------------|
| `id` | Integer PK | |
| `driver_name` | String | e.g. "Max Verstappen" |
| `year` | Integer | Card year |
| `set_name` | String | e.g. "Chrome Crest" |
| `parallel` | String | e.g. "Gold Refractor", "Base" |
| `grade` | Float | PSA/BGS numeric grade (null = raw) |
| `image_url` | String | Card image URL |
| `investment_score` | Float | 0–100 AI-computed value score |
| `team` | String | F1 constructor |
| `nationality` | String | |
| `career_wins` | Integer | |
| `championships` | Integer | |

### `auctions`
| Column | Type | Description |
|--------|------|-------------|
| `id` | Integer PK | |
| `ebay_item_id` | String | eBay listing ID |
| `card_id` | Integer FK → cards | |
| `title` | String | eBay listing title |
| `current_price` | Float | |
| `bid_count` | Integer | |
| `end_time` | DateTime | Auction end UTC |
| `snipe_score` | Float | 0–100 snipe opportunity score |
| `is_snipe_eligible` | Boolean | |
| `status` | String | active / ended / sniped |
| `buy_it_now_price` | Float | |
| `listing_url` | String | |

### `portfolio`
| Column | Type | Description |
|--------|------|-------------|
| `id` | Integer PK | |
| `card_id` | Integer FK → cards | |
| `purchase_price` | Float | |
| `purchase_date` | DateTime | |
| `current_value` | Float | |
| `quantity` | Integer | |
| `notes` | String | |

### `price_history`
| Column | Type | Description |
|--------|------|-------------|
| `id` | Integer PK | |
| `card_id` | Integer FK → cards | |
| `sale_price` | Float | |
| `sale_date` | DateTime | |
| `source` | String | "ebay_sold", "psa", etc. |
| `condition` | String | Raw, PSA 9, BGS 9.5, etc. |
| `ebay_item_id` | String | |

### `alerts`
| Column | Type | Description |
|--------|------|-------------|
| `id` | Integer PK | |
| `card_id` | Integer FK → cards | |
| `alert_type` | String | "price_drop", "snipe_opportunity" |
| `threshold` | Float | Trigger price |
| `triggered` | Boolean | |
| `urgency` | String | low / medium / high |
| `message` | String | |

### `wishlist`
| Column | Type | Description |
|--------|------|-------------|
| `id` | Integer PK | |
| `card_id` | Integer FK → cards | |
| `max_price` | Float | Maximum bid cap |
| `priority` | Integer | 1 = highest |
| `auto_snipe` | Boolean | Enable autonomous bidding |
| `notes` | String | |

### `price_history_sync_log`
Tracks last sync time and record count per driver for incremental scraping.

---

## Deployment to Vercel

The project deploys as a single Vercel project — Python backend as serverless functions, React frontend as static files.

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Build the frontend

```bash
cd frontend
npm run build
cd ..
```

### 3. Set environment variables in Vercel dashboard

Go to your Vercel project → Settings → Environment Variables and add:

```
EBAY_APP_ID
EBAY_APP_SECRET
EBAY_SANDBOX=false
ANTHROPIC_API_KEY        # optional
DATABASE_URL             # PostgreSQL connection string for prod
```

### 4. Deploy

```bash
vercel --prod --yes
```

Vercel will:
- Deploy `backend/main.py` as a Python serverless function at `/api/*`
- Serve `frontend/dist/` as static files
- Run the cron job at `/api/cron/sync` every 5 minutes (configured in `vercel.json`)

> **Note:** SQLite is ephemeral on Vercel (uses `/tmp`). For persistent data in production, set `DATABASE_URL` to a PostgreSQL instance (e.g., Neon, Supabase, Railway).

---

## Running Tests

### Backend

```bash
cd backend
pytest
```

Tests cover: health check, cards CRUD, auction endpoints, portfolio, wishlist, analytics, scraper logic.

### Frontend

```bash
cd frontend
npm test
```

Tests cover: snipe scoring logic, auction card rendering, stat card rendering, time formatting, API calls.

```bash
npm run test:coverage    # coverage report
```

---

## Troubleshooting

### App loads but shows no auction data

- Check `backend/.env` for valid eBay credentials
- Without credentials, the app seeds mock data — verify with `GET /api/health`
- Trigger a manual sync: `POST /api/sync`

### eBay API errors / 403

- Confirm `EBAY_APP_ID` and `EBAY_APP_SECRET` are production keys (not sandbox)
- Set `EBAY_SANDBOX=false` in `.env`
- eBay OAuth tokens auto-refresh; if issues persist, check token expiry in logs

### Frontend shows blank page after `python start.py`

- The backend serves from `frontend/dist/` — run `cd frontend && npm run build` first
- Then restart `python start.py`

### `ModuleNotFoundError` on startup

```bash
pip install -r requirements.txt
```

Confirm Python 3.11+ is active: `python --version`

### WebSocket not connecting (real-time updates broken)

- In dev mode, confirm both backend (port 8000) and frontend (port 3000) are running
- The Vite proxy in `vite.config.js` forwards `/ws` → `ws://localhost:8000`
- Check browser console for WebSocket connection errors

### Database locked / SQLite errors

- Only one process should write to `f1cards.db` at a time
- Kill any orphaned uvicorn processes: `pkill -f uvicorn`
- For concurrent access, migrate to PostgreSQL via `DATABASE_URL`

### Images not loading (eBay CDN blocked)

- Images are proxied through `/api/proxy/image?url=...` to avoid eBay hotlink blocks
- If images still fail, check the allowed host list in `backend/main.py` (`_ALLOWED_HOSTS`)

---

## Contributing

1. Fork the repo and create a feature branch: `git checkout -b feature/your-feature`
2. Backend changes: add/update tests in `backend/tests/` and run `pytest`
3. Frontend changes: add/update tests in `frontend/src/tests/` and run `npm test`
4. Keep `.env` files out of commits — secrets go in `.env` only (gitignored)
5. PR description should explain what changed and why
6. Target the `main` branch for all PRs

### Code conventions

- Python: follow existing FastAPI router patterns; use `get_db` dependency for all DB access
- React: functional components, hooks only; Tailwind for all styles
- No `console.log` left in production code
- Keep API responses consistent — wrap lists in `{ items: [], total: N }` pattern where applicable

---

## License

Private project. All rights reserved.
