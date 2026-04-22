// Fetch driver photos from backend API (which sources from DB or Wikipedia).
// Backend serves cached photos from database, falls back to Wikipedia if missing.
// Frontend caches URLs locally for 30 days to minimize backend requests.

const CACHE_KEY = 'cc_driver_photos_v3'
const TTL_MS = 30 * 24 * 3600 * 1000
const API = import.meta.env.VITE_API_URL || ''

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed.ts || Date.now() - parsed.ts > TTL_MS) return {}
    return parsed.map || {}
  } catch { return {} }
}

function saveCache(map) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), map })) } catch {}
}

let cache = loadCache()
const inflight = new Map()

export async function fetchDriverPhoto(name) {
  if (!name) return ''
  if (cache[name] !== undefined) return cache[name]
  if (inflight.has(name)) return inflight.get(name)

  const promise = (async () => {
    try {
      // Try backend endpoint first (uses DB image_url or Wikipedia fallback)
      const r = await fetch(`${API}/api/drivers/photo?name=${encodeURIComponent(name)}&redirect=false`)
      if (r.ok) {
        const j = await r.json()
        const url = j?.photo_url || ''
        cache[name] = url
        saveCache(cache)
        return url
      }
    } catch (e) {
      console.warn(`Backend photo fetch failed for ${name}:`, e.message)
    }

    // If backend fails, try Wikipedia REST API directly as fallback
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
      if (r.ok) {
        const j = await r.json()
        const url = j?.thumbnail?.source || j?.originalimage?.source || ''
        cache[name] = url
        saveCache(cache)
        return url
      }
    } catch (e) {
      console.warn(`Wikipedia photo fetch failed for ${name}:`, e.message)
    }

    cache[name] = ''
    saveCache(cache)
    return ''
  })()

  inflight.set(name, promise)
  return promise
}

export function driverInitials(name) {
  return (name || '').split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2)
}
