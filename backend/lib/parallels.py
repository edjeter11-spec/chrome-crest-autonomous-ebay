"""
Scarcity tier mapping for 2025 Topps Chrome F1 parallels.

Tier explains *why* a parallel is rare, beyond just the numeric print run.
Used to annotate auctions/sales and support "rarest first" sorts on the frontend.
"""

# Canonical scarcity map. Key is the parallel label (matches seed_data.PARALLELS
# and frontend/src/lib/parallels.js labels). `count` is the print run (None =
# unnumbered). `tier` is the conviction letter grade.
SCARCITY = {
    # 1/1
    'SuperFractor': {'count': 1, 'tier': 'S'},
    # Numbered
    'Red /5': {'count': 5, 'tier': 'A+'},
    'Black /10': {'count': 10, 'tier': 'A'},
    'Orange /25': {'count': 25, 'tier': 'A-'},
    'Gold /50': {'count': 50, 'tier': 'B+'},
    'F1 75th /75': {'count': 75, 'tier': 'B'},
    'Green /99': {'count': 99, 'tier': 'B-'},
    'Blue /150': {'count': 150, 'tier': 'C+'},
    'Aqua /199': {'count': 199, 'tier': 'C'},
    'Pink /250': {'count': 250, 'tier': 'C-'},
    'Teal /299': {'count': 299, 'tier': 'D+'},

    # Unnumbered common refractors
    'Prism Refractor': {'count': None, 'tier': 'D'},
    'Refractor': {'count': None, 'tier': 'D'},
    'B&W Ray Wave': {'count': None, 'tier': 'D'},
    'B&W Lazer': {'count': None, 'tier': 'D'},
    'Checker Flag': {'count': None, 'tier': 'D'},

    # Base
    'Base': {'count': None, 'tier': 'F'},

    # Autograph (usually serial-numbered but varies)
    'Autograph': {'count': None, 'tier': 'A-'},

    # Inserts — usually unnumbered but chase cards
    'SuperFractor Auto': {'count': 1, 'tier': 'S'},
    'Vegas at Night': {'count': None, 'tier': 'I'},
    'Neon Nations': {'count': None, 'tier': 'I'},
    'Floor It': {'count': None, 'tier': 'I'},
    'Speed Wheels': {'count': None, 'tier': 'I'},
    'Top Speed': {'count': None, 'tier': 'I'},
    'Four & More': {'count': None, 'tier': 'I'},
    'Diamond 75th': {'count': None, 'tier': 'I'},
    'Helix': {'count': None, 'tier': 'I'},
    'Ultrasonic': {'count': None, 'tier': 'I'},
    'The Grail': {'count': None, 'tier': 'I'},
    'Futuro': {'count': None, 'tier': 'I'},
    'The Chain': {'count': None, 'tier': 'I'},
    'The Grid': {'count': None, 'tier': 'I'},
    'Helmet Collection': {'count': None, 'tier': 'I'},
    'Speed Demons': {'count': None, 'tier': 'I'},
    'Ace of Trades': {'count': None, 'tier': 'I'},
}


# Rank for sorting "Rarest first" — lower rank = rarer.
TIER_RANK = {
    'S': 0, 'A+': 1, 'A': 2, 'A-': 3,
    'B+': 4, 'B': 5, 'B-': 6,
    'C+': 7, 'C': 8, 'C-': 9,
    'D+': 10, 'D': 11,
    'I': 12,   # inserts — varies but harder to place vs numbered
    'F': 20,
    '-': 99,   # unknown
}


def scarcity_for(parallel: str | None) -> dict:
    """Return {'tier', 'count', 'rank'} for a parallel label. Unknown → tier '-'."""
    if not parallel:
        return {'tier': '-', 'count': None, 'rank': TIER_RANK['-']}
    rec = SCARCITY.get(parallel)
    if not rec:
        # Auto-variant fallbacks: "Auto Red /5" etc inherit from the numbered band
        low = parallel.lower()
        if 'superfractor' in low:
            return {'tier': 'S', 'count': 1, 'rank': 0}
        if '/5' in parallel and '/50' not in parallel and '/5)' not in parallel:
            return {'tier': 'A+', 'count': 5, 'rank': 1}
        if '/10' in parallel and '/100' not in parallel and '/150' not in parallel:
            return {'tier': 'A', 'count': 10, 'rank': 2}
        if '/25' in parallel:
            return {'tier': 'A-', 'count': 25, 'rank': 3}
        if '/50' in parallel and '/150' not in parallel and '/250' not in parallel:
            return {'tier': 'B+', 'count': 50, 'rank': 4}
        if '/75' in parallel:
            return {'tier': 'B', 'count': 75, 'rank': 5}
        if '/99' in parallel:
            return {'tier': 'B-', 'count': 99, 'rank': 6}
        if '/150' in parallel:
            return {'tier': 'C+', 'count': 150, 'rank': 7}
        if '/199' in parallel:
            return {'tier': 'C', 'count': 199, 'rank': 8}
        if '/250' in parallel:
            return {'tier': 'C-', 'count': 250, 'rank': 9}
        if '/299' in parallel:
            return {'tier': 'D+', 'count': 299, 'rank': 10}
        if 'auto' in low:
            return {'tier': 'A-', 'count': None, 'rank': 3}
        return {'tier': '-', 'count': None, 'rank': TIER_RANK['-']}
    return {
        'tier': rec['tier'],
        'count': rec['count'],
        'rank': TIER_RANK.get(rec['tier'], TIER_RANK['-']),
    }


# 2025 F1 rookies + a few first-full-season drivers
ROOKIES_2025 = {
    'Andrea Kimi Antonelli',
    'Gabriel Bortoleto',
    'Oliver Bearman',
    'Isack Hadjar',
    'Jack Doohan',
    'Liam Lawson',
    'Franco Colapinto',
}


def is_rookie(driver_name: str | None) -> bool:
    if not driver_name:
        return False
    return driver_name.strip() in ROOKIES_2025
