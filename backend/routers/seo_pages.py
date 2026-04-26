"""
Programmatic SEO content router.

Provides JSON data for long-tail driver investment guides and other
programmatically generated landing pages. Each endpoint aggregates existing
sales data into an SEO-rich payload that the frontend renders as a unique page.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session, joinedload

from database import get_db

router = APIRouter(prefix="/api/seo", tags=["seo-pages"])


@router.get("/driver-guide/{driver_slug}")
def driver_guide(driver_slug: str, db: Session = Depends(get_db), response: Response = None):
    """SEO-optimized data dump for /drivers/{slug}/guide pages."""
    from database import Card, SoldCard

    # Resolve slug -> driver name
    driver_name = driver_slug.replace('-', ' ').title()
    # Find canonical name from Card table
    card = db.query(Card).filter(Card.driver_name.ilike(f"%{driver_name}%")).first()
    if not card:
        return {"error": "driver not found"}
    canonical = card.driver_name

    # Aggregate stats
    sales_30d = db.query(SoldCard).filter(
        SoldCard.driver_name == canonical,
        SoldCard.sale_date >= datetime.utcnow() - timedelta(days=30),
        SoldCard.sale_price > 0,
    ).all()

    sales_90d = db.query(SoldCard).filter(
        SoldCard.driver_name == canonical,
        SoldCard.sale_date >= datetime.utcnow() - timedelta(days=90),
        SoldCard.sale_price > 0,
    ).all()

    n30 = len(sales_30d)
    n90 = len(sales_90d)
    median_30d = sorted([s.sale_price for s in sales_30d])[n30 // 2] if n30 else None
    median_90d = sorted([s.sale_price for s in sales_90d])[n90 // 2] if n90 else None
    top_sale = max(sales_90d, key=lambda s: s.sale_price or 0, default=None)

    # Parallels seen
    parallels = list({s.parallel for s in sales_90d if s.parallel})[:10]

    # Trend
    trend = None
    if median_30d and median_90d:
        pct = ((median_30d - median_90d) / median_90d * 100)
        trend = {"direction": "up" if pct > 0 else "down", "pct": round(abs(pct), 1)}

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=3600"

    return {
        "driver": canonical,
        "team": card.team,
        "is_rookie": getattr(card, 'is_rookie', False),
        "stats": {
            "sales_30d": n30,
            "sales_90d": n90,
            "median_30d": median_30d,
            "median_90d": median_90d,
            "trend": trend,
        },
        "top_sale": {
            "title": top_sale.title if top_sale else None,
            "price": top_sale.sale_price if top_sale else None,
            "date": top_sale.sale_date.isoformat() + "Z" if top_sale and top_sale.sale_date else None,
        } if top_sale else None,
        "parallels": parallels,
    }


@router.get("/parallel/{parallel_slug}")
def parallel_landing_page(parallel_slug: str, db: Session = Depends(get_db), response: Response = None):
    """
    SEO-optimized landing page for each parallel type.
    Lists all active auctions of that parallel, grouped by driver,
    with price stats (lowest, avg, highest) and filters.
    """
    from database import Auction, Card
    from lib.parallels import SCARCITY

    # Convert slug back to canonical parallel name by matching SCARCITY keys
    parallel_slug_lower = parallel_slug.lower()
    parallel = None
    for p in SCARCITY.keys():
        if p.lower().replace(' ', '-').replace('/', '-') == parallel_slug_lower:
            parallel = p
            break

    if not parallel:
        # Fallback: try exact slug match or close match
        return {"error": f"parallel '{parallel_slug}' not found", "status": 404}

    # Fetch all active auctions for this parallel
    auctions = db.query(Auction).options(
        joinedload(Auction.card)
    ).filter(
        Auction.status == "active",
    ).join(Card).filter(
        Card.parallel == parallel,
    ).all()

    if not auctions:
        return {
            "parallel": parallel,
            "slug": parallel_slug,
            "cards": [],
            "total": 0,
            "price_stats": {
                "lowest": None,
                "average": None,
                "highest": None,
            },
            "unique_drivers": [],
            "unique_grades": [],
        }

    # Extract unique drivers and grades
    drivers = set()
    grades = set()
    prices = []

    card_list = []
    for a in auctions:
        if not a.card or not a.card.driver_name:
            continue

        drivers.add(a.card.driver_name)
        if a.card.grade:
            grades.add(a.card.grade)
        if a.current_price and a.current_price > 0:
            prices.append(a.current_price)

        # Safe grade extraction from title
        try:
            from scraper import _extract_grade_from_title
            safe_grade = _extract_grade_from_title(a.title or "")
        except Exception:
            safe_grade = a.card.grade

        card_list.append({
            "id": a.id,
            "ebay_listing_id": a.ebay_listing_id,
            "title": a.title,
            "driver": a.card.driver_name,
            "driver_slug": a.card.driver_name.lower().replace(' ', '-'),
            "parallel": a.card.parallel,
            "grade": safe_grade or a.card.grade,
            "current_price": a.current_price,
            "buy_now_price": a.buy_now_price,
            "image_url": a.image_url or a.card.image_url,
            "ebay_url": a.ebay_url,
            "condition": a.condition,
            "is_graded": a.is_graded,
            "team": a.card.team,
            "team_color": a.card.team_color,
            "investment_score": a.card.investment_score,
        })

    # Sort by price
    card_list.sort(key=lambda c: c["current_price"] or 0)

    # Calculate price stats
    price_stats = {
        "lowest": min(prices) if prices else None,
        "average": round(sum(prices) / len(prices), 2) if prices else None,
        "highest": max(prices) if prices else None,
    }

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=3600"

    return {
        "parallel": parallel,
        "slug": parallel_slug,
        "cards": card_list,
        "total": len(card_list),
        "price_stats": price_stats,
        "unique_drivers": sorted(list(drivers)),
        "unique_grades": sorted(list(grades)),
    }


@router.get("/parallels-list")
def parallels_list(db: Session = Depends(get_db), response: Response = None):
    """
    Returns all available parallels from SCARCITY map + any in auctions table.
    Used by sitemap generator and frontend discovery.
    """
    from lib.parallels import SCARCITY

    result = []
    for parallel_name in sorted(SCARCITY.keys()):
        slug = parallel_name.lower().replace(' ', '-').replace('/', '-')
        result.append({
            "name": parallel_name,
            "slug": slug,
            "tier": SCARCITY[parallel_name].get('tier'),
            "count": SCARCITY[parallel_name].get('count'),
        })

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=3600"

    return {"parallels": result}


@router.get("/race-weekend-movers")
def race_weekend_movers(db: Session = Depends(get_db), response: Response = None):
    """Top driver card movers over the trailing 7 days vs the prior 30-day baseline.

    Used by the /race-weekend page to show which drivers' cards are heating up
    going into the next race. Pure SQL aggregation over SoldCard — no external
    dependencies, so it stays fast and cacheable.
    """
    from database import Card, SoldCard

    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    recent = db.query(SoldCard).filter(
        SoldCard.sale_date >= week_ago,
        SoldCard.sale_price > 0,
        SoldCard.driver_name.isnot(None),
    ).all()

    baseline = db.query(SoldCard).filter(
        SoldCard.sale_date >= month_ago,
        SoldCard.sale_date < week_ago,
        SoldCard.sale_price > 0,
        SoldCard.driver_name.isnot(None),
    ).all()

    def _group(rows):
        out: dict = {}
        for r in rows:
            out.setdefault(r.driver_name, []).append(r.sale_price)
        return out

    recent_g = _group(recent)
    baseline_g = _group(baseline)

    # Build team lookup so frontend can show team alongside driver name.
    team_lookup: dict = {}
    try:
        for c in db.query(Card.driver_name, Card.team).distinct().all():
            if c.driver_name and c.driver_name not in team_lookup:
                team_lookup[c.driver_name] = c.team
    except Exception:
        team_lookup = {}

    movers = []
    for driver, prices in recent_g.items():
        if len(prices) < 2:
            continue
        recent_med = sorted(prices)[len(prices) // 2]
        base_prices = baseline_g.get(driver, [])
        if len(base_prices) < 2 or recent_med is None:
            continue
        base_med = sorted(base_prices)[len(base_prices) // 2]
        if not base_med:
            continue
        pct = (recent_med - base_med) / base_med * 100
        movers.append({
            "driver": driver,
            "team": team_lookup.get(driver),
            "slug": driver.lower().replace(' ', '-'),
            "median_7d": round(recent_med, 2),
            "median_30d_baseline": round(base_med, 2),
            "pct_change": round(pct, 1),
            "direction": "up" if pct > 0 else "down",
            "sales_7d": len(prices),
        })

    movers.sort(key=lambda m: abs(m["pct_change"]), reverse=True)
    top = movers[:10]

    if response is not None:
        response.headers["Cache-Control"] = "public, s-maxage=1800"

    return {
        "generated_at": now.isoformat() + "Z",
        "movers": top,
        "total_drivers_tracked": len(movers),
    }
