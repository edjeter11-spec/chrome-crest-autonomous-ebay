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
 */
export function swrFetch(url, onData, onDone) {
  const cached = _store.get(url)
  if (cached !== undefined) onData(cached)

  fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
    .then(data => { _store.set(url, data); onData(data) })
    .catch(() => {})
    .finally(() => onDone?.())
}

export function invalidate(pattern) {
  for (const key of _store.keys()) {
    if (key.includes(pattern)) _store.delete(key)
  }
}
