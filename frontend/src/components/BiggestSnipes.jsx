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

  // Always pass: high-value, auto, rare print run, or strong verdict.
  if (price >= 100) return true
  if (/\bauto(graph)?\b|\bsigned\b/.test(title)) return true
  if (RARE_PRINT_RUN_RE.test(title)) return true
  if (a.verdict === 'STRONG_BUY') return true

  // Empty/null parallel = Base card not tagged. Don't show unless caught above.
  if (!parallel) return false

  // Non-base parallel with at least $5 or a bid — show it.
  if (price >= 5 || (a.bid_count || 0) > 0) return true

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
  // Prefer the title-derived driver — covers F1 Legends (card_id NULL) and
  // legacy mislabeled rows where the joined card disagrees with the title.
  const driverName = a.title_driver || a.driver_name || a.driver || a.card?.driver_name
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
            {driverName || '—'}
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
              className="text-[11px] font-black px-3 py-2 rounded bg-red-600 hover:bg-red-500 text-white transition-colors whitespace-nowrap"
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
    // 12h window — current eBay F1 market has very few auctions ending in <6h.
    // FRESH_MS removed: was 2h, filtered out most BIN listings and caused empty
    // sections. Phantom rows were purged; valid listings should always show.
    return (auctions || [])
      .filter(a => isBigSnipe(a, 12 * 3600))
      .sort((a, b) => {
        const vr = verdictRank(b.verdict) - verdictRank(a.verdict)
        if (vr !== 0) return vr
        const s = (b.snipe_score || 0) - (a.snipe_score || 0)
        if (s !== 0) return s
        return secsLeft(a) - secsLeft(b)
      })
      .slice(0, 6)
  }, [auctions, nowTick])

  // "Next Big Auctions" is meant to show what's coming — be more permissive
  // than `items` which gates on isBigSnipe heuristics. After today's phantom
  // cleanup the strict filter was returning zero rows. Now: ending 6h–48h,
  // price >= $30, no base/checker, not already in `items`.
  // "Next Big Auctions" — show what's coming up. Threshold dropped to $5
  // because current F1 auction market is dominated by chase / low-value cards;
  // $30+ filter rendered 1 result, $5+ shows ~15. Sort by price desc + ending
  // soonest so the high-value ones still float to the top.
  const nextBig = useMemo(() => {
    const inItems = new Set(items.map(a => a.id))
    // BiggestSnipes' items now uses 12h, so NextBig kicks in at 12h-72h
    return (auctions || [])
      .filter(a => {
        const secs = secsLeft(a)
        if (secs <= 12 * 3600 || secs > 72 * 3600) return false
        const parallel = a.card?.parallel || a.parallel || ''
        if (BORING_PARALLELS.has(parallel)) return false
        const price = a.current_price || 0
        if (price < 5) return false
        if (inItems.has(a.id)) return false
        return true
      })
      .sort((a, b) => {
        const p = (b.current_price || 0) - (a.current_price || 0)
        if (Math.abs(p) > 20) return p
        return secsLeft(a) - secsLeft(b)
      })
      .slice(0, 6)
  }, [auctions, items, nowTick])

  // Auto-refresh: only refresh items that are ALREADY stale (>15 min old) and
  // throttle to once per 10 min. Originally fired every 60s for all 12 visible
  // items = 720 calls/hour per active dashboard viewer = blew through eBay's
  // 5000/day quota and locked out the entire ingest pipeline. Lesson learned.
  useEffect(() => {
    const visibleIds = [...items, ...nextBig].map(a => a.id).filter(Boolean)
    if (visibleIds.length === 0) return

    const STALE_MS = 15 * 60 * 1000   // only refresh if >15min stale
    const TICK_MS = 10 * 60 * 1000    // re-check every 10min
    let cancelled = false

    const refreshOne = async (id, lastUpdatedRaw) => {
      if (inFlight.current.has(id) || cancelled) return
      // Skip if already fresh enough
      if (lastUpdatedRaw) {
        const t = new Date(String(lastUpdatedRaw).endsWith('Z') ? lastUpdatedRaw : lastUpdatedRaw + 'Z').getTime()
        if (!Number.isNaN(t) && (Date.now() - t) < STALE_MS) return
      }
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

    const fireRound = () => {
      [...items, ...nextBig].forEach((a, i) => {
        if (a.id) setTimeout(() => refreshOne(a.id, a.last_updated), i * 300)
      })
    }
    fireRound()
    const interval = setInterval(fireRound, TICK_MS)

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
            Ending ≤12h · non-base parallels + real money only
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
