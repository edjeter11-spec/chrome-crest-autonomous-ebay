"""Driver name normalization — collapse all variants to the canonical 'First Last'.

Driver-name input across scrapers, the eBay Finding API, and legacy seed data is
inconsistent: 'Hamilton', 'lewis hamilton', 'LEWIS HAMILTON', 'Lewis HAMILTON'
all show up. That splits median comp aggregates silently and tanks verdict
accuracy. ``normalize_driver`` collapses everything to one canonical form.

The map below is intentionally case-insensitive (keys are lowercased) and
covers both bare last names and common full-name variants. New variants get
added here as we find them — see the test for coverage.

Ambiguous last names ("Hill" — Damon vs Phil vs Graham; "Villeneuve" — Jacques
vs Gilles; "Schumacher" — Michael vs Mick; "Rosberg" — Nico vs Keke) resolve
to the most common F1-card-market figure. If you have cards of the other one,
write the full name in the source — never rely on the last-name fallback.
"""

# Map of common variants → canonical form. Last-name only OR all-caps both
# get folded into 'First Last'. Add more as you find them. Keys MUST be
# lowercase — normalize_driver lowercases its input before lookup.
CANONICAL = {
    # Current grid (2026)
    "verstappen": "Max Verstappen",
    "max verstappen": "Max Verstappen",
    "hamilton": "Lewis Hamilton",
    "lewis hamilton": "Lewis Hamilton",
    "norris": "Lando Norris",
    "lando norris": "Lando Norris",
    "piastri": "Oscar Piastri",
    "oscar piastri": "Oscar Piastri",
    "leclerc": "Charles Leclerc",
    "charles leclerc": "Charles Leclerc",
    "russell": "George Russell",
    "george russell": "George Russell",
    "antonelli": "Andrea Kimi Antonelli",
    "kimi antonelli": "Andrea Kimi Antonelli",
    "andrea kimi antonelli": "Andrea Kimi Antonelli",
    "kimi": "Andrea Kimi Antonelli",
    "sainz": "Carlos Sainz",
    "carlos sainz": "Carlos Sainz",
    "alonso": "Fernando Alonso",
    "fernando alonso": "Fernando Alonso",
    "stroll": "Lance Stroll",
    "lance stroll": "Lance Stroll",
    "ocon": "Esteban Ocon",
    "esteban ocon": "Esteban Ocon",
    "gasly": "Pierre Gasly",
    "pierre gasly": "Pierre Gasly",
    "tsunoda": "Yuki Tsunoda",
    "yuki tsunoda": "Yuki Tsunoda",
    "albon": "Alex Albon",
    "alex albon": "Alex Albon",
    "alexander albon": "Alex Albon",
    "hulkenberg": "Nico Hulkenberg",
    "nico hulkenberg": "Nico Hulkenberg",
    "lawson": "Liam Lawson",
    "liam lawson": "Liam Lawson",
    "colapinto": "Franco Colapinto",
    "franco colapinto": "Franco Colapinto",
    "bortoleto": "Gabriel Bortoleto",
    "gabriel bortoleto": "Gabriel Bortoleto",
    "bearman": "Oliver Bearman",
    "oliver bearman": "Oliver Bearman",
    "hadjar": "Isack Hadjar",
    "isack hadjar": "Isack Hadjar",
    "doohan": "Jack Doohan",
    "jack doohan": "Jack Doohan",
    # Legends
    "senna": "Ayrton Senna",
    "ayrton senna": "Ayrton Senna",
    "hunt": "James Hunt",
    "james hunt": "James Hunt",
    "schumacher": "Michael Schumacher",   # default to Michael; Mick rare
    "michael schumacher": "Michael Schumacher",
    "hill": "Damon Hill",                  # most common — confirm none of ours are Phil/Graham
    "damon hill": "Damon Hill",
    "villeneuve": "Jacques Villeneuve",    # F1 winning Villeneuve
    "jacques villeneuve": "Jacques Villeneuve",
    "berger": "Gerhard Berger",
    "gerhard berger": "Gerhard Berger",
    "mansell": "Nigel Mansell",
    "nigel mansell": "Nigel Mansell",
    "lauda": "Niki Lauda",
    "niki lauda": "Niki Lauda",
    "prost": "Alain Prost",
    "alain prost": "Alain Prost",
    "montoya": "Juan Pablo Montoya",
    "juan pablo montoya": "Juan Pablo Montoya",
}


def normalize_driver(raw):
    """Return canonical driver name, or original if no match.

    Behavior:
        - None / non-string → returned unchanged (lets us safely wrap optional fields)
        - Exact (case-insensitive) match on full or partial name → canonical
        - Last-name fallback → canonical (handles "L. Hamilton" → "Lewis Hamilton")
        - Unknown name → returned unchanged (we don't want to silently mangle
          legitimate non-grid names like "Sergio Perez" that aren't in the map yet)
    """
    if not raw or not isinstance(raw, str):
        return raw
    key = raw.strip().lower()
    if not key:
        return raw
    if key in CANONICAL:
        return CANONICAL[key]
    # Try last-name-only fallback. Useful for "L. Hamilton", "M. VERSTAPPEN",
    # "Sir Lewis Hamilton" etc. — anything where the last token is a known surname.
    parts = key.split()
    if parts and parts[-1] in CANONICAL:
        return CANONICAL[parts[-1]]
    return raw  # leave as-is if unknown
