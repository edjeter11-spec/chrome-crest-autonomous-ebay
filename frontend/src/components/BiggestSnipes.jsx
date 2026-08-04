import { useEffect, useMemo, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Target, Clock } from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'
import { upscaleEbayImage } from '../lib/imageUrl'
import { hasImage } from '../lib/hasImage'
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

// 'Refractor' removed — catches Portrait Refractors, colored refractors, etc.
// Use price ($10+) as primary signal for "interesting" rather than parallel name.
const BORING_PARALLELS = new Set([
  'Base', 'B&W Ray Wave', 'B&W Lazer', 'Floor It', 'Four & More', 'Checker Flag', 'Diamond 75th'
])
const RARE_PRINT_RUN_RE = /\/(5|10|15|20|25|50|75)\b/

// Re-exported from lib/printRun for backwards compatibility — extracted
// so Latest Sales (Dashboard.jsx) can render the same '#22/150' format.
function parsePrintRun(title) {
  if (!title) return ''
  const t = String(title)
  // Numbered: "22/150" or "#22/150" — common print-run notation. Reject
  // tiny totals (<5) to avoid catching dates / fractions.
  const numbered = t.match(/(?:^|\s|#)(\d{1,3})\/(\d{1,4})\b/)
  if (numbered) {
    const total = parseInt(numbered[2], 10)
    const num = parseInt(numbered[1], 10)
    // Suppress "00/00 Error" ghosts: zero on either side is never a real
    // serial number. (Bug 2 from user audit.)
    if (num <= 0 || total <= 0) return ''
    if (total >= 5 && num <= total) return `#${num}/${total}`
  }
  // Total-only: "/150", "/99", "/10". Same lower bound.
  const totalOnly = t.match(/(?:^|\s)\/(\d{1,4})\b/)
  if (totalOnly) {
    const total = parseInt(totalOnly[1], 10)
    if (total <= 0) return ''
    if (total >= 5 && total <= 9999) return `/${total}`
  }
  return ''
}

// Junk floor: a card whose comps say it usually sells for under $20 is
// never a "big" snipe no matter how discounted the current bid looks.
// Unknown-median cards pass — no comps means we can't call them cheap.
function cheapMedian(a) {
  const m = a.verdict_comp?.median_total
  return m != null && m < 20
}

function isBigSnipe(a, maxSecs) {
  // Drop anything backend has marked non-active (sold/ended/cancelled).
  // The end_time check below catches "ended naturally," but BIN-with-auction
  // listings sold via BIN, cancelled listings, and stale rows can still have
  // a future end_time while `status !== 'active'` — they were leaking into
  // Biggest Snipes as "sold Kimi card still shown" ghosts.
  if (a.status && a.status !== 'active') return false
  const secs = secsLeft(a)
  if (secs <= 0 || secs > maxSecs) return false
  const price = a.current_price || 0
  const parallel = a.card?.parallel || a.parallel || ''
  const title = (a.title || '').toLowerCase()

  if (BORING_PARALLELS.has(parallel)) return false
  if (/\bb\s*&\s*w\b|black\s*&\s*white|floor it|four & more/.test(title)) return false

  // Price is the most reliable signal — parallel metadata is missing 30-40%
  // of the time (scraper doesn't tag parallel for many listings). $10+ always
  // shows. Portrait Refractors, colored refractors etc. all pass this gate.
  if (price >= 10) return true
  if (/\bauto(graph)?\b|\bsigned\b/.test(title)) return true
  if (RARE_PRINT_RUN_RE.test(title)) return true
  if (a.verdict === 'STRONG_BUY' || a.verdict === 'GOOD_BUY') return true
  if ((a.bid_count || 0) > 1) return true

  // Low-price: only show if has a named non-base parallel
  if (parallel && price >= 5) return true

  return false
}

function SnipeImage({ src, driverName, teamColor }) {
  // 200px source for a 64x80 render — already 2.5× retina density. 500px was
  // 6× density, costing ~4-7× the bytes per thumbnail with no visible quality
  // win at this size. Bandwidth math: 16 thumbs × ~25KB instead of ~110KB.
  const upscaled = src ? upscaleEbayImage(src, 200) : ''
  const [stage, setStage] = useState('initial') // initial | retry | failed
  const [url, setUrl] = useState(upscaled)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setStage('initial')
    setUrl(upscaled)
    setLoaded(false)
  }, [upscaled])

  // Max-wait timer: if neither onLoad nor onError fires within 10s
  // (slow eBay CDN edge, blocked decode), fall through to placeholder.
  // Was 3s — too aggressive: lazy-loaded off-screen images never decoded
  // in time and got marked failed even though the URL worked. Eddie's
  // report: "Hadjar Refractor with no image, but click and the modal has
  // the picture". Bumped to 10s + dropped loading="lazy" since these are
  // small thumbnails in a short visible list (12-16 rows max).
  useEffect(() => {
    if (!upscaled || loaded || stage === 'failed') return
    const id = setTimeout(() => setStage('failed'), 10000)
    return () => clearTimeout(id)
  }, [upscaled, loaded, stage])

  if (!upscaled || stage === 'failed') {
    return (
      <div className="w-16 h-20 rounded shrink-0 overflow-hidden">
        <CardImagePlaceholder
          driverName={driverName}
          teamColor={teamColor}
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

function AuctionRow({ a, nowTick, freshOverride, onOpen }) {
  const sL = Math.max(0, Math.floor(((a.end_time ? parseUtc(a.end_time).getTime() : 0) - nowTick) / 1000))
  const h = Math.floor(sL / 3600)
  const m = Math.floor((sL % 3600) / 60)
  const sec = sL % 60
  const pad = n => String(n).padStart(2, '0')
  const timeStr = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
  const verdict = a.verdict
  const isGood = verdict === 'STRONG_BUY' || verdict === 'GOOD_BUY'
  // Median lives in verdict_comp.median_total (set server-side by
  // /api/auctions/with-verdicts). The legacy a.median_price field is never
  // populated — reading it returned undefined → 'usually sells for' never
  // rendered on snipe rows.
  const median = a.verdict_comp?.median_total ?? a.median_price ?? a.median_sold_price
  const nComps = a.verdict_comp?.n ?? null
  // Prefer freshly-fetched price/bids over the (possibly stale) prop.
  const livePrice = freshOverride?.current_price ?? a.current_price
  const liveBids = freshOverride?.bid_count ?? a.bid_count
  // Compare TOTAL cost (price + shipping) to median — sellers love $0.99 +
  // $4.99 ship listings that look like 95% off but are 40% off after shipping.
  const liveTotal = (livePrice || 0) + (a.shipping_cost || 0)
  const pctBelow = median && liveTotal ? Math.round((1 - liveTotal / median) * 100) : null
  // Trust chain for the display driver: title-derived first. The joined card
  // row is a scraper GUESS — legacy runs matched team/logo cards to driver
  // cards (an Alpine logo card rendered as "Max Verstappen · Auto"). Only
  // trust the join when the driver's surname actually appears in the title;
  // otherwise show a cleaned title fragment instead of a wrong driver.
  const cardDriver = a.card?.driver_name || ''
  const surname = cardDriver.split(' ').slice(-1)[0]?.toLowerCase() || ''
  const joinAgreesWithTitle = !!surname && (a.title || '').toLowerCase().includes(surname)
  const driverName = a.title_driver || a.driver_name || a.driver || (joinAgreesWithTitle ? cardDriver : null)
  const parallel = (joinAgreesWithTitle ? a.card?.parallel : null) || a.parallel || ''
  // Fallback label for driverless cards (team/logo/car cards): a trimmed
  // title beats an em-dash or a fabricated driver.
  const titleLabel = (a.title || '')
    .replace(/^new listing/i, '')
    .replace(/2025 topps chrome( formula 1| f1)?( sapphire)?( f1)?/i, '')
    .trim()
    .slice(0, 42)
  const parallelLabel = parallel && parallel !== 'Base' ? parallel : ''
  const printRun = parsePrintRun(a.title)
  // Clickable when the parent has wired an onOpen handler. Falls back to
  // a static row otherwise so callers without the modal still work.
  const clickable = typeof onOpen === 'function'
  const handleRowClick = clickable ? () => onOpen(a) : undefined
  const handleKeyDown = clickable
    ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(a) } }
    : undefined
  // Freshness label — green dot if updated <2 min ago, otherwise show "Xm ago"
  const lastUpdatedRaw = freshOverride?.last_updated || a.last_updated
  let freshness = null
  if (lastUpdatedRaw) {
    const t = new Date(String(lastUpdatedRaw).endsWith('Z') ? lastUpdatedRaw : lastUpdatedRaw + 'Z').getTime()
    if (!Number.isNaN(t)) {
      const ageMin = Math.max(0, Math.floor((Date.now() - t) / 60000))
      if (ageMin < 2) {
        freshness = <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live</span>
      } else if (ageMin < 60) {
        freshness = <span className="text-[10px] text-gray-500">Updated {ageMin}m ago</span>
      } else {
        const ageH = Math.floor(ageMin / 60)
        freshness = <span className="text-[10px] text-amber-500">Updated {ageH}h ago</span>
      }
    }
  }
  return (
    <div
      className={`px-4 py-3 transition-colors flex gap-3 md:rounded-xl md:border md:border-gray-800/60 md:bg-gray-900/40 ${clickable ? 'hover:bg-gray-800/60 cursor-pointer focus:bg-gray-800/60 focus:outline-none' : 'hover:bg-gray-800/40'}`}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open details for ${driverName || 'auction'}` : undefined}
    >
      <SnipeImage src={a.image_url} driverName={driverName} teamColor={a.card?.team_color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {clickable ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onOpen(a) }}
              className="text-xs font-bold text-white truncate hover:text-red-300 hover:underline transition-colors text-left max-w-full"
              title="View card + seller details"
            >
              {driverName || titleLabel || '—'}
              {parallelLabel && <span className="text-gray-300"> · {parallelLabel}</span>}
              {printRun && <span className="text-amber-300 ml-1">{printRun}</span>}
            </button>
          ) : (
            <div className="text-xs font-bold text-white truncate">
              {driverName || titleLabel || '—'}
              {parallelLabel && <span className="text-gray-300"> · {parallelLabel}</span>}
              {printRun && <span className="text-amber-300 ml-1">{printRun}</span>}
            </div>
          )}
          {isGood && (
            <Link
              to="/how-we-score"
              title="How we score auctions"
              onClick={e => e.stopPropagation()}
              className={`text-[10px] font-black px-1.5 py-0.5 rounded shrink-0 hover:opacity-80 transition-opacity ${
                verdict === 'STRONG_BUY' ? 'bg-emerald-600/40 text-emerald-200' : 'bg-emerald-600/25 text-emerald-300'
              }`}
            >
              {verdict === 'STRONG_BUY' ? 'STRONG BUY' : 'GOOD BUY'}
            </Link>
          )}
        </div>
        {pctBelow && pctBelow > 0 && (
          <div className="text-[10px] text-emerald-400 font-semibold mb-0.5">{pctBelow}% off usual sale</div>
        )}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xl font-black text-yellow-400">${Math.round(livePrice || 0).toLocaleString()}</span>
          {liveBids != null && liveBids > 0 && (
            <span className="text-[10px] text-gray-400">{liveBids} bid{liveBids === 1 ? '' : 's'}</span>
          )}
        </div>
        {median ? (
          <div className="text-[10px] text-gray-500 mb-1">
            Usually sells for{' '}
            <span className="text-gray-300 font-semibold">
              ${Math.round(median).toLocaleString()}
            </span>
            {nComps && (
              <span className="text-gray-600"> · {nComps} sale{nComps === 1 ? '' : 's'}</span>
            )}
          </div>
        ) : null}
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
              onClick={e => e.stopPropagation()}
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

export default function BiggestSnipes({ auctions = [], loading = false, onAuctionClick }) {
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
    // 2h window — Eddie's directive: a $1 starting bid on a $1000 card with
    // 3 days left isn't a snipe, it's just an early listing. Real snipes are
    // the urgency window where the price has settled and you can grab cheap.
    // Snipes are bid auctions, not BIN — STRONG_BUY verdicts on BIN listings
    // are valid info but they're not "snipes" (different concept).
    const strict = (auctions || [])
      .filter(a => {
        if (a.status && a.status !== 'active') return false
        if (!hasImage(a)) return false
        const bo = a.buying_options || []
        if (!bo.includes('AUCTION')) return false
        if (cheapMedian(a)) return false
        return isBigSnipe(a, 2 * 3600)
      })
      .sort((a, b) => {
        const vr = verdictRank(b.verdict) - verdictRank(a.verdict)
        if (vr !== 0) return vr
        const s = (b.snipe_score || 0) - (a.snipe_score || 0)
        if (s !== 0) return s
        return secsLeft(a) - secsLeft(b)
      })
      .slice(0, 12)

    if (strict.length > 0) return strict

    // Fallback: nothing qualifies inside 2h (typical — F1 auctions run
    // 5-7 days). Widen the window in steps instead of dropping the cap
    // entirely, so the header can always truthfully say "within Nh" no
    // matter how sparse the catalog is right now.
    const STEPS = [6, 12, 24, 48, 72]
    for (const hrs of STEPS) {
      const widened = (auctions || [])
        .filter(a => {
          if (a.status && a.status !== 'active') return false
          if (!hasImage(a)) return false
          const bo = a.buying_options || []
          if (!bo.includes('AUCTION')) return false
          if (cheapMedian(a)) return false
          return isBigSnipe(a, hrs * 3600)
        })
        .sort((a, b) => {
          const vr = verdictRank(b.verdict) - verdictRank(a.verdict)
          if (vr !== 0) return vr
          const s = (b.snipe_score || 0) - (a.snipe_score || 0)
          if (s !== 0) return s
          return secsLeft(a) - secsLeft(b)
        })
        .slice(0, 12)
      if (widened.length > 0) return { rows: widened, hrs }
    }

    // Nothing passed isBigSnipe's quality bar at any window — last resort,
    // just the soonest-ending auctions so the panel isn't empty. Still
    // capped at 72h so the header claim stays honest.
    return {
      rows: (auctions || [])
        .filter(a => {
          if (a.status && a.status !== 'active') return false
          if (!hasImage(a)) return false
          const bo = a.buying_options || []
          if (!bo.includes('AUCTION')) return false
          if (cheapMedian(a)) return false
          return secsLeft(a) > 0 && secsLeft(a) <= 72 * 3600
        })
        .sort((a, b) => secsLeft(a) - secsLeft(b))
        .slice(0, 6),
      hrs: 72,
    }
  }, [auctions, nowTick])

  // `items` is a bare array in the common strict-2h case, or {rows, hrs}
  // when the window had to widen. Normalized here so the header text
  // (itemHrs) is always derived from what's ACTUALLY shown, never
  // hardcoded — that mismatch was the original bug.
  const itemRows = Array.isArray(items) ? items : items.rows
  const itemHrs = Array.isArray(items) ? 2 : items.hrs

  // "Next Big Auctions" is meant to show what's coming — be more permissive
  // than `items` which gates on isBigSnipe heuristics. After today's phantom
  // cleanup the strict filter was returning zero rows. Now: ending 6h–48h,
  // price >= $30, no base/checker, not already in `items`.
  // "Next Big Auctions" — show what's coming up. Threshold dropped to $5
  // because current F1 auction market is dominated by chase / low-value cards;
  // $30+ filter rendered 1 result, $5+ shows ~15. Sort by price desc + ending
  // soonest so the high-value ones still float to the top.
  const nextBig = useMemo(() => {
    const inItems = new Set(itemRows.map(a => a.id))
    // Window starts right after wherever Biggest Snipes actually cut off
    // (itemHrs — 2h normally, wider when the strict window was empty) so
    // the two panels never both claim the same auctions. Extends to 48h
    // instead of a fixed 24h so there's still a "next" bucket even when
    // Biggest Snipes had to widen to 24h/48h itself.
    const startSecs = itemHrs * 3600
    const endSecs = Math.max(48, itemHrs * 2) * 3600
    return (auctions || [])
      .filter(a => {
        if (a.status && a.status !== 'active') return false  // skip sold/ended/cancelled ghosts
        if (!hasImage(a)) return false
        const bo = a.buying_options || []
        if (!bo.includes('AUCTION')) return false
        if (cheapMedian(a)) return false
        const secs = secsLeft(a)
        if (secs <= startSecs || secs > endSecs) return false
        if (inItems.has(a.id)) return false
        const parallel = a.card?.parallel || a.parallel || ''
        if (BORING_PARALLELS.has(parallel)) return false
        const price = a.current_price || 0
        if (price >= 10) return true
        if (/\bauto(graph)?\b|\bsigned\b/i.test(a.title || '')) return true
        if (/\/\d{1,3}\b/.test(a.title || '')) return true
        if ((a.bid_count || 0) > 0) return true
        if (parallel && price >= 5) return true
        return false
      })
      .sort((a, b) => {
        const p = (b.current_price || 0) - (a.current_price || 0)
        if (Math.abs(p) > 20) return p
        return secsLeft(a) - secsLeft(b)
      })
      .slice(0, 12)
  }, [auctions, itemRows, itemHrs, nowTick])

  // Auto-refresh: only refresh items that are ALREADY stale (>15 min old) and
  // throttle to once per 10 min. Originally fired every 60s for all 12 visible
  // items = 720 calls/hour per active dashboard viewer = blew through eBay's
  // 5000/day quota and locked out the entire ingest pipeline. Lesson learned.
  useEffect(() => {
    const visibleIds = [...itemRows, ...nextBig].map(a => a.id).filter(Boolean)
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
      [...itemRows, ...nextBig].forEach((a, i) => {
        if (a.id) setTimeout(() => refreshOne(a.id, a.last_updated), i * 300)
      })
    }
    fireRound()
    const interval = setInterval(fireRound, TICK_MS)

    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemRows.map(a => a.id).join(','), nextBig.map(a => a.id).join(',')])

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Target size={14} className="text-red-400" />
            Biggest Snipes
          </h2>
          <div className="text-[10px] text-gray-500 mt-1 font-medium">
            {itemHrs <= 2
              ? 'Highest-value auctions ending within 2 hours — the bid window is now'
              : `Nothing ending within 2h right now — showing the highest-value auctions ending within ${itemHrs}h`}
          </div>
        </div>
        <div className="flex-1 max-h-[560px] md:max-h-[640px] overflow-y-auto divide-y divide-gray-800/50 md:divide-y-0 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-2.5 md:p-3 md:content-start">
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
          ) : itemRows.length === 0 ? (
            <div className="py-12 text-center text-gray-600 text-sm px-4 md:col-span-full">
              No qualifying auctions ending in the next 72 hours. High-value listings appear here as their bid window opens.
            </div>
          ) : (
            itemRows.map((a, i) => <AuctionRow key={a.id || a.ebay_listing_id || i} a={a} nowTick={nowTick} freshOverride={freshMap[a.id]} onOpen={onAuctionClick} />)
          )}
        </div>
      </div>

      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Clock size={14} className="text-amber-400" />
            Next Big Auctions
          </h2>
          <div className="text-[10px] text-gray-500 mt-1 font-medium">
            Ending in {itemHrs}–{Math.max(48, itemHrs * 2)} hours — set an alert to catch the close
          </div>
        </div>
        <div className="flex-1 max-h-[560px] md:max-h-[640px] overflow-y-auto divide-y divide-gray-800/50 md:divide-y-0 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-2.5 md:p-3 md:content-start">
          {loading ? null : nextBig.length === 0 ? (
            <div className="py-8 text-center text-gray-600 text-sm px-4 md:col-span-full">
              Nothing big on deck in the next {Math.max(48, itemHrs * 2)}h.
            </div>
          ) : (
            nextBig.map((a, i) => <AuctionRow key={a.id || a.ebay_listing_id || i} a={a} nowTick={nowTick} freshOverride={freshMap[a.id]} onOpen={onAuctionClick} />)
          )}
        </div>
      </div>
    </div>
  )
}
