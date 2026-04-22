import { useEffect, useMemo, useState } from 'react'
import { Target, Clock } from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'

function parseUtc(s) {
  if (!s) return null
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(String(s))
  return new Date(hasTz ? s : s + 'Z')
}

function secsLeft(a) {
  if (!a) return 0
  if (a.end_time) {
    const dt = parseUtc(a.end_time)
    if (dt) {
      const s = Math.floor((dt.getTime() - Date.now()) / 1000)
      if (!Number.isNaN(s)) return Math.max(0, s)
    }
  }
  return a.time_left || 0
}

function verdictRank(v) {
  if (v === 'STRONG_BUY') return 2
  if (v === 'GOOD_BUY') return 1
  return 0
}

const BORING_PARALLELS = new Set([
  'Base', 'B&W Ray Wave', 'B&W Lazer', 'Floor It', 'Four & More', 'Refractor',
  'Prism Refractor', 'Checker Flag', 'Diamond 75th'
])
const RARE_PRINT_RUN_RE = /\/(5|10|15|20|25|50|75)\b/

function isBigSnipe(a, maxSecs) {
  const secs = secsLeft(a)
  if (secs <= 0 || secs > maxSecs) return false
  const price = a.current_price || 0
  const parallel = a.card?.parallel || a.parallel || ''
  const title = (a.title || '').toLowerCase()

  if (BORING_PARALLELS.has(parallel)) return false
  if (/\bb\s*&\s*w\b|black\s*&\s*white|floor it|four & more/.test(title)) return false

  if (price < 20 && (a.bid_count || 0) < 2) return false

  if (price >= 100) return true
  if (/\bauto(graph)?\b|\bsigned\b/.test(title)) return true
  if (RARE_PRINT_RUN_RE.test(title)) return true
  if (a.verdict === 'STRONG_BUY') return true

  return false
}

function AuctionRow({ a, nowTick }) {
  const sL = Math.max(0, Math.floor(((a.end_time ? parseUtc(a.end_time).getTime() : 0) - nowTick) / 1000))
  const h = Math.floor(sL / 3600)
  const m = Math.floor((sL % 3600) / 60)
  const sec = sL % 60
  const pad = n => String(n).padStart(2, '0')
  const timeStr = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
  const verdict = a.verdict
  const isGood = verdict === 'STRONG_BUY' || verdict === 'GOOD_BUY'
  const median = a.median_price || a.median_sold_price
  const pctBelow = median && a.current_price ? Math.round((1 - a.current_price / median) * 100) : null
  return (
    <div className="px-4 py-3 hover:bg-gray-800/40 transition-colors flex gap-3">
      {a.image_url ? (
        <img src={a.image_url} alt="" className="w-16 h-20 object-cover rounded shrink-0 bg-gray-800" />
      ) : (
        <div className="w-16 h-20 rounded bg-gray-800 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <div className="text-xs font-bold text-white truncate">
            {a.driver_name || a.driver || '—'}
            {a.parallel && a.parallel !== 'Base' && (
              <span className="text-gray-300"> · {a.parallel}</span>
            )}
          </div>
          {isGood && (
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${
              verdict === 'STRONG_BUY' ? 'bg-emerald-600/40 text-emerald-200' : 'bg-emerald-600/25 text-emerald-300'
            }`}>
              {verdict === 'STRONG_BUY' ? 'STRONG BUY' : 'GOOD BUY'}
            </span>
          )}
        </div>
        {pctBelow && pctBelow > 0 && (
          <div className="text-[10px] text-emerald-400 font-semibold mb-0.5">{pctBelow}% off median</div>
        )}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xl font-black text-yellow-400">${Math.round(a.current_price || 0).toLocaleString()}</span>
          {a._live && (
            <span className="text-[8px] font-black px-1 py-0.5 rounded bg-green-600/30 text-green-300 border border-green-500/40 uppercase tracking-wider">● live</span>
          )}
          {median ? <span className="text-[10px] text-gray-500">med ${Math.round(median).toLocaleString()}</span> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-red-400 tabular-nums font-bold">{timeStr}</span>
          {a.ebay_url && (
            <a
              href={ebayAffiliateUrl(a.ebay_url)}
              target="_blank"
              rel="sponsored noopener"
              className="text-[10px] font-black px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              Buy on eBay →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BiggestSnipes({ auctions = [], loading = false }) {
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Live-price overlay: map of eBay item ID -> { current_price, bid_count } fetched
  // from /api/ebay/live-prices so the rendered bid matches the actual eBay listing.
  const [liveMap, setLiveMap] = useState({})

  const candidates = useMemo(() => {
    return (auctions || [])
      .filter(a => isBigSnipe(a, 6 * 3600))
      .sort((a, b) => {
        const vr = verdictRank(b.verdict) - verdictRank(a.verdict)
        if (vr !== 0) return vr
        const s = (b.snipe_score || 0) - (a.snipe_score || 0)
        if (s !== 0) return s
        return secsLeft(a) - secsLeft(b)
      })
      .slice(0, 10)  // pick a few extra; live-price filter may drop stale ones
  }, [auctions])

  useEffect(() => {
    const ids = candidates
      .map(a => {
        const m = String(a.ebay_listing_id || '').match(/v\d+\|(\d+)\|\d+/)
        return m ? m[1] : null
      })
      .filter(Boolean)
      .slice(0, 8)
    if (!ids.length) return
    const API = import.meta.env.VITE_API_URL || ''
    fetch(`${API}/api/ebay/live-prices?ids=${ids.join(',')}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.items) return
        const m = {}
        for (const it of d.items) {
          if (it.ok) m[it.item_id] = { current_price: it.current_price, bid_count: it.bid_count, end_time: it.end_time }
        }
        setLiveMap(m)
      })
      .catch(() => {})
  }, [candidates])

  const items = useMemo(() => {
    return candidates
      .map(a => {
        const m = String(a.ebay_listing_id || '').match(/v\d+\|(\d+)\|\d+/)
        const id = m ? m[1] : null
        const live = id && liveMap[id]
        if (live && live.current_price != null) {
          return { ...a, current_price: live.current_price, bid_count: live.bid_count ?? a.bid_count, _live: true }
        }
        return a
      })
      .slice(0, 6)
  }, [candidates, liveMap, nowTick])

  const nextBig = useMemo(() => {
    return (auctions || [])
      .filter(a => {
        if (!isBigSnipe(a, 24 * 3600)) return false
        return (a.current_price || 0) >= 50
      })
      .sort((a, b) => secsLeft(a) - secsLeft(b))
      .slice(0, 6)
  }, [auctions, nowTick])

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Target size={14} className="text-red-400" />
            🎯 Biggest Snipes
          </h2>
          <div className="text-[10px] text-gray-500 mt-1 font-medium">
            Ending ≤6h · rare parallels + real money only
          </div>
        </div>
        <div className="flex-1 max-h-[560px] overflow-y-auto divide-y divide-gray-800/50">
          {loading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="px-4 py-3 animate-pulse flex gap-3">
                <div className="w-16 h-20 bg-gray-800 rounded" />
                <div className="flex-1">
                  <div className="h-3 bg-gray-800 rounded w-2/3 mb-1.5" />
                  <div className="h-2.5 bg-gray-800 rounded w-1/2" />
                </div>
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-600 text-sm px-4">
              No big snipes ending soon — the action is elsewhere right now. Check back in an hour.
            </div>
          ) : (
            items.map((a, i) => <AuctionRow key={a.id || a.ebay_listing_id || i} a={a} nowTick={nowTick} />)
          )}
        </div>
      </div>

      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Clock size={14} className="text-amber-400" />
            ⏰ Next Big Auctions
          </h2>
          <div className="text-[10px] text-gray-500 mt-1 font-medium">
            ending next 24h · $50+
          </div>
        </div>
        <div className="flex-1 max-h-[560px] overflow-y-auto divide-y divide-gray-800/50">
          {loading ? null : nextBig.length === 0 ? (
            <div className="py-8 text-center text-gray-600 text-sm px-4">
              Nothing big on deck in the next 24h.
            </div>
          ) : (
            nextBig.map((a, i) => <AuctionRow key={a.id || a.ebay_listing_id || i} a={a} nowTick={nowTick} />)
          )}
        </div>
      </div>
    </div>
  )
}
