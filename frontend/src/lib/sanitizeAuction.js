/**
 * Legacy scraper runs joined some listings to the WRONG card — team/logo
 * cards matched to driver cards (an Alpine logo card rendered as "Max
 * Verstappen · Auto" in Biggest Snipes). The join is only trustworthy when
 * the joined driver's surname actually appears in the listing title.
 *
 * When it doesn't: drop the card block AND the server-computed verdict/comps
 * (they were derived from the bogus joined driver, so "usually sells for"
 * would be a lie too). Every consumer already handles card:null — F1 Legends
 * rows ship without a join.
 */
export function sanitizeAuctionCardJoin(a) {
  if (!a || !a.card?.driver_name) return a
  const surname = a.card.driver_name.split(' ').slice(-1)[0]?.toLowerCase()
  if (surname && (a.title || '').toLowerCase().includes(surname)) return a
  return { ...a, card: null, verdict: null, verdict_comp: null }
}

export function sanitizeAuctions(arr) {
  return Array.isArray(arr) ? arr.map(sanitizeAuctionCardJoin) : arr
}
