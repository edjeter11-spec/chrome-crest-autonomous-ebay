"""
Helper to log scraper_runs rows from any scraper. Fire-and-forget — never
raises; silently no-ops if the table hasn't been migrated yet.
"""
from contextlib import contextmanager
from datetime import datetime


@contextmanager
def scraper_run(source: str, run_id: str | None = None):
    """
    Usage:
        with scraper_run('eBay') as rec:
            rec['queries_attempted'] += 1
            ...
            rec['rows_inserted'] += n

    On exit, writes a scraper_runs row with rec['...'] fields.
    """
    rec = {
        "source": source,
        "started_at": datetime.utcnow(),
        "queries_attempted": 0,
        "queries_succeeded": 0,
        "rows_seen": 0,
        "rows_inserted": 0,
        "rows_updated": 0,
        "rows_skipped_dup": 0,
        "blocked": False,
        "error_message": None,
        "run_id": run_id,
    }
    try:
        yield rec
    except Exception as e:
        rec["error_message"] = str(e)[:400]
        # Re-raise so callers notice; still persist below.
        try:
            _write(rec)
        except Exception:
            pass
        raise
    _write(rec)


def _write(rec: dict):
    try:
        from database import SessionLocal, ScraperRun
        db = SessionLocal()
        try:
            db.add(ScraperRun(
                source=rec.get("source"),
                started_at=rec.get("started_at"),
                ended_at=datetime.utcnow(),
                queries_attempted=int(rec.get("queries_attempted") or 0),
                queries_succeeded=int(rec.get("queries_succeeded") or 0),
                rows_seen=int(rec.get("rows_seen") or 0),
                rows_inserted=int(rec.get("rows_inserted") or 0),
                rows_updated=int(rec.get("rows_updated") or 0),
                rows_skipped_dup=int(rec.get("rows_skipped_dup") or 0),
                blocked=bool(rec.get("blocked") or False),
                error_message=rec.get("error_message"),
                run_id=rec.get("run_id"),
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        # Telemetry must never break the scraper itself.
        pass
