// Season/year detection for cards. We keep all years of data in the DB so
// that multi-year features can be built later (2024/2023/2022), but for now
// the public site should only show 2025 Topps Chrome F1.

const YEAR_RE = /\b(20\d{2})\b/

export function seasonOf(item) {
  const t = (item?.title || '') + ' ' + (item?.card?.title || '')
  const m = t.match(YEAR_RE)
  if (m) return Number(m[1])
  // Fall back to the item's own year fields if present.
  return item?.year || item?.season_year || null
}

export function isSeason2025(item) {
  const y = seasonOf(item)
  // If no year can be determined, assume current-year (most of the DB is 2025).
  if (y == null) return true
  return y === 2025
}

// Apply default season filter to any array of auctions/sales. Passthrough if
// filter is disabled.
export function applySeasonFilter(items, enabled = true) {
  if (!enabled || !Array.isArray(items)) return items || []
  return items.filter(isSeason2025)
}

// Notable filter: cards >= $25, exclude plain Base + B&W + noisy inserts.
const BORING_PARALLELS = new Set([
  'Base', 'B&W Ray Wave', 'B&W Lazer', 'Floor It', 'Four & More',
])
const NOTABLE_MIN_PRICE = 25

export function isNotable(s) {
  const price = s?.sale_price ?? s?.total_cost ?? s?.current_price ?? 0
  if (!price || price < NOTABLE_MIN_PRICE) return false
  const parallel = s?.parallel || s?.card?.parallel || ''
  if (BORING_PARALLELS.has(parallel)) return false
  const t = (s?.title || '').toLowerCase()
  if (/\bb\s*&\s*w\b|black\s*&\s*white|floor it|four & more/.test(t)) return false
  return true
}
