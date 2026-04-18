"""
Fuzzy deduplication for SoldCard rows.

The same seller frequently re-lists the same card multiple times with slight
title variations. Each one gets a unique ebay_item_id, so exact-id dedup misses
these. We compute a fingerprint from (driver, parallel, grade, day, price-bucket)
and mark all but the earliest row in each fingerprint group as `is_duplicate`.

Downstream stats endpoints filter `is_duplicate = false` by default so these
soft duplicates don't inflate counts, skew medians, or fool snipe logic.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SoldCard, SessionLocal

logger = logging.getLogger(__name__)


def fingerprint(
    driver: Optional[str],
    parallel: Optional[str],
    grade: Optional[str],
    sale_date: Optional[datetime],
    sale_price: Optional[float],
) -> str:
    """
    Soft-dedup key.

    Buckets price into $2 windows so minor seller price fiddling ($12.49 vs
    $12.99) collapses. Buckets time into a single day. Uses lowercase for
    case-insensitive matching.
    """
    d = (driver or "").strip().lower()
    p = (parallel or "").strip().lower()
    g = (grade or "raw").strip().lower()
    day = sale_date.strftime("%Y-%m-%d") if sale_date else "unknown"
    price = float(sale_price or 0)
    # $2 buckets — $9.99 and $10.49 both map to 10; $12.01 and $13.99 both map to 14.
    bucket = round(price / 2) * 2
    return f"{d}|{p}|{g}|{day}|{bucket}"


def is_duplicate_of_existing(db: Session, sc: SoldCard) -> bool:
    """
    True if there's already a non-duplicate SoldCard in the DB matching the
    fingerprint of `sc` (excluding `sc` itself).
    """
    fp = fingerprint(sc.driver_name, sc.parallel, sc.grade, sc.sale_date, sc.sale_price)
    # Coarse filter in SQL on the cheapest columns, then compute fingerprint in
    # Python for the few candidate rows. Keeps us honest even when fields have
    # subtle whitespace differences.
    day_start = datetime.combine(sc.sale_date.date(), datetime.min.time()) if sc.sale_date else None
    if day_start is None:
        return False
    day_end = datetime.combine(sc.sale_date.date(), datetime.max.time())
    q = db.query(SoldCard).filter(
        SoldCard.driver_name == sc.driver_name,
        SoldCard.parallel == sc.parallel,
        SoldCard.sale_date >= day_start,
        SoldCard.sale_date <= day_end,
        SoldCard.is_duplicate == False,  # noqa: E712
    )
    if sc.id:
        q = q.filter(SoldCard.id != sc.id)
    for candidate in q.all():
        if fingerprint(
            candidate.driver_name, candidate.parallel, candidate.grade,
            candidate.sale_date, candidate.sale_price,
        ) == fp:
            return True
    return False


def backfill_duplicates(batch_size: int = 1000) -> dict:
    """
    One-time sweep of the sold_cards table. Groups rows by fingerprint and
    marks everything but the earliest `scraped_at` in each group as duplicate.

    Batches the UPDATE so very large tables don't blow connection timeouts.
    """
    db = SessionLocal()
    groups: dict[str, list[tuple[int, datetime]]] = {}
    total = 0
    try:
        # Stream rows in id-order so we stay memory-friendly on large tables.
        q = db.query(
            SoldCard.id, SoldCard.driver_name, SoldCard.parallel, SoldCard.grade,
            SoldCard.sale_date, SoldCard.sale_price, SoldCard.scraped_at,
        ).order_by(SoldCard.id.asc())
        for row in q.yield_per(5000):
            total += 1
            fp = fingerprint(row.driver_name, row.parallel, row.grade, row.sale_date, row.sale_price)
            groups.setdefault(fp, []).append((row.id, row.scraped_at or datetime.min))

        to_mark: list[int] = []
        for fp, members in groups.items():
            if len(members) < 2:
                continue
            # Keep earliest scraped_at; mark the rest.
            members.sort(key=lambda x: x[1])
            for id_, _ in members[1:]:
                to_mark.append(id_)

        # Reset everything to false first, then set the duplicates. This makes
        # the backfill idempotent: re-running it won't drift if the fingerprint
        # definition ever changes.
        db.execute(text("UPDATE sold_cards SET is_duplicate = FALSE WHERE is_duplicate = TRUE"))
        db.commit()

        marked = 0
        for i in range(0, len(to_mark), batch_size):
            chunk = to_mark[i:i + batch_size]
            db.execute(
                text("UPDATE sold_cards SET is_duplicate = TRUE WHERE id = ANY(:ids)"),
                {"ids": chunk},
            )
            db.commit()
            marked += len(chunk)
            logger.info(f"backfill_duplicates: marked {marked}/{len(to_mark)}")

        return {
            "total_rows": total,
            "fingerprint_groups": len(groups),
            "duplicate_groups": sum(1 for m in groups.values() if len(m) > 1),
            "rows_marked_duplicate": marked,
        }
    finally:
        db.close()
