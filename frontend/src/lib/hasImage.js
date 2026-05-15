/**
 * Eddie's directive: "There should not be a single listing that doesn't
 * have a photo of the actual card and if it's missing, hide it."
 *
 * Returns true only when the row has a real, non-placeholder image_url
 * we can render. Use to filter list arrays BEFORE rendering — no
 * "Driver Name placeholder grey box" rows leak into Biggest Snipes,
 * Hot Snipes, Latest Sales, Ending Soonest, etc.
 *
 * Bad cases caught:
 *   - null / undefined / empty string image_url
 *   - urls containing 'placehold' (placehold.it / placeholder.com)
 *   - data: scheme placeholders (some scrapers leave inline SVGs)
 */
export function hasImage(item) {
  if (!item) return false
  // image lives at different keys on different shapes — auctions vs sold cards
  const u = String(
    item.image_url ||
    item.image ||
    item.thumbnail ||
    item.card?.image_url ||
    ''
  ).trim()
  if (!u) return false
  if (u.startsWith('data:')) return false
  const lower = u.toLowerCase()
  if (lower.includes('placehold')) return false
  if (lower.endsWith('/no-image.png') || lower.endsWith('/missing.png')) return false
  return true
}
