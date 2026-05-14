/**
 * Stale-while-revalidate cache.
 * Shows cached data instantly, always re-fetches fresh data in background.
 *
 * Two layers:
 *   1. In-memory Map — hot cache for the current SPA navigation.
 *   2. sessionStorage — survives page reloads, so a refresh paints the
 *      previous data instantly while the network re-fetches in background.
 *      TTL: 5 min. All access wrapped in try/catch (Safari private mode
 *      throws on sessionStorage writes).
 */
const _store = new Map()

const SS_PREFIX = 'swr:'
const SS_TTL_MS = 5 * 60 * 1000  // 5 minutes

function ssGet(url) {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + url)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.t !== 'number') return undefined
    if (Date.now() - parsed.t > SS_TTL_MS) return undefined
    return parsed.d
  } catch { return undefined }
}

function ssSet(url, data) {
  try {
    sessionStorage.setItem(SS_PREFIX + url, JSON.stringify({ t: Date.now(), d: data }))
  } catch {
    // Quota exceeded or private-mode — best-effort, ignore.
  }
}

function ssDelete(url) {
  try { sessionStorage.removeItem(SS_PREFIX + url) } catch {}
}

/**
 * Fetch with SWR behaviour.
 * @param {string} url
 * @param {(data: any) => void} onData  - called immediately with cached data (if any), then again with fresh data
 * @param {() => void} [onDone]         - called after fresh fetch completes (success or fail)
 * @param {(err: Error) => void} [onError] - called on fetch failure (before onDone)
 */
export function swrFetch(url, onData, onDone, onError) {
  // Memory hit first (fastest). If miss, fall back to sessionStorage so a
  // page reload still paints instantly.
  const memCached = _store.get(url)
  if (memCached !== undefined) {
    onData(memCached)
  } else {
    const ssCached = ssGet(url)
    if (ssCached !== undefined) {
      _store.set(url, ssCached)  // promote to memory for subsequent calls
      onData(ssCached)
    }
  }

  fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
    .then(data => {
      _store.set(url, data)
      ssSet(url, data)
      onData(data)
    })
    .catch(err => {
      // Surface failures so callers can clear loading flags / show errors.
      // Previous version swallowed silently, which left pages stuck on
      // 'loading' forever when the API hiccupped (Sales tab on desktop bug).
      if (typeof onError === 'function') {
        try { onError(err) } catch {}
      } else {
        try { console.warn('[swrFetch]', url, err?.message || err) } catch {}
      }
    })
    .finally(() => onDone?.())
}

export function invalidate(pattern) {
  for (const key of _store.keys()) {
    if (key.includes(pattern)) {
      _store.delete(key)
      ssDelete(key)
    }
  }
}
