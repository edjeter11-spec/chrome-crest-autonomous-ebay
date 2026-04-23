// Wraps any eBay URL with EPN (eBay Partner Network) affiliate params.
// Set VITE_EBAY_CAMPID in Vercel env to your campaign ID once approved.
// Until then, this passes the raw URL through unchanged.
const CAMPID = import.meta.env.VITE_EBAY_CAMPID || ''
const CUSTOMID = import.meta.env.VITE_EBAY_CUSTOMID || 'f1cardhub'
// US rotator. For other regions see https://partnernetwork.ebay.com docs.
const ROTATOR = '711-53200-19255-0'

const API = import.meta.env.VITE_API_URL || ''

export function ebayAffiliateUrl(url) {
  if (!url || typeof url !== 'string') return url
  if (!CAMPID) return url
  try {
    const u = new URL(url)
    if (!u.hostname.includes('ebay.')) return url
    u.searchParams.set('mkcid', '1')
    u.searchParams.set('mkrid', ROTATOR)
    u.searchParams.set('siteid', '0')
    u.searchParams.set('campid', CAMPID)
    u.searchParams.set('customid', CUSTOMID)
    u.searchParams.set('toolid', '10001')
    u.searchParams.set('mkevt', '1')
    return u.toString()
  } catch {
    return url
  }
}

// Fire-and-forget affiliate click logger. Uses sendBeacon so it never blocks
// the outbound navigation. Returns the (possibly-affiliate-wrapped) URL for
// chaining: `window.open(trackClick(url, auctionId, cardId))`.
export function trackClick(url, auction_id, card_id) {
  try {
    const body = JSON.stringify({
      auction_id: auction_id ?? null,
      card_id: card_id ?? null,
      url: url || '',
    })
    const endpoint = `${API}/api/clicks`
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(endpoint, blob)
    } else if (typeof fetch !== 'undefined') {
      // Fallback: keepalive fetch so it survives unload
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // swallow — never break navigation
  }
  return ebayAffiliateUrl(url)
}
