"""
Playwright-based eBay scraper that runs from GitHub Actions and writes
directly to the Neon/Supabase Postgres database.

Bypasses every quota and bot-challenge that blocks our Vercel-side scrapers:
- Real Chromium browser (not httpx) → defeats eBay's "Pardon Our Interruption"
- Runs on GitHub Actions free tier (2000 min/mo) → no Vercel Lambda size limit
- Hits eBay search HTML directly → uses zero Browse/Finding API quota

Usage (locally):
    DATABASE_URL=postgres://... python scripts/scrape_runner.py

In CI: scheduled via .github/workflows/scrape.yml every 3 hours.
"""
import os
import re
import sys
import time
import logging
from datetime import datetime, timedelta
from urllib.parse import urlencode

import psycopg2
from psycopg2.extras import execute_values
from playwright.sync_api import sync_playwright
try:
    from tf_playwright_stealth import stealth_sync
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scraper")

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    log.error("DATABASE_URL not set — exiting")
    sys.exit(1)

# --- Title parsers (mirror backend/sold_ingest.py + ebay_api.py) ---

GRADE_RE = re.compile(r"\b(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7|6)\b", re.I)

# Parser hierarchy — MORE-SPECIFIC parallels MUST win over generic ones.
# Order:
#   1. SuperFractor (1/1) — always highest
#   2. Print-run numbered parallels (Red /5, Black /10, ...) — explicit /N
#   3. Autograph — \bauto(graph)?\b / signed
#   4. Named insert parallels (Neon Nations, Helix, Ultrasonic, ...)
#   5. Named visual parallels (Checker Flag, Ray Wave, Lazer, Diamond)
#   6. Refractor — generic, ONLY if none of the above matched
#   7. Base — last resort (caller default)
#
# NOTE: Refractor used to sit ABOVE Autograph, which silently mis-tagged
# "Refractor Auto" listings as "Refractor" — poisoning the comp median
# for the base Refractor and producing wildly wrong verdicts. (See
# Antonelli Refractor STRONG_BUY incident.)
PARALLEL_PATTERNS = [
    # 1. SuperFractor — highest priority
    ("SuperFractor", re.compile(r"super ?fractor|\b1\s*\/\s*1\b", re.I)),
    # 2. Print-run numbered parallels
    ("Red /5", re.compile(r"\bred\b.*\/\s*5\b|\/\s*5\b.*\bred", re.I)),
    ("Black /10", re.compile(r"\bblack\b.*\/\s*10\b|\/\s*10\b.*\bblack", re.I)),
    ("Orange /25", re.compile(r"\borange\b.*\/\s*25\b|\/\s*25\b.*\borange", re.I)),
    ("Gold /50", re.compile(r"\bgold\b.*\/\s*50\b|\/\s*50\b.*\bgold", re.I)),
    ("F1 75th /75", re.compile(r"75th.*\/\s*75\b|\/\s*75\b.*75th|anniversary.*\/\s*75\b", re.I)),
    ("Green /99", re.compile(r"\bgreen\b.*\/\s*99\b|\/\s*99\b.*\bgreen", re.I)),
    ("Blue /150", re.compile(r"\bblue\b.*\/\s*150\b|\/\s*150\b.*\bblue", re.I)),
    ("Aqua /199", re.compile(r"\baqua\b.*\/\s*199\b|\/\s*199\b.*\baqua", re.I)),
    ("Pink /250", re.compile(r"\bpink\b.*\/\s*250\b|\/\s*250\b.*\bpink", re.I)),
    ("Teal /299", re.compile(r"\bteal\b.*\/\s*299\b|\/\s*299\b.*\bteal", re.I)),
    # 3. Autograph — moved ABOVE Refractor so "Refractor Auto" -> Autograph,
    #    not Refractor. This is the core misclassification fix.
    ("Autograph", re.compile(r"\bauto(graph)?\b|\bsigned\b", re.I)),
    # 4. Named insert parallels
    ("Vegas at Night", re.compile(r"vegas at night|vegas ?night", re.I)),
    ("Neon Nations", re.compile(r"neon nations?", re.I)),
    ("Floor It", re.compile(r"floor ?it", re.I)),
    ("Speed Wheels", re.compile(r"speed wheels?", re.I)),
    ("Top Speed", re.compile(r"top speed", re.I)),
    ("Four & More", re.compile(r"four ?& ?more|four and more|4 ?& ?more", re.I)),
    ("Diamond 75th", re.compile(r"diamond ?75th|75th anniversary diamond", re.I)),
    ("Helix", re.compile(r"\bhelix\b", re.I)),
    ("Ultrasonic", re.compile(r"ultrasonic", re.I)),
    ("The Grail", re.compile(r"\bthe grail\b|\bgrail\b", re.I)),
    ("Futuro", re.compile(r"futuro", re.I)),
    ("The Chain", re.compile(r"\bthe chain\b", re.I)),
    ("The Grid", re.compile(r"\bthe grid\b", re.I)),
    ("Helmet Collection", re.compile(r"helmet collection|helmet collectors", re.I)),
    ("Speed Demons", re.compile(r"speed demons?", re.I)),
    ("Ace of Trades", re.compile(r"ace of trades?", re.I)),
    # 5. Named visual parallels
    ("Checker Flag", re.compile(r"checker ?flag|checkered ?flag", re.I)),
    ("B&W Ray Wave", re.compile(r"ray ?wave|b&w ray|black ?& ?white ray", re.I)),
    ("B&W Lazer", re.compile(r"b&w lazer|black ?& ?white lazer|\blazer\b", re.I)),
    ("Prism Refractor", re.compile(r"prism ?refractor|prizm ?refractor|prizm", re.I)),
    # 6. Refractor — generic, lowest priority before Base
    ("Refractor", re.compile(r"refractor", re.I)),
]

DRIVERS = [
    # F1 2025 grid
    "Max Verstappen", "Lewis Hamilton", "Charles Leclerc", "Lando Norris",
    "Fernando Alonso", "Oscar Piastri", "Carlos Sainz", "George Russell",
    "Sergio Perez", "Lance Stroll", "Valtteri Bottas", "Esteban Ocon",
    "Pierre Gasly", "Yuki Tsunoda", "Daniel Ricciardo",
    "Nico Hulkenberg", "Kevin Magnussen", "Zhou Guanyu", "Alexander Albon",
    "Logan Sargeant", "Oliver Bearman", "Jack Doohan", "Andrea Kimi Antonelli",
    "Isack Hadjar", "Gabriel Bortoleto", "Liam Lawson", "Franco Colapinto",
    # F2 / F3
    "Leonardo Fornaroli", "Arvid Lindblad", "Josep Maria Marti", "Richard Verschoor",
    "Dino Beganovic", "Gabriele Mini", "Jak Crawford", "Victor Martins",
    "Joshua Durksen", "Luke Browning", "Tuukka Taponen", "Ugo Ugochukwu",
    "James Wharton", "Louis Sharp", "Noah Stromsted", "Javier Sagrera",
    "Alexander Dunne", "Cian Shields", "John Bennett", "Kush Maini",
    "Max Esterson", "Ivan Domingues", "Oliver Goethe", "Amaury Cordeel",
    # Legends (in 2025 set inserts)
    "Michael Schumacher", "Ayrton Senna", "Alain Prost", "Nigel Mansell",
    "Mario Andretti", "Mika Hakkinen", "Damon Hill", "Jacques Villeneuve",
    "Emerson Fittipaldi", "Juan Pablo Montoya", "Gerhard Berger", "James Hunt",
    "Sebastian Vettel", "Kimi Raikkonen", "Niki Lauda", "Jackie Stewart",
    "Jim Clark", "Stirling Moss",
]


def parallel_from_title(title: str):
    for label, pat in PARALLEL_PATTERNS:
        if pat.search(title):
            return label
    return "Base"


def grade_from_title(title: str):
    m = GRADE_RE.search(title)
    return f"{m.group(1).upper()} {m.group(2)}" if m else None


TEAMS = [
    ("Red Bull Racing", ["red bull racing", "red bull"]),
    ("Ferrari", ["ferrari", "scuderia"]),
    ("Mercedes", ["mercedes-amg", "mercedes amg", "mercedes"]),
    ("McLaren", ["mclaren"]),
    ("Aston Martin", ["aston martin"]),
    ("Alpine", ["alpine"]),
    ("Williams", ["atlassian williams", "williams racing", "williams"]),
    ("Haas", ["haas"]),
    ("Sauber", ["stake sauber", "kick sauber", "sauber"]),
    ("Racing Bulls", ["racing bulls", "visa cash app rb", "rb f1"]),
]


# Try to import the shared canonical normalizer. The runner is invoked from
# the repo root in CI, so adding `backend` to sys.path keeps this self-
# contained without changing the workflow file.
try:
    _here = os.path.dirname(os.path.abspath(__file__))
    _backend = os.path.join(os.path.dirname(_here), "backend")
    if _backend not in sys.path:
        sys.path.insert(0, _backend)
    from lib.driver_norm import normalize_driver as _normalize_driver
except Exception:
    _normalize_driver = lambda x: x  # noqa: E731 — fail-open if helper missing


def driver_from_title(title: str):
    t = title.lower()
    for d in DRIVERS:
        if d.lower() in t:
            return _normalize_driver(d)
        last = d.split()[-1].lower()
        if len(last) > 4 and re.search(rf"\b{re.escape(last)}\b", t):
            return _normalize_driver(d)
    # No driver found — fall back to team name if title contains a team identifier.
    for canonical, aliases in TEAMS:
        if any(a in t for a in aliases):
            return f"{canonical} (Team)"
    return None


def is_valid_2025_f1(title: str):
    """Strict 2025 Topps Chrome FORMULA 1 only — reject MLB/NFL/NBA Topps Chrome."""
    t = (title or "").lower()
    if "2025" not in t:
        return False
    # Require an explicit F1 marker — "topps chrome" alone matches MLB cards.
    has_f1 = (
        "formula 1" in t or "formula1" in t or "grand prix" in t or
        re.search(r"\bf1\b", t) is not None
    )
    if not has_f1:
        return False
    # Reject other motorsport
    if any(k in t for k in (" f2 ", " f3 ", "formula 2", "formula 3", "indycar", "nascar")):
        return False
    # Reject other sports leaking through
    OTHER_SPORTS = (
        "mlb", "nfl", "nba", "nhl", "wnba", "mls", "ufc", "pga",
        " baseball", " football", " basketball", " hockey", " soccer",
        # MLB team keywords commonly in titles
        "yankees", "red sox", "dodgers", "rockies", "nationals", "mets",
        "cubs", "cardinals", "phillies", "braves", "astros", "rangers",
        "padres", "giants", "twins", "blue jays", "orioles", "guardians",
        "tigers", "white sox", "royals", "marlins", "rays", "mariners",
        "angels", "athletics", "pirates", "reds", "brewers", "diamondbacks",
        # NFL teams (common bleed-throughs)
        "patriots", "cowboys", "eagles", "chiefs", "49ers",
    )
    if any(k in t for k in OTHER_SPORTS):
        return False
    return True


def parse_price(s: str) -> float:
    if not s:
        return 0.0
    m = re.search(r"[\d,]+\.?\d*", s.replace(",", ""))
    return float(m.group()) if m else 0.0


def parse_shipping(s: str) -> float:
    """'+ $4.50 shipping' → 4.50; 'Free shipping' → 0.0; '' → None."""
    if not s:
        return None
    t = s.lower().strip()
    if "free" in t:
        return 0.0
    m = re.search(r"\$\s*([\d,]+\.?\d*)", t)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except Exception:
            return None
    return None


def extract_ebay_item_id(url: str):
    if not url:
        return None
    m = re.search(r"/itm/(?:[^/]+/)?(\d{10,14})", url)
    return m.group(1) if m else None


# --- DB ---

def assert_expected_db():
    """Fail LOUDLY if DATABASE_URL doesn't point at the live app database.

    Why this exists: the app migrated Supabase -> Neon on 2026-06-08, but the
    GitHub Actions DATABASE_URL secret (last set 2026-04-17) was never
    updated. For SEVEN WEEKS every scheduled run connected to the dead
    Supabase DB, reported thousands of successful upserts, and wrote into a
    database the site no longer reads. Nothing errored — the logs looked
    perfect while the Sales page silently froze at 2026-06-08.

    A wrong-DB target must never again look like success. Crash the job
    instead so it shows up as a red run, not a green one with no effect.
    """
    host = ""
    try:
        # Cheap parse — avoids adding a urllib dependency for one field.
        host = DB_URL.split("@", 1)[1].split("/", 1)[0]
    except Exception:
        pass
    if "neon.tech" not in host:
        log.error(
            "DATABASE_URL points at %r, which is not the live Neon database. "
            "Refusing to run — writes here would be silently discarded. "
            "Update the DATABASE_URL secret to match Vercel production.",
            host or "<unparseable>",
        )
        sys.exit(1)
    log.info(f"DB target OK: {host}")


def get_conn():
    """Connect with TCP keepalives so Neon doesn't drop the SSL connection
    while the Playwright scraper sits idle between page loads. Was crashing
    every multi-minute run with 'SSL connection has been closed unexpectedly'."""
    return psycopg2.connect(
        DB_URL,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
        connect_timeout=10,
    )


def _ensure_conn(conn):
    """Re-open the connection if it's been closed by the server. Returns a
    live connection (may be the original)."""
    try:
        if conn.closed:
            return get_conn()
        # Cheap health check
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        return conn
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        return get_conn()


def upsert_sold(conn, rows):
    if not rows:
        return 0, conn
    sql = """
        INSERT INTO sold_cards (
            ebay_item_id, title, driver_name, parallel, grade, condition,
            sale_price, sale_date, image_url, ebay_url, is_auction, series,
            shipping_cost, source, scraped_at
        ) VALUES %s
        ON CONFLICT (ebay_item_id) DO UPDATE SET
            sale_price = EXCLUDED.sale_price,
            sale_date = EXCLUDED.sale_date,
            image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url),
            shipping_cost = COALESCE(EXCLUDED.shipping_cost, sold_cards.shipping_cost),
            scraped_at = EXCLUDED.scraped_at
    """
    now = datetime.utcnow()
    stamped = [r + ("eBay", now) for r in rows]
    # Heal connection if it dropped while we were scraping
    conn = _ensure_conn(conn)
    try:
        with conn.cursor() as cur:
            execute_values(cur, sql, stamped)
        conn.commit()
        return len(rows), conn
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        # SSL drop / connection closed — reconnect and retry once
        log.warning(f"DB connection lost ({str(e)[:80]}); reconnecting + retrying")
        try: conn.close()
        except Exception: pass
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                execute_values(cur, sql, stamped)
            conn.commit()
            return len(rows), conn
        except Exception as e2:
            log.error(f"Retry after reconnect also failed: {str(e2)[:120]}")
            try: conn.rollback()
            except Exception: pass
            return 0, conn
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            conn = get_conn()
        log.warning(f"Full-schema insert failed ({str(e)[:80]}); retrying without shipping_cost")
        legacy_sql = """
            INSERT INTO sold_cards (
                ebay_item_id, title, driver_name, parallel, grade, condition,
                sale_price, sale_date, image_url, ebay_url, is_auction, series,
                source, scraped_at
            ) VALUES %s
            ON CONFLICT (ebay_item_id) DO UPDATE SET
                sale_price = EXCLUDED.sale_price,
                sale_date = EXCLUDED.sale_date,
                image_url = COALESCE(EXCLUDED.image_url, sold_cards.image_url),
                scraped_at = EXCLUDED.scraped_at
        """
        legacy = [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], "eBay", now) for r in rows]
        with conn.cursor() as cur:
            execute_values(cur, legacy_sql, legacy)
        conn.commit()
        return len(rows), conn


# --- Scraper ---

EBAY_BASE = "https://www.ebay.com/sch/i.html"

QUERIES = [
    "2025 Topps Chrome Formula 1",
    "2025 Topps Chrome F1 Refractor",
    "2025 Topps Chrome F1 Auto",
    "2025 Topps Chrome F1 Verstappen",
    "2025 Topps Chrome F1 Hamilton",
    "2025 Topps Chrome F1 Norris",
    "2025 Topps Chrome F1 Leclerc",
    "2025 Topps Chrome F1 Neon Nations",
    "2025 Topps Chrome F1 Helix",
    "2025 Topps Chrome F1 Vegas at Night",
    "2025 Topps Chrome F1 Futuro",
    "2025 Topps Chrome F1 Ultrasonic",
    "2025 Topps Chrome F1 SuperFractor",
    "2025 Topps Chrome F1 Speed Demons",
    "2025 Topps Chrome F1 Grand Prix Winner",
    "2025 Topps Chrome F1 Helmet Collection",
    "2025 Topps Chrome F1 Orange Refractor",
    "2025 Topps Chrome F1 Red Refractor",
    "2025 Topps Chrome F1 Black Refractor",
    "2025 Topps Chrome F1 Autograph",
    "2025 Topps Chrome F1 Franco Colapinto",
    "2025 Topps Chrome F1 /25",
    "2025 Topps Chrome F1 /10",
    "2025 Topps Chrome F1 /5",
    "Topps Chrome Formula 1 SuperFractor",
    "Topps Chrome Formula 1 Autograph",
    # 2025 Topps Dynasty F1 (added 2026-07-28) — sold-data accrual so a
    # Dynasty comp pool builds forward. Kept to 3 queries: Dynasty volume
    # is a fraction of Chrome's.
    "2025 Topps Dynasty Formula 1",
    "2025 Topps Dynasty F1 Auto",
    "2025 Topps Dynasty F1 /10",
]


def build_url(query: str, mode: str = "sold", min_price: int = 0):
    params = {"_nkw": query, "_ipg": "240"}
    if mode == "sold":
        params["LH_Complete"] = "1"
        params["LH_Sold"] = "1"
    elif mode == "auction":
        params["LH_Auction"] = "1"
        params["_sop"] = "1"  # ending soonest
    elif mode == "bin":
        params["LH_BIN"] = "1"
        params["_sop"] = "10"  # newly listed
    if min_price and min_price > 0:
        params["_udlo"] = str(min_price)
    return f"{EBAY_BASE}?{urlencode(params)}"


# Premium sold backfill: one query per driver at min $40 so snipe scoring has deep
# comp history on cards that actually matter. Runs once per scrape cycle.
PREMIUM_QUERIES = [
    f"2025 Topps Chrome F1 {d.split()[-1]}" for d in DRIVERS
]

# Market maker scrape: ≥$200 sales per driver. These shape the high-end
# of every parallel and define what 'sold for' really means for that
# driver. Caps at the eBay price floor of $200 to keep the result set
# focused on real comps, not blaster prices.
MARKET_MAKER_QUERIES = [
    f"2025 Topps Chrome F1 {d.split()[-1]}" for d in DRIVERS
]


def upsert_auction(conn, rows):
    """Upsert active auction/BIN rows into the `auctions` table.
    rows: list of tuples matching the column order below.

    Returns (added, conn) — the connection is part of the contract because
    a deadlock/SSL-drop forces a reconnect here, and the CALLER must adopt
    the new handle. It previously returned only the count, so after a heal
    the caller kept its stale `conn` and the next find_card_id_for() died
    with "connection already closed", crashing the whole run mid-BIN-pass.
    Matches upsert_sold's (count, conn) contract."""
    if not rows:
        return 0, conn
    sql = """
        INSERT INTO auctions (
            card_id, ebay_listing_id, title, current_price, buy_now_price,
            bid_count, end_time, seller, seller_feedback, condition,
            snipe_eligible, snipe_score, status, ebay_url, image_url,
            shipping_cost, is_real_ebay, buying_options, last_updated
        ) VALUES %s
        ON CONFLICT (ebay_listing_id) DO UPDATE SET
            current_price = EXCLUDED.current_price,
            buy_now_price = EXCLUDED.buy_now_price,
            bid_count = EXCLUDED.bid_count,
            end_time = EXCLUDED.end_time,
            seller = EXCLUDED.seller,
            seller_feedback = EXCLUDED.seller_feedback,
            buying_options = EXCLUDED.buying_options,
            image_url = COALESCE(EXCLUDED.image_url, auctions.image_url),
            last_updated = NOW(),
            status = 'active'
    """
    conn = _ensure_conn(conn)
    try:
        with conn.cursor() as cur:
            execute_values(cur, sql, rows)
        conn.commit()
        return len(rows), conn
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        # Covers SSL drops AND deadlocks (psycopg2 raises those as
        # OperationalError). Either way the transaction is dead, so the only
        # safe move is a fresh connection + one retry.
        log.warning(f"DB connection lost on auctions upsert ({str(e)[:80]}); reconnecting + retrying")
        try: conn.close()
        except Exception: pass
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                execute_values(cur, sql, rows)
            conn.commit()
            return len(rows), conn
        except Exception as e2:
            log.error(f"Auctions retry after reconnect also failed: {str(e2)[:120]}")
            return 0, conn


def get_default_card_id(conn) -> int:
    """Return any card_id to satisfy the FK. We mostly want the listing data;
    card linkage is best-effort matching on driver_name."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM cards ORDER BY id LIMIT 1")
        row = cur.fetchone()
        return row[0] if row else 1


def _safe_card_lookup(conn, driver: str, parallel: str, default: int) -> int:
    """find_card_id_for, but never fatal. A dead/deadlocked connection here
    used to crash the entire run mid-pass ("connection already closed").
    A card-id lookup is not worth losing a 20-minute scrape over — heal the
    connection, retry once, and fall back to the default card id."""
    try:
        return find_card_id_for(conn, driver, parallel, default)
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        log.warning(f"card lookup lost connection ({str(e)[:60]}); retrying once")
        try:
            return find_card_id_for(_ensure_conn(conn), driver, parallel, default)
        except Exception as e2:
            log.warning(f"card lookup retry failed ({str(e2)[:60]}); using default")
            return default
    except Exception as e:
        log.warning(f"card lookup failed ({str(e)[:60]}); using default")
        return default


def find_card_id_for(conn, driver: str, parallel: str, default: int) -> int:
    """Best-effort match: driver+parallel exact → driver only → default."""
    if not driver:
        return default
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM cards WHERE driver_name = %s AND parallel = %s LIMIT 1",
            (driver, parallel),
        )
        row = cur.fetchone()
        if row:
            return row[0]
        cur.execute("SELECT id FROM cards WHERE driver_name = %s LIMIT 1", (driver,))
        row = cur.fetchone()
        return row[0] if row else default


def parse_end_time(time_text: str, mode: str):
    """For auctions, parse '2d 4h' / '5h 12m' / '23m 7s' to absolute UTC datetime.
    Returns None if unparseable (don't fake a countdown).
    For BIN, return now+30 days (no real countdown)."""
    if mode == "bin":
        return datetime.utcnow() + timedelta(days=30)
    if not time_text:
        return None
    t = time_text.lower()
    days = re.search(r"(\d+)\s*d\b", t)
    hours = re.search(r"(\d+)\s*h\b", t)
    mins = re.search(r"(\d+)\s*m\b", t)
    secs = re.search(r"(\d+)\s*s\b", t)
    if days or hours or mins or secs:
        return datetime.utcnow() + timedelta(
            days=int(days.group(1)) if days else 0,
            hours=int(hours.group(1)) if hours else 0,
            minutes=int(mins.group(1)) if mins else 0,
            seconds=int(secs.group(1)) if secs else 0,
        )
    return None


def scrape_active_listings(page, conn, queries, mode: str, default_card_id: int):
    """Scrape active auctions or BINs and upsert into the auctions table.
    mode: 'auction' or 'bin'.

    Returns (total_seen, total_added, conn) — conn is returned because an
    upsert in here may reconnect after a deadlock/SSL drop, and main() must
    adopt the live handle for the passes that follow."""
    total_added = 0
    total_seen = 0
    for query in queries:
        url = build_url(query, mode)
        log.info(f"Scraping [{mode}] {query!r}")
        # Pull live page from state — earlier passes may have crashed and
        # been recreated. Without this, a dead page from the sold loop
        # silently kills every auction/BIN navigation.
        page = _PAGE_STATE["page"]
        try:
            items = scrape_search_page(page, url)
        except Exception as e:
            log.warning(f"Page failed: {e}")
            if _is_dead_page_error(e):
                _recreate_page(f"{mode} loop: {e}")
            items = []
        total_seen += len(items)
        rows = []
        for it in items:
            raw_title = it["title"] or ""
            title = re.sub(r"\s*Opens in a new window or tab\s*$", "", raw_title, flags=re.I).strip()
            title = re.sub(r"\s+", " ", title).strip()
            if not is_valid_2025_f1(title):
                continue
            price = parse_price(it["price"])
            if price <= 0:
                continue
            item_id = extract_ebay_item_id(it["url"])
            if not item_id:
                continue
            ebay_listing_id = f"v1|{item_id}|0"
            driver = driver_from_title(title)
            parallel = parallel_from_title(title)
            card_id = _safe_card_lookup(conn, driver, parallel, default_card_id)
            end_time = parse_end_time(it.get("date_text", ""), mode)
            if mode == "auction" and end_time is None:
                continue  # Skip rows we can't determine end time for — better than fake countdown
            buying_opts = '["AUCTION"]' if mode == "auction" else '["FIXED_PRICE"]'
            buy_now = price if mode == "bin" else None
            ship = parse_shipping(it.get("shipping_text", ""))
            rows.append((
                card_id,
                ebay_listing_id,
                title[:255],
                price,
                buy_now,
                0,                  # bid_count (unknown from search page)
                end_time,
                None,               # seller (unknown from search page — leave null rather than fake placeholder)
                0,                  # seller_feedback
                "Used",
                False,              # snipe_eligible
                0.0,                # snipe_score
                "active",
                it["url"],
                it["image"] or None,
                float(ship) if ship is not None else 0.0,  # shipping_cost
                True,               # is_real_ebay
                buying_opts,
                datetime.utcnow(),
            ))
        if rows:
            # Must rebind conn — upsert_auction may have reconnected after a
            # deadlock/SSL drop, and the old handle is dead at that point.
            added, conn = upsert_auction(conn, rows)
            total_added += added
            log.info(f"  → {added} {mode} rows upserted")
        # 12s between queries — fires eBay's per-IP rate detector at the old
        # 2s pace which triggered "Pardon Our Interruption" bot-challenge
        # pages on every active-listing query.
        time.sleep(12)
    return total_seen, total_added, conn


# Holds the live (page, ctx, browser) triple. We mutate this when the page
# crashes mid-run so callers always get a fresh page without threading new
# objects through every helper. Set in main() right after browser launch.
_PAGE_STATE = {"page": None, "ctx": None, "browser": None, "playwright": None}


def _recreate_page(reason: str = ""):
    """Tear down the current context+page and build a fresh one on the same
    browser. Called when Playwright reports the page has crashed — without
    this, every subsequent goto fails for the rest of the run."""
    state = _PAGE_STATE
    log.warning(f"Recreating page (reason: {reason or 'unknown'})")
    try:
        if state.get("ctx"):
            state["ctx"].close()
    except Exception as e:
        log.warning(f"  old ctx close failed: {e}")
    try:
        ctx = state["browser"].new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
            },
        )
        page = ctx.new_page()
        if HAS_STEALTH:
            try:
                stealth_sync(page)
            except Exception:
                pass
        try:
            page.goto("https://www.ebay.com/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
        except Exception:
            pass
        state["ctx"] = ctx
        state["page"] = page
        return page
    except Exception as e:
        log.error(f"  page recreate failed: {e}")
        return state.get("page")


def _is_dead_page_error(err: Exception) -> bool:
    msg = str(err).lower()
    return "page crashed" in msg or "target closed" in msg or "page closed" in msg or "browser has been closed" in msg


def scrape_search_page(page, url: str):
    """Return list of dicts: title, price, url, image, sale_date_text.

    Bot-challenge handling: when eBay serves "Pardon Our Interruption", we
    were waiting 8s and then re-checking the selector. That doesn't work —
    the challenge is a separate page, not a delay. Now: detect challenge,
    sleep 30s (cools eBay's per-IP rate counter), navigate to eBay home to
    establish a 'normal' session, then retry the original URL once.

    Crash recovery: if Playwright reports the page is dead (Page crashed /
    Target closed), we tear down the context, build a new one on the same
    browser, and retry the URL once. Without this, a single crash during
    the sold pass kills every subsequent auction/BIN navigation.
    """
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as nav_err:
        if _is_dead_page_error(nav_err):
            page = _recreate_page(f"goto: {nav_err}")
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as e2:
                log.warning(f"Post-recreate goto failed: {e2}")
                return []
        else:
            raise
    title = page.title() or ""
    # Bot-challenge detection: eBay serves several different interstitials
    # depending on IP reputation — "Pardon Our Interruption" (captcha),
    # "Security Measure" (soft block), and "Sign in or Register" (a login
    # wall that appears in place of search results under heavy load). Only
    # "Pardon" was recognized before, so every run since ~2026-06 hit the
    # other two titles, fell through to the 20s wait_for_selector timeout
    # per query with no cooldown, and the whole job blew its 25min budget
    # without a single successful query — this is why sold_cards / the
    # GH-Actions-fed comp pool went stale.
    _CHALLENGE_TITLES = ("pardon", "interruption", "security measure", "sign in or register")
    if any(t in title.lower() for t in _CHALLENGE_TITLES):
        log.warning(f"Bot challenge: {title} — cooling 30s then retrying")
        page.wait_for_timeout(30000)
        try:
            page.goto("https://www.ebay.com/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(3000)
        except Exception:
            pass
        # Retry the original URL
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            title = page.title() or ""
            if any(t in title.lower() for t in _CHALLENGE_TITLES):
                log.warning(f"Bot challenge persisted after retry — skipping {url[:80]}")
                return []
        except Exception as e:
            log.warning(f"Retry navigation failed: {e}")
            return []
    try:
        page.wait_for_selector(
            "li.s-item, .s-item__wrapper, .srp-results, .su-card-container, .s-card",
            timeout=20000,
        )
    except Exception:
        log.warning(f"No selector match at {url[:80]} (title={title})")
        return []

    # Try old + new eBay layouts. Modern eBay uses .s-card / .su-card-container.
    # Price extraction is strict: only accept text that contains "$" so we don't
    # catch "16 watchers" or "FREE shipping" badges.
    items = page.evaluate("""
        () => {
            const out = [];
            const seen = new Set();
            const cards = document.querySelectorAll(
                'li.s-item, .s-item__wrapper, .s-card, .su-card-container'
            );
            cards.forEach(el => {
                const titleEl = el.querySelector(
                    '.s-item__title, .s-item__title span, .s-card__title, [data-testid="item-title"], h3'
                );
                const linkEl = el.querySelector(
                    'a.s-item__link, a.s-card__link, a[href*="/itm/"]'
                );
                const imgEl = el.querySelector('img');
                const dateEl = el.querySelector(
                    '.s-item__caption--signal, .s-item__title--tagblock, .s-item__listingDate, .s-card__caption'
                );
                if (!titleEl || !linkEl) return;
                // Use textContent (NOT innerText) — innerText respects CSS visibility
                // and eBay sometimes hides characters via .clipped / aria-hidden, which
                // strips letters like "Topps" → "Topp" or "Mansell" → "Man ell".
                const title = (titleEl.textContent || titleEl.innerText || '').trim();
                if (!title || title === 'Shop on eBay' || title.length < 5) return;
                const url = linkEl.href || '';
                if (!url.includes('/itm/')) return;
                if (seen.has(url)) return;

                // Price: try known selectors first, but VALIDATE each candidate
                // contains a "$". Fall back to scanning all text inside the card
                // for the first dollar amount.
                let priceText = '';
                const priceCandidates = el.querySelectorAll(
                    '.s-item__price, .s-card__price, [data-testid="item-price"], .su-styled-text.positive'
                );
                for (const p of priceCandidates) {
                    const t = (p.textContent || p.innerText || '').trim();
                    if (t.includes('$')) { priceText = t; break; }
                }
                if (!priceText) {
                    // Fallback: scan all text nodes for first $ amount.
                    const all = (el.innerText || el.textContent || '');
                    const m = all.match(/\\$\\s*[\\d,]+\\.?\\d{0,2}/);
                    if (m) priceText = m[0];
                }
                if (!priceText) return;  // No real price → skip

                // Shipping extraction — look for "+ $X shipping" or "Free shipping" near
                // the price element. Fall back to scanning the whole card text.
                let shippingText = '';
                const shipSelectors = el.querySelectorAll(
                    '.s-item__shipping, .s-card__shipping, [data-testid="shipping"], .s-item__logisticsCost'
                );
                for (const sp of shipSelectors) {
                    const t = (sp.textContent || sp.innerText || '').trim();
                    if (t) { shippingText = t; break; }
                }
                if (!shippingText) {
                    const all = (el.innerText || el.textContent || '');
                    const m = all.match(/(\\+\\s*\\$\\s*[\\d,]+\\.?\\d{0,2}\\s*shipping)|(free\\s+shipping)/i);
                    if (m) shippingText = m[0];
                }

                // Time-left extraction: try dedicated selectors first, then
                // fall back to scanning the whole card for "Xd Yh" / "Xh Ym" / "Xm Ys".
                let dateText = dateEl ? (dateEl.innerText || dateEl.textContent || '').trim() : '';
                if (!dateText || !/\\d+\\s*[dhms]\\b/i.test(dateText)) {
                    const allText = el.innerText || el.textContent || '';
                    const m = allText.match(/\\b\\d+d\\s+\\d+h\\b|\\b\\d+h\\s+\\d+m\\b|\\b\\d+m\\s+\\d+s\\b/i);
                    if (m) dateText = m[0];
                }

                seen.add(url);
                out.push({
                    title,
                    price: priceText,
                    url,
                    image: imgEl ? (imgEl.src || imgEl.dataset.src || '') : '',
                    date_text: dateText,
                    shipping_text: shippingText
                });
            });
            return out;
        }
    """)
    if not items:
        # Dump first 2KB of body for debugging
        body_snippet = page.evaluate("() => document.body.innerText.slice(0, 800)")
        log.warning(f"Zero items extracted. Body preview: {body_snippet[:400]}")
    return items


def parse_sale_date(date_text: str) -> datetime:
    """eBay sold listings format: 'Sold  Apr 15, 2026' or similar."""
    if not date_text:
        return datetime.utcnow()
    m = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})", date_text)
    if m:
        try:
            return datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y")
        except ValueError:
            pass
    return datetime.utcnow()


def write_telemetry(conn, source, started_at, queries_attempted, queries_succeeded,
                    rows_seen, rows_inserted, blocked, error_message=None):
    """Write a row to scraper_runs so /api/admin/scraper-health reflects reality."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO scraper_runs (
                    source, started_at, ended_at, queries_attempted, queries_succeeded,
                    rows_seen, rows_inserted, rows_updated, rows_skipped_dup,
                    blocked, error_message, run_id
                ) VALUES (%s, %s, NOW(), %s, %s, %s, %s, 0, 0, %s, %s, %s)
            """, (source, started_at, queries_attempted, queries_succeeded,
                  rows_seen, rows_inserted, blocked, error_message,
                  os.environ.get("GITHUB_RUN_ID")))
        conn.commit()
    except Exception as e:
        log.warning(f"Telemetry write failed: {e}")


def main():
    log.info("Starting scrape run")
    assert_expected_db()
    conn = get_conn()
    started_at = datetime.utcnow()
    total_added = 0
    total_seen = 0
    auc_seen = auc_added = bin_seen = bin_added = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-web-security",
            ],
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
            },
        )
        page = ctx.new_page()
        # Register live objects so _recreate_page can rebuild the context if
        # the page crashes mid-run.
        _PAGE_STATE["browser"] = browser
        _PAGE_STATE["ctx"] = ctx
        _PAGE_STATE["page"] = page
        _PAGE_STATE["playwright"] = p
        if HAS_STEALTH:
            try:
                stealth_sync(page)
                log.info("Stealth mode active")
            except Exception as e:
                log.warning(f"Stealth init failed: {e}")
        # Visit eBay homepage first to get cookies
        try:
            page.goto("https://www.ebay.com/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2500)
            log.info(f"Homepage warm-up: {page.title()[:60]}")
        except Exception as e:
            log.warning(f"Homepage warm-up failed: {e}")

        # SOLD ONLY — active auctions belong in /auctions table (handled by Vercel Browse sync).
        # The Sales Database must only contain actual completed sales.
        # Broad queries + premium per-driver queries ($40+) so snipe scoring has
        # deep comp history on valuable cards.
        sold_queries = (
            [(q, 0) for q in QUERIES]
            + [(q, 40) for q in PREMIUM_QUERIES]
            + [(q, 200) for q in MARKET_MAKER_QUERIES]
        )
        # Circuit breaker: each bot-challenge costs ~35s (30s cooldown + 2
        # navigations) before yielding zero items. If eBay is hard-blocking
        # this runner's IP for the whole run, ~80 queries × 35s blows well
        # past the 25min job timeout with zero rows written and the run
        # shows as "cancelled" instead of "completed" — which is exactly
        # what happened for weeks. After 6 CONSECUTIVE empty queries, stop
        # early and let whatever was already committed stand, rather than
        # burn the rest of the budget on a run that isn't going to recover.
        consecutive_empty = 0
        EMPTY_STREAK_BREAKER = 6
        for query, min_price in sold_queries:
            url = build_url(query, "sold", min_price=min_price)
            log.info(f"Scraping [sold] {query!r} (min=${min_price})")
            # Always pull from state — _recreate_page may have replaced the page
            # since the previous iteration.
            page = _PAGE_STATE["page"]
            try:
                items = scrape_search_page(page, url)
            except Exception as e:
                log.warning(f"Page failed: {e}")
                if _is_dead_page_error(e):
                    _recreate_page(f"sold loop: {e}")
                items = []
            total_seen += len(items)
            if items:
                consecutive_empty = 0
            else:
                consecutive_empty += 1
                if consecutive_empty >= EMPTY_STREAK_BREAKER:
                    log.error(
                        f"{EMPTY_STREAK_BREAKER} consecutive empty/blocked queries — "
                        f"eBay is likely hard-blocking this IP. Stopping sold-query loop early "
                        f"to preserve budget for the auction pass below."
                    )
                    break

            rows = []
            skipped_not_sold = 0
            for it in items:
                # Clean eBay's "Opens in a new window or tab" appendage and any newlines.
                raw_title = it["title"] or ""
                title = re.sub(r"\s*Opens in a new window or tab\s*$", "", raw_title, flags=re.I).strip()
                title = re.sub(r"\s+", " ", title).strip()
                if not is_valid_2025_f1(title):
                    continue
                # Require "Sold" marker in eBay's date text — protects against
                # active auctions sneaking in if eBay's Sold filter ever leaks.
                date_txt = (it.get("date_text") or "").lower()
                if "sold" not in date_txt:
                    skipped_not_sold += 1
                    continue
                price = parse_price(it["price"])
                if price <= 0:
                    continue
                parallel = parallel_from_title(title)
                if parallel == "Base":
                    continue  # non-base only
                item_id = extract_ebay_item_id(it["url"])
                if not item_id:
                    continue
                rows.append((
                    item_id,
                    title[:500],
                    driver_from_title(title),
                    parallel,
                    grade_from_title(title),
                    "Used",
                    price,
                    parse_sale_date(it["date_text"]),
                    it["image"] or None,
                    it["url"],
                    False,  # is_auction — always False; this table is sold only
                    "F1",
                    parse_shipping(it.get("shipping_text", "")),  # shipping_cost
                ))

            if rows:
                added, conn = upsert_sold(conn, rows)
                total_added += added
                log.info(f"  → {added} sold rows upserted (skipped {skipped_not_sold} non-sold)")
            elif skipped_not_sold:
                log.info(f"  → 0 rows (skipped {skipped_not_sold} non-sold)")
            time.sleep(2)  # polite gap between queries

        # ---- Active auctions (write to auctions table, not sold_cards) ----
        default_card_id = get_default_card_id(conn)
        log.info(f"=== Active auction scan (default card_id={default_card_id}) ===")
        # Force a clean page before the auction pass — sold pass may have
        # crashed and been recreated, but even if not we don't want any
        # cookie/state buildup contaminating the next phase.
        _recreate_page("pre-auction reset")
        auc_seen, auc_added, conn = scrape_active_listings(
            _PAGE_STATE["page"], conn, QUERIES, "auction", default_card_id
        )
        log.info(f"Auction pass: {auc_seen} seen, {auc_added} upserted")

        # ---- Buy-It-Now (write to auctions table with FIXED_PRICE buying_options) ----
        log.info("=== BIN scan ===")
        _recreate_page("pre-BIN reset")
        bin_seen, bin_added, conn = scrape_active_listings(
            _PAGE_STATE["page"], conn, QUERIES[:5], "bin", default_card_id
        )
        log.info(f"BIN pass: {bin_seen} seen, {bin_added} upserted")

        # Mark stale auctions as ended (anything not seen in this run + past end_time)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE auctions SET status = 'ended' "
                "WHERE status = 'active' AND end_time < NOW() AND is_real_ebay = true"
            )
            ended = cur.rowcount
        conn.commit()
        log.info(f"Marked {ended} stale auctions as ended")

        browser.close()

    # Telemetry: one row per scraper "source" so /api/admin/scraper-health
    # reflects the GH Actions runs (not just the always-blocked Vercel ones).
    write_telemetry(conn, "eBay-sold", started_at, len(QUERIES),
                    len(QUERIES) if total_added > 0 else 0,
                    total_seen, total_added,
                    blocked=(total_added == 0 and total_seen == 0))
    write_telemetry(conn, "eBay-auction", started_at, len(QUERIES),
                    len(QUERIES) if auc_added > 0 else 0,
                    auc_seen, auc_added,
                    blocked=(auc_added == 0 and auc_seen == 0))
    write_telemetry(conn, "eBay-BIN", started_at, 5,
                    5 if bin_added > 0 else 0,
                    bin_seen, bin_added,
                    blocked=(bin_added == 0 and bin_seen == 0))

    conn.close()
    log.info(f"DONE: sold {total_seen}/{total_added}, auction {auc_seen}/{auc_added}, bin {bin_seen}/{bin_added}")


if __name__ == "__main__":
    main()
