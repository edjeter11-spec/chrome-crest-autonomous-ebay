// Canonical F1 team color palette.
// Use teamColor(team) to resolve any team string (case-insensitive, alias-aware)
// to its hex value. Returns null when the team is unknown so callers can fall
// back to existing neutral styling.

export const TEAM_COLORS = {
  ferrari:       '#DC0000',
  mercedes:      '#00D7B6',
  mclaren:       '#FF8000',
  redbull:       '#1E41FF',
  astonmartin:   '#006F62',
  alpine:        '#0090FF',
  williams:      '#005AFF',
  racingbulls:   '#6692FF',
  sauber:        '#00E700',
  haas:          '#B6BABD',
}

// Alias substrings (lowercase, no spaces/punctuation) → palette key.
// Order matters: more specific matches first (e.g. "racingbulls" before "redbull").
const ALIASES = [
  ['ferrari',         'ferrari'],
  ['scuderia',        'ferrari'],
  ['mercedes',        'mercedes'],
  ['amg',             'mercedes'],
  ['mclaren',         'mclaren'],
  ['racingbulls',     'racingbulls'],
  ['visacashapprb',   'racingbulls'],
  ['vcarb',           'racingbulls'],
  ['rbf1',            'racingbulls'],
  ['alphatauri',      'racingbulls'],
  ['rb',              'racingbulls'],   // bare "RB" (Racing Bulls 2024+ rebrand)
  ['redbull',         'redbull'],
  ['oracleredbull',   'redbull'],
  ['astonmartin',     'astonmartin'],
  ['aramcoaston',     'astonmartin'],
  ['alpine',          'alpine'],
  ['bwtalpine',       'alpine'],
  ['williams',        'williams'],
  ['atlassianwilliams','williams'],
  ['haas',            'haas'],
  ['moneygram',       'haas'],
  ['stake',           'sauber'],
  ['kicksauber',      'sauber'],
  ['stakesauber',     'sauber'],
  ['sauber',          'sauber'],
  ['alfaromeo',       'sauber'],         // pre-2024 Sauber branding
]

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve a team string to its canonical palette key, or null if unknown.
 * Handles aliases like "Scuderia Ferrari", "Stake F1 Team Kick Sauber",
 * "Visa Cash App RB", "Oracle Red Bull Racing", etc.
 */
export function teamKey(team) {
  if (!team) return null
  const n = normalize(team)
  if (!n) return null
  for (const [needle, key] of ALIASES) {
    if (n.includes(needle)) return key
  }
  return null
}

/**
 * Returns the hex color for a team string, or null if the team is unknown.
 * Callers should fall back to gray styling on null.
 */
export function teamColor(team) {
  const key = teamKey(team)
  return key ? TEAM_COLORS[key] : null
}

/**
 * Same as teamColor but with a fallback hex when the team is unknown.
 * Convenient for inline style props where null breaks the cascade.
 */
export function teamColorOr(team, fallback = '#6B7280') {
  return teamColor(team) || fallback
}
