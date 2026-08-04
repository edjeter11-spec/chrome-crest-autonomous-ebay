"""Re-derive sold_cards.parallel from listing titles.

WHY
---
`sold_cards.parallel` is the comp-pool key: median_comp_price() matches it as
an exact string, so a wrong label silently prices a card against the wrong
tier. Rows were written by several generations of writers with divergent
parsers, so ~11% of the pool disagrees with its own title — including real
autographs filed as "Base"/"Refractor", which inflates the cheap-tier medians
that the dashboard's "usually sells for" figure comes from.

This re-parses every row with the current canonical parser
(ebay_api.extract_parallel_from_title) and writes back only where it is SAFE
to do so.

SAFETY RULES (why this is not a blind UPDATE)
---------------------------------------------
1. MANGLED TITLES ARE NEVER TRUSTED. ~1,200 rows written between 2026-01-23
   and 2026-06-07 by the now-dead eBay HTML scraper had every "s" before a
   space stripped ("Topps"->"Topp", "Neon Nations"->"Neon Nation",
   "Vegas At Night"->"Vega At Night"). The parser cannot read those, and
   would "correct" a correct stored label down to Base. Detected
   heuristically and skipped — the stored label is better than the parse.
2. NEVER DOWNGRADE A SPECIFIC LABEL TO A GENERIC ONE. If the stored value is
   a real parallel and the parse yields Base (the parser's fallthrough, i.e.
   "I could not tell"), keep what is stored. A parse only wins when it is
   positively identifying something.
3. AMBIGUOUS MULTI-TIER CARDS ARE LEFT ALONE. A title carrying two print
   runs ("Red 1/5 1/1", "Speed Wheels F1 75 ... 57/75") is genuinely several
   things at once; the parser must pick one and would discard the rest.
4. DRY RUN BY DEFAULT. Pass --apply to write. Always prints a full
   before/after breakdown first.

Usage:
    python scripts/backfill_sold_parallels.py            # dry run
    python scripts/backfill_sold_parallels.py --apply    # write
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sqlalchemy import text  # noqa: E402

from database import engine  # noqa: E402
from ebay_api import extract_parallel_from_title as parse_parallel  # noqa: E402

# Titles from the dead eBay-HTML writer lost every "s" that preceded a space.
# These fingerprints are unambiguous — no real listing says "Topp Chrome".
_MANGLED_FINGERPRINTS = (
    "topp chrome",
    "topp  ",
    "neon nation ",
    "vega at night",
    "anniver ary",
    "li t!",
    "charle ",
    "norri ",
    "alon o",
)


def is_mangled(title: str) -> bool:
    """True when the title lost characters in transit and can't be parsed."""
    t = (title or "").lower()
    if any(f in t for f in _MANGLED_FINGERPRINTS):
        return True
    # Generic tell: a lone "s" orphaned between spaces, or a word ending in a
    # space where an "s" plainly belonged (e.g. "Topp " mid-title).
    return bool(re.search(r"\btopp\b|\bcard \b(?= )", t))


# The parser's fallthrough value — "I couldn't identify one", not a finding.
_GENERIC = {"Base", "", None}


def competing_print_runs(title: str) -> bool:
    """True when the title carries more than one distinct print run.

    The parser returns ONE label, but these cards are genuinely a combination
    of tiers — "Logo Fractor Red 1/5 1/1" is a Red /5 that is also a 1-of-1,
    "Speed Wheels F1 75 Logo Fractor 57/75" is an insert that is also /75.
    Whichever single label the parser picks silently discards the rest, and it
    is not necessarily a better answer than what is already stored. There is no
    correct single value to write, so leave these alone rather than churn them.
    """
    runs = set(re.findall(r"/\s*(\d{1,4})(?!\d)", title or ""))
    # "1/1" also appears as a bare ratio; count it when present.
    if re.search(r"(?<!\d)1\s*/\s*1(?!\d)", title or ""):
        runs.add("1")
    return len(runs) > 1


def main() -> int:
    apply = "--apply" in sys.argv

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, title, parallel FROM sold_cards")
        ).fetchall()

    updates: list[tuple[int, str]] = []
    skipped_mangled = 0
    skipped_downgrade = 0
    skipped_ambiguous = 0

    for row_id, title, stored in rows:
        if not title:
            continue
        if is_mangled(title):
            skipped_mangled += 1
            continue
        parsed = parse_parallel(title)
        if parsed == (stored or ""):
            continue
        # Rule 2: a generic parse never overwrites a specific stored label.
        if parsed in _GENERIC and stored not in _GENERIC:
            skipped_downgrade += 1
            continue
        # Rule 4: ambiguous multi-tier cards keep whatever they have.
        if competing_print_runs(title) and stored not in _GENERIC:
            skipped_ambiguous += 1
            continue
        updates.append((row_id, parsed))

    print(f"scanned rows:            {len(rows)}")
    print(f"skipped (mangled title): {skipped_mangled}")
    print(f"skipped (no downgrade):  {skipped_downgrade}")
    print(f"skipped (multi-tier):    {skipped_ambiguous}")
    print(f"to update:               {len(updates)}")

    if not updates:
        print("\nnothing to do.")
        return 0

    from collections import Counter

    stored_by_id = {r[0]: r[2] for r in rows}
    breakdown = Counter((stored_by_id[i], p) for i, p in updates)
    print("\ncorrections (stored -> new):")
    for (was, now), n in breakdown.most_common(30):
        print(f"  {n:>6}  {str(was):<20} -> {now}")

    if not apply:
        print("\nDRY RUN — no writes. Re-run with --apply to commit.")
        return 0

    written = 0
    with engine.begin() as conn:
        for row_id, parsed in updates:
            conn.execute(
                text("UPDATE sold_cards SET parallel = :p WHERE id = :i"),
                {"p": parsed, "i": row_id},
            )
            written += 1
    print(f"\nAPPLIED — {written} rows updated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
