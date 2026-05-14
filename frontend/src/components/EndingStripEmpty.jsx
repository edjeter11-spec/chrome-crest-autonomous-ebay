import { useState } from 'react'
import { RefreshCw, Clock } from 'lucide-react'

// Match every other module — was VITE_API_BASE which is undefined in prod;
// the 'Pull live from eBay' button was POST'ing to a relative URL → broken.
const API = import.meta.env.VITE_API_URL || ''

function fmtUntil(secs) {
  if (secs == null || secs <= 0) return ''
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Smart empty state for the Ending Soonest strip. When the filter returns 0
 * but the DB has live auctions further out, show:
 *   "No qualifying auctions in the next 24h. Next ends in 13h: Title."
 * Plus a "Refresh from eBay" button that triggers /api/sniper/refresh-imminent.
 */
export default function EndingStripEmpty({ allAuctions, lastSyncAt, onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState(null)

  // Find next live auction across the full set, regardless of strip filter.
  const now = Date.now()
  const upcoming = (allAuctions || [])
    .map(a => {
      if (!a?.end_time) return null
      const t = new Date(a.end_time).getTime()
      const secs = Math.floor((t - now) / 1000)
      if (secs <= 0) return null
      const bo = a.buying_options || []
      const isLive = bo.includes('AUCTION') || (a.bid_count || 0) > 0 || bo.length === 0
      if (!isLive) return null
      return { secs, auction: a }
    })
    .filter(Boolean)
    .sort((a, b) => a.secs - b.secs)[0]

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setMsg(null)
    try {
      const r = await fetch(`${API}/api/sniper/refresh-imminent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await r.json().catch(() => ({}))
      if (data?.ok) {
        const fetched = data.fetched ?? 0
        const ending30 = data.ending_in_30m ?? 0
        setMsg(`Pulled ${fetched} from eBay${ending30 ? ` · ${ending30} ending in 30m` : ''}`)
        onRefreshed?.(data)
      } else if (data?.error === 'rate_limited') {
        setMsg(`Slow down — try again in ${data.retry_after || 60}s`)
      } else {
        setMsg('Refresh failed — try again in a moment')
      }
    } catch {
      setMsg('Network error — try again')
    } finally {
      setRefreshing(false)
    }
  }

  const lastSyncText = lastSyncAt
    ? `Last checked ${Math.max(1, Math.floor((Date.now() - lastSyncAt.getTime()) / 60000))}m ago`
    : 'Live'

  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-gray-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">
              No qualifying auctions ending in the next 24h
            </div>
            {upcoming ? (
              <div className="text-xs text-gray-400 mt-1">
                <span className="text-gray-300 font-medium">Next: {fmtUntil(upcoming.secs)}</span>
                <span className="mx-1.5 text-gray-600">·</span>
                <span className="text-gray-400">
                  {(upcoming.auction.title || '').slice(0, 60)}
                  {upcoming.auction.title?.length > 60 ? '…' : ''}
                </span>
              </div>
            ) : (
              <div className="text-xs text-gray-500 mt-1">
                Quiet window — eBay sellers tend to end auctions during US daytime
              </div>
            )}
            <div className="text-[11px] text-gray-500 mt-1.5">{lastSyncText}</div>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg bg-red-600/90 hover:bg-red-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Checking…' : 'Pull live from eBay'}
        </button>
      </div>
      {msg && (
        <div className="mt-3 text-xs text-gray-400 border-t border-gray-800/60 pt-3">{msg}</div>
      )}
    </div>
  )
}
