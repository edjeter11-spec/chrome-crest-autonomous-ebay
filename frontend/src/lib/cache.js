/**
 * Stale-while-revalidate cache.
 * Shows cached data instantly, always re-fetches fresh data in background.
 */
const _store = new Map()

/**
 * Fetch with SWR behaviour.
 * @param {string} url
 * @param {(data: any) => void} onData  - called immediately with cached data (if any), then again with fresh data
 * @param {() => void} [onDone]         - called after fresh fetch completes (success or fail)
 * @param {(err: Error) => void} [onError] - called on fetch failure (before onDone)
 */
export function swrFetch(url, onData, onDone, onError) {
  const cached = _store.get(url)
  if (cached !== undefined) onData(cached)

  fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
    .then(data => { _store.set(url, data); onData(data) })
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
    if (key.includes(pattern)) _store.delete(key)
  }
}
