/**
 * F1 Card Vault — Background service worker.
 *
 * Single responsibility: relay verdict-batch requests from content scripts to
 * the f1cardvault.com API and cache responses. Content scripts can't call our
 * API directly with credentials, but the service worker can — and centralizing
 * the cache means scrolling the same eBay page twice doesn't re-hit the API.
 */

const DEFAULT_API_BASE = 'https://www.f1cardvault.com'
const CACHE_TTL_MS = 60_000 // 60s — same as our server-side s-maxage

// In-memory cache: title|price → { verdict, expiresAt }
const cache = new Map()

async function getApiBase() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE }, ({ apiBase }) => {
      resolve(apiBase || DEFAULT_API_BASE)
    })
  })
}

function cacheKey(item) {
  return `${item.title}|${Math.round((item.price || 0) * 100)}`
}

async function fetchVerdicts(items) {
  const apiBase = await getApiBase()
  const now = Date.now()

  // Split into cached + needs-fetch
  const out = new Array(items.length).fill(null)
  const needIdx = []
  const needItems = []
  items.forEach((it, i) => {
    if (!it || !it.title) return
    const k = cacheKey(it)
    const hit = cache.get(k)
    if (hit && hit.expiresAt > now) {
      out[i] = hit.verdict
    } else {
      needIdx.push(i)
      needItems.push(it)
    }
  })

  if (needItems.length === 0) return out

  try {
    const resp = await fetch(`${apiBase}/api/extension/verdicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: needItems }),
    })
    if (!resp.ok) {
      console.warn('[F1 Vault ext] API error', resp.status)
      return out
    }
    const data = await resp.json()
    const verdicts = data.verdicts || []
    needIdx.forEach((origIdx, j) => {
      const v = verdicts[j] ?? null
      out[origIdx] = v
      const k = cacheKey(needItems[j])
      cache.set(k, { verdict: v, expiresAt: now + CACHE_TTL_MS })
    })
  } catch (e) {
    console.warn('[F1 Vault ext] fetch failed', e)
  }

  return out
}

// Cache eviction: keep the map under 1000 entries.
function maybeEvict() {
  if (cache.size <= 1000) return
  const now = Date.now()
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k)
  }
  if (cache.size > 1000) {
    const keys = [...cache.keys()].slice(0, cache.size - 800)
    keys.forEach(k => cache.delete(k))
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'verdicts:batch') {
    fetchVerdicts(msg.items || []).then(verdicts => {
      maybeEvict()
      sendResponse({ ok: true, verdicts })
    })
    return true // async response
  }
  if (msg?.type === 'cache:clear') {
    cache.clear()
    sendResponse({ ok: true })
    return false
  }
  if (msg?.type === 'cache:size') {
    sendResponse({ ok: true, size: cache.size })
    return false
  }
})

// Initialize defaults on install.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE, enabled: true }, current => {
    chrome.storage.sync.set(current)
  })
})
