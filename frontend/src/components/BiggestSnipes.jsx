import { useEffect, useMemo, useState, useRef } from 'react'
import { Target, Clock } from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'
import { upscaleEbayImage } from '../lib/imageUrl'
import CardImagePlaceholder from './CardImagePlaceholder'

const API = import.meta.env.VITE_API_URL || ''

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

function SnipeImage({ src, driverName }) {
  // Pre-upscale eBay CDN URLs for sharper thumbs at the same render size.
  const upscaled = src ? upscaleEbayImage(src, 500) : ''
  const [stage, setStage] = useState('initial') // initial | retry | failed
  const [url, setUrl] = useState(upscaled)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setStage('initial')
    setUrl(upscaled)
    setLoaded(false)
  }, [upscaled])

  if (!upscaled || stage === 'failed') {
    return (
      <div className="w-16 h-20 rounded shrink-0 overflow-hidden">
        <CardImagePlaceholder
          driverName={driverName}
          labelClassName="text-[10px] font-black tracking-widest"
        />
      </div>
    )
  }
  return (
    <div className="relative w-16 h-20 rounded shrink-0 overflow-hidden bg-gray-800">
      {!loaded && <div className="absolute inset-0 bg-gray-800 animate-pulse" aria-hidden="true" />}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={`w-full h-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (stage === 'initial') {
            const sep = upscaled.includes('?') ? '&' : '?'
            setUrl(`${upscaled}${sep}1`)
            setStage('retry')
          } else {
            setStage('failed')
          }
        }}
      />
    </div>
  )
}

function AuctionRow({ a, nowTick, freshOverride }) {
  const sL = Math.max(0, Math.floor(((a.end_time ? parseUtc(a.end_time).getTime() : 0) - nowTick) / 1000))
  const h = Math.floor(sL / 3600)
  const m = Math.floor((sL % 3600) / 60)
  const sec = sL % 60
  const pad = n => String(n).padStart(2, '0')
  const timeStr = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
  const verdict = a.verdict
  const isGood = verdict === 'STRONG_BUY' || verdict === 'GOOD_BUY'
  const median = a.median_price || a.median_sold_price
  // Prefer freshly-fetched price/bids over the (possibly stale) prop.
  const livePrice = freshOverride?.current_price ?? a.current_price
  const liveBids = freshOverride?.bid_count ?? a.bid_count
  const pctBelow = median && livePrice ? Math.round((1 - livePrice / median) * 100) : null
  const driverName = a.driver_name || a.driver || a.card?.driver_name
  // Freshness label — green dot if updated <2 min ago, otherwise show "Xm ago"
  const lastUpdatedRaw = freshOverride?.last_updated || a.last_updated
  let freshness = null
  if (lastUpdatedRaw) {
    const t = new Date(String(lastUpdatedRaw).endsWith('Z') ? lastUpdatedRaw : lastUpdatedRaw + 'Z').getTime()
    if (!Number.isNaN(t)) {
      const ageMin = Math.max(0, Math.floor((Date.now() - t) / 60000))
      if (ageMin < 2) {
        freshness = <span className="text-[9px] text-emerald-400 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live</span>
      } else if (ageMin < 60) {
        freshness = <span className="text-[9px] text-gray-500">Updated {ageMin}m ago</span>
      } else {
        const ageH = Math.floor(ageMin / 60)
        freshness = <span className="text-[9px] text-amber-500">Updated {ageH}h ago</span>
      }
    }
  }
  return (
    <div className="px-4 py-3 hover:bg-gray-800/40 transition-colors flex gap-3">
      <SnipeImage src={a.image_url} driverName={driverName} />
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
          <span className="text-xl font-black text-yellow-400">${Math.round(livePrice || 0).toLocaleString()}</span>
          {liveBids != null && liveBids > 0 && (
            <span className="text-[10px] text-gray-400">{liveBids} bid{liveBids === 1 ? '' : 's'}</span>
          )}
          {median ? <span className="text-[10px] text-gray-500">med ${Math.round(median).toLocaleString()}</span> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-red-400 tabular-nums font-bold">{timeStr}</span>
            {freshness}
          </div>
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
  // Map<auction.id, {current_price, bid_count, last_updated}> — fresh data
  // fetched per-item from /api/auctions/{id}/refresh so the showcase NEVER
  // shows the stale Browse-API snapshot. The cron is unreliable for items
  // outside the top-200 ending-soonest window — this is the safety net.
  const [freshMap, setFreshMap] = useState({})
  const inFlight = useRef(new Set())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const items = useMemo(() => {
    const FRESH_MS = 2 * 60 * 60 * 1000
    return (auctions || [])
      .filter(a => isBigSnipe(a, 6 * 3600))
      .filter(a => {
        if (!a.last_updated) return true
        const updated = new Date(a.last_updated + 'Z').getTime()
        return !updated || (Date.now() - updated) < FRESH_MS
      })
      .sort((a, b) => {
        const vr = verdictRank(b.verdict) - verdictRank(a.verdict)
        if (vr !== 0) return vr
        const s = (b.snipe_score || 0) - (a.snipe_score || 0)
        if (s !== 0) return s
        return secsLeft(a) - secsLeft(b)
      })
      .slice(0, 6)
  }, [auctions, nowTick])

  const nextBig = useMemo(() => {
    return (auctions || [])
      .filter(a => {
        if (!isBigSnipe(a, 24 * 3600)) return false
        return (a.current_price || 0) >= 50
      })
      .sort((a, b) => secsLeft(a) - secsLeft(b))
      .slice(0, 6)
  }, [auctions, nowTick])

  // Auto-refresh: when the visible items change OR every 60s, fire
  // /api/auctions/{id}/refresh for each visible auction so Eddie never sees
  // a $810 card showing $56 because the Browse API cron missed it.
  useEffect(() => {
    const visibleIds = [...items, ...nextBig].map(a => a.id).filter(Boolean)
    if (visibleIds.length === 0) return

    let cancelled = false
    const refreshOne = async (id) => {
      if (inFlight.current.has(id) || cancelled) return
      inFlight.current.add(id)
      try {
        const r = await fetch(`${API}/api/auctions/${id}/refresh`)
        if (!r.ok) return
        const d = await r.json()
        if (cancelled) return
        setFreshMap(prev => ({
          ...prev,
          [id]: {
            current_price: d.current_price,
            bid_count: d.bid_count,
            last_updated: new Date().toISOString().replace('Z', ''),
          },
        }))
      } catch {} finally {
        inFlight.current.delete(id)
      }
    }

    // Fire all visible items, staggered 200ms apart to avoid hammering
    visibleIds.forEach((id, i) => setTimeout(() => refreshOne(id), i * 200))

    // Also re-fire every 60s while mounted
    const interval = setInterval(() => {
      visibleIds.forEach((id, i) => setTimeout(() => refreshOne(id), i * 200))
    }, 60_000)

    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map(a => a.id).join(','), nextBig.map(a => a.id).join(',')])

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
            items.map((a, i) => <AuctionRow key={a.id || a.ebay_listing_id || i} a={a} nowTick={nowTick} freshOverride={freshMap[a.id]} />)
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
            nextBig.map((a, i) => <AuctionRow key={a.id || a.ebay_listing_id || i} a={a} nowTick={nowTick} freshOverride={freshMap[a.id]} />)
          )}
        </div>
      </div>
    </div>
  )
}
