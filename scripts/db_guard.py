"""Shared DB-target guard for every scraper script.

Why this exists: the app migrated Supabase -> Neon on 2026-06-08, but the
GitHub Actions DATABASE_URL secret (last set 2026-04-17) was never updated.
For SEVEN WEEKS every scheduled run connected to the dead Supabase DB,
reported thousands of successful upserts, and wrote into a database the
site no longer reads. Nothing errored — the logs looked perfect while the
Sales page silently froze at 2026-06-08. That outage was only caught by
hand, weeks later.

A wrong-DB target must never again look like success in ANY scraper, not
just the two that happened to get patched first. Every script that writes
to the database calls assert_expected_db(url) before opening a connection;
a mismatch crashes the job so it shows up as a red run, not a green one
with no effect.
"""
import logging
import sys

log = logging.getLogger("db_guard")

EXPECTED_HOST_FRAGMENT = "neon.tech"


def assert_expected_db(db_url):
    """Fail LOUDLY if db_url doesn't point at the live app database."""
    host = ""
    try:
        host = (db_url or "").split("@", 1)[1].split("/", 1)[0]
    except Exception:
        pass
    if EXPECTED_HOST_FRAGMENT not in host:
        log.error(
            "DATABASE_URL points at %r, which is not the live Neon database. "
            "Refusing to run — writes here would be silently discarded. "
            "Update the DATABASE_URL secret to match Vercel production.",
            host or "<unparseable>",
        )
        sys.exit(1)
    log.info(f"DB target OK: {host}")
