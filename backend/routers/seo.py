"""
SEO router — dynamic sitemap.xml generation.

Serves an XML sitemap listing static site routes, per-driver drill-downs, and
per-card detail pages for indexing by search engines.
"""
import re
import logging
from datetime import datetime
from typing import Iterable
from xml.sax.saxutils import escape as _xe

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db, Card

router = APIRouter(tags=["seo"])
logger = logging.getLogger(__name__)

SITE = "https://www.f1cardvault.com"
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    if not s:
        return ""
    return _NON_ALNUM.sub("-", s.lower()).strip("-")


def _url_tag(loc: str, lastmod: str, changefreq: str, priority: str) -> str:
    return (
        "<url>"
        f"<loc>{_xe(loc)}</loc>"
        f"<lastmod>{lastmod}</lastmod>"
        f"<changefreq>{changefreq}</changefreq>"
        f"<priority>{priority}</priority>"
        "</url>"
    )


def _iter_driver_urls(db: Session, lastmod: str) -> Iterable[str]:
    try:
        rows = db.query(Card.driver_name).distinct().all()
    except Exception as e:
        logger.warning(f"sitemap: driver query failed: {e}")
        return
    seen: set = set()
    for (driver,) in rows:
        if not driver:
            continue
        key = driver.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        from urllib.parse import quote
        yield _url_tag(
            f"{SITE}/drivers?name={quote(key)}",
            lastmod,
            "weekly",
            "0.7",
        )
        # Programmatic SEO: per-driver investment guide page
        yield _url_tag(
            f"{SITE}/drivers/{_slugify(key)}/guide",
            lastmod,
            "daily",
            "0.8",
        )


def _iter_card_urls(db: Session, lastmod: str, limit: int = 1000) -> Iterable[str]:
    try:
        rows = (
            db.query(Card.driver_name, Card.parallel)
            .order_by(Card.id.desc())
            .limit(limit)
            .all()
        )
    except Exception as e:
        logger.warning(f"sitemap: card query failed: {e}")
        return
    seen: set = set()
    for driver, parallel in rows:
        if not driver or not parallel:
            continue
        slug = f"{_slugify(driver)}-{_slugify(parallel)}".strip("-")
        if not slug or slug in seen:
            continue
        seen.add(slug)
        yield _url_tag(
            f"{SITE}/card/{slug}",
            lastmod,
            "weekly",
            "0.6",
        )


@router.get("/sitemap.xml")
def sitemap_xml(db: Session = Depends(get_db)):
    """Dynamic XML sitemap — static routes, per-driver, and per-card pages."""
    now = datetime.utcnow()
    lastmod = now.strftime("%Y-%m-%d")

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        _url_tag(f"{SITE}/", lastmod, "weekly", "1.0"),
        _url_tag(f"{SITE}/auctions", lastmod, "daily", "0.9"),
        _url_tag(f"{SITE}/bin", lastmod, "daily", "0.9"),
        _url_tag(f"{SITE}/drivers", lastmod, "daily", "0.9"),
        _url_tag(f"{SITE}/sales", lastmod, "daily", "0.9"),
        _url_tag(f"{SITE}/race-weekend", lastmod, "daily", "0.9"),
    ]
    parts.extend(_iter_driver_urls(db, lastmod))
    parts.extend(_iter_card_urls(db, lastmod, limit=1000))
    parts.append("</urlset>")

    xml = "".join(parts)
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )
