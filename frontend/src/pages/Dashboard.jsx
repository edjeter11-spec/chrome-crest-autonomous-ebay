import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Gavel, Flame, Database, DollarSign, Zap, Activity,
  RefreshCw, Clock, TrendingUp, Users, Layers, ExternalLink,
  AlertTriangle, ChevronRight, ChevronDown, Shield, BellRing, Target
} from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import RaceCalendarStrip from '../components/RaceCalendarStrip'
import { SkeletonBox, SkeletonCard, SkeletonCardRow, SkeletonStat } from '../components/Skeleton'
// BiggestSnipes hides behind the "Show more analytics" toggle and
// WelcomeModal only shows once per user — defer both off the critical path.
// CardDetailModal only renders when a card is clicked (detailAuction != null).
// EndingStripEmpty only renders when the ending strip has 0 items.
const BiggestSnipes = lazy(() => import('../components/BiggestSnipes'))
const WelcomeModal = lazy(() => import('../components/WelcomeModal'))
const CardDetailModal = lazy(() => import('../components/CardDetailModal'))
const EndingStripEmpty = lazy(() => import('../components/EndingStripEmpty'))
import { swrFetch } from '../lib/cache'
import { useVisibilityInterval } from '../lib/hooks'
import { applySeasonFilter } from '../lib/season'
import { ebayAffiliateUrl, trackClick } from '../lib/ebay'
import { useAuth } from '../lib/auth'
import { teamColor as resolveTeamColor } from '../lib/teamColors'
import { teamOf } from '../lib/drivers'
import { usePageTitle } from '../lib/pageTitle'

function WelcomeBanner() {
  const { user } = useAuth()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!user) return
    try {
      const lastId = sessionStorage.getItem('cc_welcomed_user')
      if (lastId !== user.id) {
        setShow(true)
        sessionStorage.setItem('cc_welcomed_user', user.id)
        const t = setTimeout(() => setShow(false), 6000)
        return () => clearTimeout(t)
      }
    } catch {}
  }, [user])
  if (!show || !user) return null
  const meta = user.user_metadata || {}
  const first = (meta.full_name || meta.name || meta.given_name || '').split(' ')[0]
    || (user.email || '').split('@')[0].split(/[._-]/)[0]
  const display = first ? first.charAt(0).toUpperCase() + first.slice(1) : 'back'
  return (
    <div className="bg-gradient-to-r from-green-900/40 to-emerald-900/30 border border-green-700/40 rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className="text-2xl">👋</div>
      <div>
        <div className="text-white font-black text-lg">Welcome back, {display}</div>
        <div className="text-[11px] text-green-300/80">Here's what moved since you were last here</div>
      </div>
    </div>
  )
}

const API = import.meta.env.VITE_API_URL || ''

const isAuction = a => (a.buying_options || []).includes('AUCTION')

// Backend stores end_time as naive UTC ("2026-04-19T21:04:00") with no 'Z'.
// JS Date parses naive ISO as LOCAL time → off by user's tz offset.
// Append 'Z' so it's parsed as UTC (matches what the backend means).
function parseUtc(s) {
  if (!s) return null
  const trimmed = String(s).replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, (m) => m && /Z|[+-]/.test(m) ? m : (m || ''))
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)
  return new Date(hasTz ? trimmed : trimmed + 'Z')
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

// Notable-sales filter: only show cards >= $25, exclude plain Base + B&W parallels.
// Keeps the dashboard feed exciting instead of clogged with $2 commons.
const BORING_PARALLELS = new Set(['Base', 'B&W Ray Wave', 'B&W Lazer', 'Floor It', 'Four & More'])
const NOTABLE_MIN_PRICE = 25
function isNotable(s) {
  const price = s?.sale_price ?? s?.total_cost ?? 0
  if (!price || price < NOTABLE_MIN_PRICE) return false
  const parallel = s?.parallel || ''
  if (BORING_PARALLELS.has(parallel)) return false
  const t = (s?.title || '').toLowerCase()
  if (/\bb\s*&\s*w\b|black\s*&\s*white|floor it|four & more/.test(t)) return false
  return true
}

function relTime(iso) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// eBay only provides the sold DATE (no time-of-day), so all sales cluster at
// midnight UTC. Showing "23 hours ago" for a midnight timestamp is misleading.
// Prefer the sale date formatted short ("Apr 17"); optionally tag "NEW" when
// scraped within the last 6 hours.
function saleTimeLabel(sale) {
  const date = sale?.sale_date
  if (!date) return '—'
  const d = new Date(date)
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const scraped = sale?.scraped_at ? new Date(sale.scraped_at).getTime() : null
  const fresh = scraped && (Date.now() - scraped) < 6 * 3600 * 1000
  return fresh ? `${label} · new` : label
}

export default function Dashboard() {
  usePageTitle('Home')
  const navigate = useNavigate()

  const [sales, setSales] = useState([])
  const [salesLoading, setSalesLoading] = useState(true)

  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [auctions, setAuctions] = useState([])
  const [auctionsLoading, setAuctionsLoading] = useState(true)
  // AUCTION-only feed for the Ending Soonest strip and snipe-style sections.
  // The mixed `auctions` state is dominated by BIN listings (Hobby Boxes
  // ending in 11 days, 11-month-future BIN placeholders) which pushes real
  // sub-1-hour auctions past offset 500. Fetching ?buying=auction in parallel
  // gives the strip a clean live-auction window without affecting the
  // BiggestSnipes "Next Big" 2h-24h pool that needs both AUCTION+BIN.
  const [liveAuctions, setLiveAuctions] = useState([])

  const [snipes, setSnipes] = useState([])
  const [snipesLoading, setSnipesLoading] = useState(true)

  // Card detail modal — opens when a user clicks an AuctionCard body.
  const [detailAuction, setDetailAuction] = useState(null)

  const [ebayLimited, setEbayLimited] = useState(false)

  const [ticker, setTicker] = useState([])
  const [bigWins, setBigWins] = useState([])
  const [bigWinsLoading, setBigWinsLoading] = useState(true)
  const [alertsData, setAlertsData] = useState([])
  const [recent24hCount, setRecent24hCount] = useState(null)

  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // TEMP: surface any runtime errors so mobile blank-render has a trail in console
  useEffect(() => {
    const handler = (e) => { console.error('[Dashboard error]', e.error || e.message) }
    const rejHandler = (e) => { console.error('[Dashboard unhandled rejection]', e.reason) }
    window.addEventListener('error', handler)
    window.addEventListener('unhandledrejection', rejHandler)
    return () => {
      window.removeEventListener('error', handler)
      window.removeEventListener('unhandledrejection', rejHandler)
    }
  }, [])
  const [lastSync, setLastSync] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // Progressive-disclosure: keep the dashboard tight by default; power-user
  // analytics (latest sales, big wins, ending strip, hot snipes, scraper
  // telemetry) live behind a single "Show more analytics" toggle. Persisted
  // in localStorage so the choice sticks across visits.
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try { return window.localStorage.getItem('cc_dashboard_advanced_open') === '1' } catch { return false }
  })
  useEffect(() => {
    try { window.localStorage.setItem('cc_dashboard_advanced_open', advancedOpen ? '1' : '0') } catch {}
  }, [advancedOpen])

  // "Welcome back" delta strip — computed once on first mount
  const [welcomeDelta, setWelcomeDelta] = useState(null)
  const [scraperHealth, setScraperHealth] = useState(null)

  useEffect(() => {
    let lastVisit = null
    try { lastVisit = window.localStorage.getItem('cc_last_visit') } catch {}
    const now = new Date().toISOString()
    try { window.localStorage.setItem('cc_last_visit', now) } catch {}
    if (!lastVisit) return  // first visit — skip the strip

    // Defer 1.5s — these are non-critical "nice to have" fetches that were
    // competing with the main auctions list on first paint and slowing the
    // initial render. The user sees the dashboard immediately, the welcome-
    // back strip + scraper-health appear shortly after.
    const since = lastVisit
    const deferTimer = setTimeout(() => {
      Promise.all([
        fetch(`${API}/api/sales?since=${encodeURIComponent(since)}&limit=500`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API}/api/alerts`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API}/api/watchlist/changes?since=${encodeURIComponent(since)}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      ]).then(([salesRes, alertsRes, watchRes]) => {
        const sinceMs = new Date(since).getTime()
        const salesAll = salesRes?.sales || []
        const newSales = salesAll.filter(s => s.scraped_at && new Date(s.scraped_at).getTime() >= sinceMs).length
        const alertsAll = alertsRes?.alerts || alertsRes || []
        const newAlerts = alertsAll.filter(a => a.created_at && new Date(a.created_at).getTime() >= sinceMs).length
        const movedWatch = watchRes?.items?.length || 0
        if (newSales + newAlerts + movedWatch > 0) {
          setWelcomeDelta({ since, newSales, newAlerts, movedWatch })
        }
      })

      fetch(`${API}/api/admin/scraper-health`)
        .then(r => r.ok ? r.json() : null)
        .then(d => setScraperHealth(d))
        .catch(() => {})
    }, 1500)
    return () => clearTimeout(deferTimer)
  }, [])

  const loadAll = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)

    // Tiny helper: coerce any API shape into an array, never throw.
    const asArray = (d, key) => {
      try {
        if (Array.isArray(d)) return d
        if (d && key && Array.isArray(d[key])) return d[key]
        if (d && Array.isArray(d?.sales)) return d.sales
        if (d && Array.isArray(d?.auctions)) return d.auctions
        if (d && Array.isArray(d?.targets)) return d.targets
        if (d && Array.isArray(d?.alerts)) return d.alerts
      } catch {}
      return []
    }

    // Single 500-row sales fetch — derives sales feed, ticker, big wins, AND
    // 7d count from one query. Was previously 3 separate /api/sales calls
    // (500 + 150 + 500 + 10) all hitting the same heavy DB query on every
    // dashboard mount; consolidated to cut server load + first-paint latency.
    swrFetch(
      `${API}/api/sales?limit=500&year=2025`,
      d => {
        try {
          const all = applySeasonFilter(asArray(d, 'sales')) || []
          const notable = (all || []).filter(isNotable)
          // Sales feed (15 most recent / notable)
          const feed = notable.length >= 5 ? notable : all
          setSales((feed || []).slice(0, 15))
          // Scrolling ticker (10 notable)
          setTicker((notable.length >= 3 ? notable : all).slice(0, 10))
          // Big wins (>= $100) — cap to max 2 per driver so one hot driver
          // doesn't monopolize the strip (was: 10 straight Kimi rows).
          const winsByDriver = new Map()
          const wins = []
          for (const s of all) {
            if ((s?.sale_price ?? 0) < 100) continue
            const drv = s?.driver_name || s?.driver || '—'
            const seen = winsByDriver.get(drv) || 0
            if (seen >= 2) continue
            winsByDriver.set(drv, seen + 1)
            wins.push(s)
            if (wins.length >= 10) break
          }
          setBigWins(wins)
          // Last-7-day count (eBay sale_date is midnight-UTC so 24h is unreliable)
          const cutoff = Date.now() - 7 * 24 * 3600 * 1000
          setRecent24hCount(all.filter(s => s?.sale_date && new Date(s.sale_date).getTime() >= cutoff).length)
        } catch (err) {
          console.error('[Dashboard] consolidated sales handler', err)
          setSales([]); setTicker([]); setBigWins([]); setRecent24hCount(0)
        } finally {
          setSalesLoading(false)
          setBigWinsLoading(false)
        }
      }
    )

    swrFetch(
      `${API}/api/sales/stats`,
      d => {
        try { setStats((d && typeof d === 'object') ? d : {}) }
        catch (err) { console.error('[Dashboard] stats handler', err); setStats({}) }
        finally { setStatsLoading(false) }
      }
    )

    // Progressive fetch + ALL active listings (auction + BIN). The dashboard
    // was filtering buying=auction, leaving only ~11 rows after today's
    // phantom cleanup — 'Next Big Auctions' had no data in its 6-48h window.
    // Including BIN gives BiggestSnipes a much richer pool to filter from.
    swrFetch(
      `${API}/api/auctions/with-verdicts?limit=200`,
      d => {
        try { setAuctions(applySeasonFilter(asArray(d, 'auctions')) || []) }
        catch (err) { console.error('[Dashboard] auctions handler', err); setAuctions([]) }
        finally { setAuctionsLoading(false) }
        setTimeout(() => {
          swrFetch(
            `${API}/api/auctions/with-verdicts?limit=500`,
            d2 => {
              try { setAuctions(applySeasonFilter(asArray(d2, 'auctions')) || []) }
              catch {}
            }
          )
        }, 1500)
      }
    )

    // AUCTION-only feed — drives Ending Soonest strip. Without this, BIN
    // listings dominate the first 500 rows and real sub-1-hour auctions are
    // never delivered to the dashboard.
    swrFetch(
      `${API}/api/auctions/with-verdicts?buying=auction&limit=500`,
      d => {
        try { setLiveAuctions(applySeasonFilter(asArray(d, 'auctions')) || []) }
        catch (err) { console.error('[Dashboard] liveAuctions handler', err); setLiveAuctions([]) }
      }
    )

    // Try fresh snipes endpoint first (real-time eBay lookups); fall back to cached targets
    Promise.race([
      fetch(`${API}/api/sniper/fresh-snipes/6`).then(r => r.ok ? r.json() : null).catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(null), 5000))
    ]).then(freshRes => {
      try {
        if (freshRes?.auctions && Array.isArray(freshRes.auctions)) {
          setSnipes(applySeasonFilter(freshRes.auctions) || [])
          setSnipesLoading(false)
          return
        }
      } catch (err) {
        console.error('[Dashboard] fresh snipes handler', err)
      }
      // Fallback to cached targets
      swrFetch(
        `${API}/api/auctions/snipe/targets`,
        d => {
          try { setSnipes(applySeasonFilter(asArray(d, 'targets')) || []) }
          catch (err) { console.error('[Dashboard] snipes handler', err); setSnipes([]) }
          finally { setSnipesLoading(false) }
        }
      )
    }).catch(err => {
      console.error('[Dashboard] snipes race', err)
      setSnipesLoading(false)
    })

    // Sales-derived state (ticker, bigWins, recent24hCount) is set inside
    // the consolidated /api/sales?limit=500 handler above. No separate fetches.

    swrFetch(
      `${API}/api/alerts`,
      d => {
        try { setAlertsData(asArray(d, 'alerts')) }
        catch (err) { console.error('[Dashboard] alerts handler', err); setAlertsData([]) }
      }
    )

    setEbayLimited(false)
    setRefreshing(false)
    const now = new Date()
    setLastSync(now)
    // Share with StatusFooter (and any other listener) — simple cross-component
    // signal without adding a context provider for this single value.
    try { localStorage.setItem('lastSyncAt', String(now.getTime())) } catch {}
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useVisibilityInterval(loadAll, 60_000)

  // --- KPI derivations ---
  const liveAuctionsCount = useMemo(
    () => (Array.isArray(auctions) ? auctions : []).filter(a => a && isAuction(a) && secsLeft(a) > 0).length,
    [auctions]
  )
  const strongBuyCount = useMemo(
    () => (Array.isArray(auctions) ? auctions : []).filter(a => a && isAuction(a) && secsLeft(a) > 0 && (a.verdict === 'STRONG_BUY' || a.verdict === 'GOOD_BUY')).length,
    [auctions]
  )
  // "Ending Soon" = within 1 hour (label says <1h, counter must match).
  // Loose isAuction check: accept any row with a future end_time, regardless of
  // whether buying_options is populated (it isn't always).
  const isLiveAuctionRow = (a) => {
    if (!a) return false
    const s = secsLeft(a)
    if (s <= 0) return false
    const bo = a.buying_options || []
    return bo.includes('AUCTION') || (a.bid_count || 0) > 0 || !bo.length
  }
  const endingSoonCount = useMemo(
    () => (Array.isArray(auctions) ? auctions : []).filter(a => isLiveAuctionRow(a) && secsLeft(a) < 3600).length,
    [auctions]
  )
  const endingSoonList = useMemo(
    () => (Array.isArray(auctions) ? auctions : []).filter(isLiveAuctionRow).sort((a,b) => secsLeft(a) - secsLeft(b)).slice(0, 5),
    [auctions]
  )
  const priceTrending = useMemo(() => {
    const list = Array.isArray(sales) ? sales : []
    if (!list.length) return null
    const now = Date.now()

    // This week: last 7 days
    const thisWeekStart = now - 7 * 86400 * 1000
    const thisWeekSales = list.filter(
      s => s?.sale_date && new Date(s.sale_date).getTime() >= thisWeekStart && s?.sale_price
    ).map(s => s.sale_price).sort((a, b) => a - b)

    // Last week: 14-7 days ago
    const lastWeekStart = now - 14 * 86400 * 1000
    const lastWeekEnd = thisWeekStart
    const lastWeekSales = list.filter(
      s => s?.sale_date && new Date(s.sale_date).getTime() >= lastWeekStart && new Date(s.sale_date).getTime() < lastWeekEnd && s?.sale_price
    ).map(s => s.sale_price).sort((a, b) => a - b)

    if (!thisWeekSales.length || !lastWeekSales.length) return null

    // Compute medians
    const median = (arr) => arr.length % 2 === 0
      ? (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2
      : arr[Math.floor(arr.length / 2)]

    const thisWeekMedian = median(thisWeekSales)
    const lastWeekMedian = median(lastWeekSales)

    if (!lastWeekMedian) return null
    const pctChange = ((thisWeekMedian - lastWeekMedian) / lastWeekMedian) * 100
    if (!Number.isFinite(pctChange)) return null

    // Consider "flat" within ±2% threshold
    if (Math.abs(pctChange) <= 2) {
      return { trend: 'Stable', pctChange: 0, arrow: '→' }
    }

    return {
      trend: pctChange > 0 ? 'Up' : 'Down',
      pctChange: Math.abs(pctChange),
      arrow: pctChange > 0 ? '↑' : '↓'
    }
  }, [sales])
  const topSnipeScore = useMemo(() => {
    const list = Array.isArray(snipes) ? snipes : []
    if (!list.length) return null
    const scores = list.map(s => s?.snipe_score || 0)
    if (!scores.length) return null
    const m = Math.max(...scores)
    return Number.isFinite(m) ? m : null
  }, [snipes])

  // --- Derived lists ---
  // Explicit boring set — ONLY exact matches we're 100% sure are junk.
  // Do NOT include 'Refractor' — that kills Portrait Refractor, colored
  // refractors, etc. Use price as primary signal instead.
  const BORING_STRIP = new Set(['Base', 'B&W Ray Wave', 'B&W Lazer', 'Floor It', 'Four & More'])
  const endingStrip = useMemo(() => {
    return (Array.isArray(liveAuctions) ? liveAuctions : [])
      .filter(a => {
        const s = secsLeft(a)
        if (!a || s <= 0 || s > 86400) return false // 24h window
        if (!isLiveAuctionRow(a)) return false
        const parallel = a.card?.parallel || a.parallel || ''
        if (BORING_STRIP.has(parallel)) return false
        const price = a.current_price || 0
        // Price is the most reliable signal — $10+ always show
        if (price >= 10) return true
        // Low-price: only show if named parallel, auto, rare print, or bids
        if (parallel && !BORING_STRIP.has(parallel)) return true
        if (/\bauto(graph)?\b|\bsigned\b/i.test(a.title || '')) return true
        if (/\/\d{1,3}\b/.test(a.title || '')) return true
        if ((a.bid_count || 0) > 0) return true
        return false
      })
      .sort((a, b) => secsLeft(a) - secsLeft(b))
      .slice(0, 16)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAuctions])

  const hotSnipes = useMemo(() => (Array.isArray(snipes) ? snipes : []).slice(0, 12), [snipes])

  // Deprecated: BiggestSnipes does its own comprehensive filtering.
  // Just check if there are ANY auctions to avoid showing empty state prematurely.
  const biggestSnipes = useMemo(() => {
    return Array.isArray(auctions) && auctions.length > 0 ? [1] : []
  }, [auctions])

  // New enthusiast-row derivations.
  // Use the loose isLiveAuctionRow check: backend filters to rows with
  // buying_options LIKE '%AUCTION%', but some rows still land with an empty
  // buying_options array (cache/legacy), and the strict isAuction check was
  // dropping them — making the count look artificially low (e.g. "only 5").
  const endingUnderHour = useMemo(
    () => (Array.isArray(auctions) ? auctions : []).filter(a => { const s = secsLeft(a); return isLiveAuctionRow(a) && s > 0 && s < 3600 }).length,
    [auctions]
  )
  // Active snipes = count of tracked snipe targets. The prior filter
  // (alertsData with urgency=critical|high && !triggered) was over-restrictive
  // and returned 0 even when real snipes existed. Source of truth is the
  // /api/sniper/fresh-snipes endpoint backing `snipes`.
  const activeSnipesCount = useMemo(
    () => (Array.isArray(snipes) ? snipes.length : 0),
    [snipes]
  )
  const topDriverChips = useMemo(
    () => {
      const td = stats?.top_drivers
      return (Array.isArray(td) ? td : []).slice(0, 8)
    },
    [stats]
  )
  const POPULAR_PARALLELS = [
    'Autograph', 'Refractor', 'Neon Nations', 'SuperFractor', 'Helix', 'Vegas at Night',
  ]

  return (
    <div className="space-y-6 max-w-[1800px]">
      <Suspense fallback={null}><WelcomeModal /></Suspense>
      {detailAuction && (
        <Suspense fallback={null}>
          <CardDetailModal auction={detailAuction} onClose={() => setDetailAuction(null)} />
        </Suspense>
      )}

      {/* WelcomeBanner: desktop-only — too noisy on mobile */}
      <div className="hidden md:block">
        <SectionBoundary><WelcomeBanner /></SectionBoundary>
      </div>

      {/* Deal of the Day hero — above KPI row */}
      <SectionBoundary><DealOfTheDay auctions={auctions} /></SectionBoundary>

      {/* Unified stats + quick-filter zone — KPI tiles + jumps grouped together
          so mobile users see a single cohesive block instead of scattered tiles. */}
      <SectionBoundary>
        <div className="space-y-3">
          {/* KPI strip — 2 cols phone (3 rows), 3 cols small tablet, 6 cols desktop */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 md:gap-3">
            <KpiTile
              icon={Gavel}
              label={<><span className="md:hidden">Live</span><span className="hidden md:inline">Live Auctions</span></>}
              value={auctionsLoading ? null : Number(liveAuctionsCount || 0).toLocaleString()}
              sub={auctionsLoading ? 'Total active' : `🔥 ${strongBuyCount} strong buys`}
              color="blue"
              onClick={() => navigate('/auctions?buying=auction')}
            />
            <KpiTile
              icon={Clock}
              label={<><span className="md:hidden">⏰ &lt;1h</span><span className="hidden md:inline">Ending ≤ 1h</span></>}
              value={auctionsLoading ? null : Number(endingUnderHour || 0).toLocaleString()}
              sub={endingUnderHour > 0 ? 'Hurry' : 'None imminent'}
              color={endingUnderHour > 0 ? 'red' : 'gray'}
              onClick={() => navigate('/auctions?buying=auction&sort=ending')}
            />
            <KpiTile
              icon={BellRing}
              label={<><span className="md:hidden">Snipes</span><span className="hidden md:inline">Active Snipes</span></>}
              value={snipesLoading ? null : Number(activeSnipesCount || 0).toLocaleString()}
              sub={activeSnipesCount > 0 ? 'Tracking now' : 'None tracked'}
              color="yellow"
              onClick={() => navigate('/alerts')}
            />
            <KpiTile
              icon={Flame}
              label={<><span className="md:hidden">7d</span><span className="hidden md:inline">7d Sales</span></>}
              value={recent24hCount == null ? null : Number(recent24hCount || 0).toLocaleString()}
              sub="Fresh recent sales this week"
              color="emerald"
              onClick={() => navigate('/sales')}
            />
            <KpiTile
              icon={Database}
              label={<><span className="md:hidden">Sales</span><span className="hidden md:inline">Total Sales</span></>}
              value={statsLoading ? null : (Number(stats?.total_count ?? 0).toLocaleString())}
              sub={stats?.week_count != null ? `+${Number(stats.week_count).toLocaleString()} this week` : ' '}
              color="cyan"
            />
            <KpiTile
              icon={Zap}
              label="Top Snipe"
              value={snipesLoading ? null : (topSnipeScore != null ? Math.round(topSnipeScore) : '—')}
              sub={(Array.isArray(snipes) && snipes.length) ? `${snipes.length} tracked` : 'None flagged'}
              color="red"
            />
          </div>

          {/* Quick Jumps — driver chips + parallel chips live with the KPIs */}
          {Array.isArray(topDriverChips) && topDriverChips.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users size={12} className="text-violet-400" />
                <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400 light:text-gray-700">Jump to Driver</h3>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {topDriverChips.filter(Boolean).map((d, i) => {
                  const driverName = d?.driver || ''
                  // Resolve team via card-style lookup so we can paint the ring.
                  const team = d?.team || teamOf({ card: { driver_name: driverName }, title: driverName })
                  const tColor = d?.team_color || resolveTeamColor(team)
                  return (
                    <button
                      key={i}
                      onClick={() => navigate(`/drivers?name=${encodeURIComponent(driverName)}`)}
                      className="shrink-0 flex flex-col items-center gap-1.5 w-20"
                      title={`${d?.count ?? 0} sold · $${Math.round(Number(d?.total_value) || 0).toLocaleString()}${team ? ` · ${team}` : ''}`}
                    >
                      <div
                        className="w-16 h-16 rounded-full overflow-hidden bg-gray-800 border-2 transition-colors"
                        style={tColor
                          ? { borderColor: tColor, boxShadow: `0 0 0 1px ${tColor}33` }
                          : { borderColor: 'rgba(75,85,99,0.5)' }}
                      >
                        <img
                          src={`${API}/api/drivers/photo?name=${encodeURIComponent(driverName)}`}
                          alt={driverName}
                          className="w-full h-full object-cover"
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      </div>
                      <span
                        className="text-[10px] text-center leading-tight font-semibold truncate w-full light:text-gray-700"
                        style={tColor ? { color: tColor } : { color: '#d1d5db' }}
                      >
                        {driverName.split(' ').slice(-1)[0]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Layers size={12} className="text-cyan-400" />
              <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400 light:text-gray-700">Jump to Parallel</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {POPULAR_PARALLELS.map(p => (
                <button
                  key={p}
                  onClick={() => navigate(`/sales?parallel=${encodeURIComponent(p)}`)}
                  className="px-3 py-1.5 rounded-full bg-gray-800/70 hover:bg-cyan-900/40 border border-gray-700/50 hover:border-cyan-600/50 text-xs font-bold text-gray-300 hover:text-cyan-300 transition-colors light:bg-gray-200 light:text-gray-700 light:border-gray-400 light:hover:bg-cyan-100"
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => navigate('/graded?grade=10')}
                className="px-3 py-1.5 rounded-full bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/50 hover:border-amber-500/70 text-xs font-black text-amber-300 transition-colors flex items-center gap-1"
              >
                <Shield size={10} /> PSA 10 sales
              </button>
            </div>
          </div>
        </div>
      </SectionBoundary>

      {/* Race calendar strip */}
      <SectionBoundary><RaceCalendarStrip /></SectionBoundary>

      {/* Header — sticky on mobile so the refresh button is always reachable */}
      <div className="sticky top-0 z-30 -mx-3 px-3 py-2 md:py-0 md:mx-0 md:px-0 md:static bg-gray-950/85 backdrop-blur-md md:bg-transparent md:backdrop-blur-none border-b border-gray-800/60 md:border-0 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-1 h-7 bg-red-600 rounded-full shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight leading-none">Home</h1>
            <p className="hidden sm:block text-gray-500 text-xs mt-1.5 font-medium light:text-gray-600 truncate">F1 Card Vault · Live auctions, fresh sales, hot snipes</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {lastSync && (
            <span className="text-xs text-gray-600 font-mono hidden sm:inline light:text-gray-700">
              {lastSync.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => loadAll(true)}
            disabled={refreshing}
            aria-label="Refresh dashboard"
            className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50 light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700 flex items-center justify-center"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* "Show more analytics" disclosure — secondary feeds (latest sales, big
          wins, biggest snipes, ending strip, hot snipes, scraper telemetry)
          live behind a single toggle so the default landing is uncluttered. */}
      <button
        type="button"
        onClick={() => setAdvancedOpen(v => !v)}
        aria-expanded={advancedOpen}
        className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-gray-300 hover:bg-gray-800 w-full text-left flex items-center justify-between"
      >
        <span className="font-bold text-sm">
          {advancedOpen ? 'Hide analytics' : 'Show more analytics'}
        </span>
        <ChevronDown
          size={16}
          className={`transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {advancedOpen && (
      <>
      {/* Biggest Snipes + Next Big Auctions */}
      <SectionBoundary>
        <Suspense fallback={<div className="h-32" />}>
          <BiggestSnipes auctions={auctions} loading={auctionsLoading} />
        </Suspense>
      </SectionBoundary>

      {/* Welcome-back delta strip */}
      {welcomeDelta && (
        <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/30 border border-indigo-600/40 rounded-2xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-black uppercase tracking-wider text-indigo-300">Welcome back</span>
          <div className="flex items-center gap-3 text-xs text-gray-300 flex-wrap">
            {welcomeDelta.newSales > 0 && (
              <span><span className="font-black text-white">{welcomeDelta.newSales}</span> new sales</span>
            )}
            {welcomeDelta.newAlerts > 0 && (
              <span><span className="font-black text-red-300">{welcomeDelta.newAlerts}</span> new alerts</span>
            )}
            {welcomeDelta.movedWatch > 0 && (
              <span><span className="font-black text-yellow-300">{welcomeDelta.movedWatch}</span> watched moved</span>
            )}
            <span className="text-gray-500">since {new Date(welcomeDelta.since).toLocaleString()}</span>
          </div>
          <button
            onClick={() => setWelcomeDelta(null)}
            className="ml-auto text-xs text-gray-500 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Scraper health strip */}
      {scraperHealth && Array.isArray(scraperHealth.feeds) && scraperHealth.feeds.length > 0 && (
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl px-4 py-2 flex items-center gap-3 flex-wrap text-xs">
          <span className="font-black uppercase tracking-wider text-gray-400">Data feeds</span>
          {scraperHealth.feeds.map((f, i) => {
            const status = f.status || (f.blocked ? 'red' : (f.stale ? 'yellow' : 'green'))
            const dot = status === 'red' ? 'bg-red-500' : status === 'yellow' ? 'bg-yellow-400' : 'bg-emerald-500'
            const label = f.last_ok || f.last_run || f.last_seen
            return (
              <span key={i} className="flex items-center gap-1.5 text-gray-300">
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                <span className="font-semibold">{f.name || f.source}</span>
                <span className="text-gray-500">{status === 'red' ? 'blocked' : label ? relTime(label) : ''}</span>
              </span>
            )
          })}
          {scraperHealth.feeds.some(f => (f.status || (f.blocked ? 'red' : '')) === 'red') && (
            <button onClick={() => navigate('/alerts')} className="ml-auto text-red-300 hover:text-red-200 font-semibold">
              View alerts →
            </button>
          )}
        </div>
      )}

      {/* NEW: Live ticker strip */}
      {!salesLoading && ticker.length === 0 && (
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl">
          <EmptyRow text="No recent sales in feed yet" />
        </div>
      )}
      {Array.isArray(ticker) && ticker.length > 0 && (
        <div className="relative overflow-hidden bg-gray-900/70 border border-gray-800/60 rounded-2xl">
          <div className="flex gap-3 px-3 py-2.5 ticker-track whitespace-nowrap">
            {[...ticker, ...ticker].filter(Boolean).map((s, i) => (
              <a
                key={i}
                href={s?.ebay_url ? ebayAffiliateUrl(s.ebay_url) : (s?.driver_name ? `/sales?driver=${encodeURIComponent(s.driver_name)}` : '#')}
                target={s?.ebay_url ? '_blank' : undefined}
                rel={s?.ebay_url ? 'sponsored noopener' : undefined}
                className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-800/70 hover:bg-gray-800 border border-gray-700/40 text-xs text-gray-300 transition-colors"
                title={s?.title || ''}
              >
                <span className="text-red-400 font-black">●</span>
                <span className="text-gray-500 text-[10px] uppercase tracking-wide font-bold">Just sold</span>
                <span className="text-white font-semibold">{s?.driver_name || '—'}</span>
                {s?.parallel && <span className="text-cyan-400">{s.parallel}</span>}
                {s?.grade && s.grade !== 'Raw' && <span className="text-amber-400 font-bold">{s.grade}</span>}
                <span className="text-emerald-400 font-black">${Number(s?.sale_price ?? 0).toFixed(0)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Just Sold — Big Wins (>=$100) — horizontal scroll on mobile, grid on desktop */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <span className="text-lg">💰</span>
            Just Sold — Big Wins
            {!bigWinsLoading && <span className="text-[10px] text-gray-500 font-mono">({bigWins.length})</span>}
          </h2>
          <button
            onClick={() => navigate('/sales')}
            className="min-h-[44px] sm:min-h-0 px-2 -mr-2 sm:px-0 sm:mr-0 text-xs text-emerald-400 hover:underline font-medium flex items-center gap-1"
          >
            All sales <ChevronRight size={11} />
          </button>
        </div>
        {bigWinsLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="w-48 shrink-0 bg-gradient-to-br from-emerald-900/20 to-gray-900 border border-emerald-700/30 rounded-2xl p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <SkeletonBox className="w-12 h-16 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <SkeletonBox className="h-3 w-3/4" />
                    <SkeletonBox className="h-2.5 w-1/2" />
                  </div>
                </div>
                <div className="flex items-end justify-between mt-auto">
                  <SkeletonBox className="h-6 w-16" />
                  <SkeletonBox className="h-2.5 w-10" />
                </div>
              </div>
            ))}
          </div>
        ) : bigWins.length === 0 ? (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl">
            <EmptyRow text="No big wins ($100+) in the latest sales yet" />
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 md:grid md:grid-cols-3 lg:grid-cols-5 md:overflow-visible md:mx-0 md:px-0">
            {(Array.isArray(bigWins) ? bigWins : []).filter(Boolean).map((s, i) => {
              const driver = s?.driver_name || ''
              const parallel = s?.parallel || ''
              const slugBase = `${driver}${parallel ? ' ' + parallel : ''}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
              const to = slugBase ? `/card/${slugBase}` : '/sales'
              return (
                <Link
                  key={s?.id ?? i}
                  to={to}
                  className="shrink-0 w-48 md:w-auto snap-start bg-gradient-to-br from-emerald-900/30 to-gray-900 border border-emerald-700/40 hover:border-emerald-500/70 rounded-2xl p-3 transition-colors flex flex-col gap-2 no-underline"
                >
                  <div className="flex items-start gap-2">
                    {s?.image_url && !String(s.image_url).includes('placehold') ? (
                      <img
                        src={s.image_url}
                        alt=""
                        className="w-12 h-16 object-cover rounded border border-gray-800 shrink-0"
                        onError={e => { e.currentTarget.style.display = 'none' }}
                      />
                    ) : (
                      <div className="w-12 h-16 bg-gray-800/70 rounded border border-gray-800 shrink-0 flex items-center justify-center text-lg">🏎</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white truncate">{driver || '—'}</div>
                      {parallel && (
                        <div className="text-[10px] text-cyan-300 font-semibold truncate">{parallel}</div>
                      )}
                      {s?.grade && s.grade !== 'Raw' && (
                        <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 font-bold">
                          {s.grade}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-end justify-between mt-auto">
                    <div className="text-xl font-black text-emerald-400 tabular-nums leading-none">
                      ${Math.round(Number(s?.sale_price ?? 0)).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      {relTime(s?.scraped_at || s?.sale_date)}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Latest Sales feed — Biggest Snipes was promoted out of this grid into
          the always-visible top section, so this is now a single full-width column. */}
      <div>

        {/* What sold today */}
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <Flame size={14} className="text-orange-400" />
              Latest Sales
              {!salesLoading && <span className="text-[10px] text-gray-500 font-mono light:text-gray-600">({sales.length})</span>}
            </h2>
            <button
              onClick={() => loadAll(true)}
              aria-label="Refresh latest sales"
              className="min-h-[44px] sm:min-h-0 px-2 -mr-2 sm:px-0 sm:mr-0 text-xs text-gray-500 hover:text-white flex items-center gap-1 light:text-gray-600 light:hover:text-gray-800"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
          <div className="divide-y divide-gray-800/50 max-h-[560px] overflow-y-auto">
            {salesLoading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <SkeletonBox className="w-10 h-14 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <SkeletonBox className="h-3 w-3/4" />
                    <SkeletonBox className="h-2.5 w-1/2" />
                  </div>
                  <SkeletonBox className="h-4 w-14" />
                </div>
              ))
            ) : (Array.isArray(sales) ? sales : []).length === 0 ? (
              <EmptyRow text="No notable sales yet today" />
            ) : (Array.isArray(sales) ? sales : []).filter(s => s && s.image_url && !String(s.image_url).includes('placehold')).map((s, i) => (
              <a
                key={s?.id ?? i}
                href={s?.ebay_url ? ebayAffiliateUrl(s.ebay_url) : `/sales?driver=${encodeURIComponent(s?.driver_name || '')}`}
                target={s?.ebay_url ? '_blank' : undefined}
                rel={s?.ebay_url ? 'noopener sponsored' : undefined}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 cursor-pointer transition-colors no-underline"
              >
                <img
                  src={s?.image_url}
                  alt=""
                  className="w-10 h-14 object-cover rounded border border-gray-800 shrink-0"
                  onError={e => { try { e.target.closest('a').style.display = 'none' } catch {} }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-white truncate">
                      {s?.driver_name || '—'}
                    </span>
                    {s?.parallel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 font-semibold">
                        {s.parallel}
                      </span>
                    )}
                    {s?.grade && s.grade !== 'Raw' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 font-bold">
                        {s.grade}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5 truncate" title={s?.title || ''}>
                    {s?.title || ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-emerald-400">
                    ${Number(s?.sale_price ?? 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-gray-600">{saleTimeLabel(s)}</div>
                </div>
              </a>
            ))}
          </div>
        </div>

      </div>

      {/* Ending soonest strip */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Clock size={14} className="text-red-400" />
            Ending Soonest (&lt; 24h)
            {!auctionsLoading && <span className="text-[10px] text-gray-500 font-mono">({endingStrip.length})</span>}
          </h2>
          <button
            onClick={() => navigate('/auctions')}
            className="min-h-[44px] sm:min-h-0 px-2 -mr-2 sm:px-0 sm:mr-0 text-xs text-red-400 hover:underline font-medium flex items-center gap-1"
          >
            View all <ChevronRight size={11} />
          </button>
        </div>
        {auctionsLoading ? (
          <SkeletonCardRow count={4} />
        ) : (endingStrip || []).length === 0 ? (
          <Suspense fallback={null}>
            <EndingStripEmpty
              allAuctions={auctions}
              lastSyncAt={lastSync}
              onRefreshed={() => loadAll(true)}
            />
          </Suspense>
        ) : (
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
            {(endingStrip || []).filter(Boolean).map((a, i) => (
              <div key={a?.id ?? i} className="w-[78vw] max-w-[300px] sm:w-64 shrink-0 snap-start">
                <AuctionCard auction={a} onClick={() => setDetailAuction(a)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Hot snipes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Zap size={14} className="text-red-400" fill="currentColor" />
            Hot Snipes
            {!snipesLoading && <span className="text-[10px] text-gray-500 font-mono">(top {hotSnipes.length})</span>}
          </h2>
          <button
            onClick={() => navigate('/auctions')}
            className="min-h-[44px] sm:min-h-0 px-2 -mr-2 sm:px-0 sm:mr-0 text-xs text-red-400 hover:underline font-medium flex items-center gap-1"
          >
            All snipes <ChevronRight size={11} />
          </button>
        </div>
        {snipesLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array(6).fill(0).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (hotSnipes || []).length === 0 ? (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl">
            <EmptyRow text="No active snipe targets right now — check back soon" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {(hotSnipes || []).filter(Boolean).map((a, i) => <AuctionCard key={a?.id ?? i} auction={a} onClick={() => setDetailAuction(a)} />)}
          </div>
        )}
      </div>

      {/* Scraper telemetry strip (footer) */}
      {Array.isArray(scraperHealth?.sources) && scraperHealth.sources.length > 0 && (
        <div className="mt-4 bg-gray-900/50 border border-gray-800/50 rounded-2xl px-3 py-2 flex items-center gap-3 flex-wrap text-[10px]">
          <span className="text-gray-500 uppercase font-black tracking-wider">Scrapers</span>
          {scraperHealth.sources.filter(Boolean).map((s, i) => {
            const sym = s?.status === 'ok' ? '✓' : s?.status === 'warn' ? '⚠' : s?.status === 'blocked' ? '✗' : '–'
            const color = s?.status === 'ok' ? 'text-emerald-400' : s?.status === 'warn' ? 'text-amber-400' : s?.status === 'blocked' ? 'text-red-400' : 'text-gray-500'
            const lastLabel = s?.last_success_at
              ? relTime(s.last_success_at)
              : s?.status === 'blocked' ? 'blocked' : 'no data'
            return (
              <span key={s?.source ?? i} className="text-gray-400" title={`${s?.runs ?? 0} runs · ${s?.success_rate ?? 0}% success · avg ${s?.avg_new_rows ?? 0} new rows/run`}>
                {s?.source || '—'} <span className={`font-black ${color}`}>{sym}</span> <span className="text-gray-600">{lastLabel}</span>
              </span>
            )
          })}
        </div>
      )}
      </>
      )}
    </div>
  )
}

// Rarity weight by parallel. Lower print-run / higher-scarcity = higher weight.
// Mirrors the spirit of scarcity_tier without needing the backend lookup client-side.
const RARITY_WEIGHTS = [
  { re: /superfractor|1\/1|one\s*of\s*one/i, w: 3.0 },
  { re: /\/(?:5|10)\b/, w: 2.4 },
  { re: /\/25\b/, w: 2.0 },
  { re: /\/50\b/, w: 1.7 },
  { re: /autograph|auto\b/i, w: 1.6 },
  { re: /\/99\b/, w: 1.4 },
  { re: /\/150\b|\/199\b/, w: 1.2 },
  { re: /refractor|prism|neon|helix|vegas/i, w: 1.1 },
]
function rarityWeight(a) {
  const hay = `${a?.parallel || ''} ${a?.title || ''}`
  for (const { re, w } of RARITY_WEIGHTS) {
    if (re.test(hay)) return w
  }
  return 1.0
}

// Strip redundant set prefix from display titles so the driver/parallel is visible.
const cleanTitle = (t) => (t || '').replace(/^2025\s*topps\s*chrome\s*f(ormula)?\s*1\s*/i, '').trim()

// Team-logo / non-driver card reject list. These come through as "cards" but are team entries.
const TEAM_DRIVER_RE = /^(oracle|red bull|mercedes|ferrari|aston(?:\s*martin)?|alpine|williams|haas|mclaren|stake|rb|alfa(?:\s*romeo)?|alphatauri|racing bulls|kick sauber|sauber)$/i
const TEAM_TITLE_RE = /\b(racing|team|oracle|mercedes|ferrari|red bull|aston martin|alpine|williams|haas|mclaren|stake|alfa romeo|alphatauri|racing bulls|kick sauber)\b/i
const isTeamCard = (a) => {
  const d = (a?.card?.driver_name || a?.driver_name || '').trim()
  if (!d) return false
  return TEAM_DRIVER_RE.test(d)
}

function DealOfTheDay({ auctions }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])

  // Early bail — if no auctions, render nothing (guards mobile blank render).
  const safeAuctions = Array.isArray(auctions) ? auctions : []
  const deal = useMemo(() => {
    try {
      if (!safeAuctions.length) return null

      const EXCLUDE_PARALLELS = /^(base|refractor|prism refractor|b&w ray wave|b&w lazer|checker flag|floor it|four & more|diamond 75th)$/i
      const AUTO_RE = /\bauto(graph)?\b|\bsigned\b/i
      const RARE_NUMBERED_RE = /\/(?:5|10|15|20|25|50)\b|superfractor|1\/1|one\s*of\s*one/i
      const NUMBERED_99_RE = /\/(?:5|10|15|20|25|50|75|99)\b|superfractor|1\/1|one\s*of\s*one/i
      const STRONG = 'STRONG_BUY'
      const GOOD = 'GOOD_BUY'
      const RARE_INSERT_RE = /(neon nations|vegas at night|helix|ultrasonic|the grail|futuro|speed demons|ace of trades|superfractor)/i

      const DAY_MS = 24 * 3600 * 1000
      const nowMs = Date.now()

      const getParallel = a => a.card?.parallel || a.parallel || ''
      const getTitle = a => a.title || ''
      const hasAuction = a => (a.buying_options || []).includes('AUCTION')
      const hasBIN = a => (a.buying_options || []).includes('FIXED_PRICE')

      const eligible = safeAuctions.filter(a => {
        if (!a) return false
        const series = a.card?.series || a.series || 'F1'
        if (series !== 'F1') return false
        if (isTeamCard(a)) return false
        const parallel = getParallel(a)
        const title = getTitle(a)
        if (!parallel && !a.card?.driver_name && TEAM_TITLE_RE.test(title)) return false
        if (EXCLUDE_PARALLELS.test(parallel)) return false
        return true
      })

      // Bucket 1: Ending Auction — live steal.
      const endingAuctions = eligible.filter(a => {
        if (!hasAuction(a)) return false
        const sL = secsLeft(a)
        if (sL <= 0 || sL >= 3600) return false
        if ((a.current_price || 0) < 10) return false
        if ((a.bid_count || 0) < 1) return false
        return true
      })

      // Bucket 2: Fresh BIN listed within 24h at >= $50 with STRONG/GOOD verdict.
      const freshBins = eligible.filter(a => {
        if (!hasBIN(a)) return false
        const listedAt = a.created_at || a.scraped_at || a.first_seen_at
        if (!listedAt) return false
        const t = new Date(listedAt).getTime()
        if (Number.isNaN(t)) return false
        if (nowMs - t > DAY_MS) return false
        const price = a.buy_it_now_price || a.current_price || 0
        if (price < 50) return false
        if (a.verdict !== STRONG && a.verdict !== GOOD) return false
        return true
      })

      const isAuto = a => AUTO_RE.test(getTitle(a)) || AUTO_RE.test(getParallel(a))
      const isRareNum = a => RARE_NUMBERED_RE.test(getTitle(a)) || RARE_NUMBERED_RE.test(getParallel(a))
      const isNum99 = a => NUMBERED_99_RE.test(getTitle(a)) || NUMBERED_99_RE.test(getParallel(a))
      const isRareInsert = a => RARE_INSERT_RE.test(getTitle(a)) || RARE_INSERT_RE.test(getParallel(a))
      const byScore = (a, b) => (b.snipe_score || 0) - (a.snipe_score || 0)

      // Priority tiers. Pick the best match within the first non-empty tier.
      const tier1 = endingAuctions.filter(a => isAuto(a) || isRareNum(a))
      if (tier1.length) return { ...tier1.sort(byScore)[0], _kind: 'auction' }
      if (endingAuctions.length) return { ...endingAuctions.sort(byScore)[0], _kind: 'auction' }
      const tier3 = freshBins.filter(a => a.verdict === STRONG && isAuto(a))
      if (tier3.length) return { ...tier3.sort(byScore)[0], _kind: 'bin' }
      const tier4 = freshBins.filter(a => a.verdict === STRONG && isNum99(a))
      if (tier4.length) return { ...tier4.sort(byScore)[0], _kind: 'bin' }
      const tier5 = freshBins.filter(a => a.verdict === GOOD && isRareInsert(a))
      if (tier5.length) return { ...tier5.sort(byScore)[0], _kind: 'bin' }
      return null
    } catch (err) {
      console.error('[DealOfTheDay] selection failed', err)
      return null
    }
  }, [safeAuctions])

  if (!deal) return null

  const isAuctionDeal = deal._kind === 'auction'
  const secs = secsLeft(deal) || Math.max(0, Math.floor(((deal?.end_time ? new Date(deal.end_time).getTime() : 0) - now) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const countdown = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`

  const img = deal?.image_url || deal?.primary_image_url
  const rawUrl = deal?.ebay_url || deal?.item_web_url || (deal?.ebay_item_id ? `https://www.ebay.com/itm/${deal.ebay_item_id}` : '#')
  const priceRaw = deal?.current_price ?? deal?.buy_it_now_price ?? deal?.sale_price ?? 0
  const price = Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : 0
  const medianRaw = deal?.median_total ?? deal?.median_price ?? deal?.median ?? null
  const medianComp = medianRaw != null && Number.isFinite(Number(medianRaw)) ? Number(medianRaw) : null
  const driver = deal?.driver_name || deal?.card?.driver_name || ''
  const rawTitle = deal?.title || [driver, deal?.parallel].filter(Boolean).join(' ') || 'F1 Card Deal'
  const title = cleanTitle(rawTitle) || rawTitle
  const auctionId = deal?.id ?? null
  const cardId = deal?.card_id ?? deal?.card?.id ?? null
  const listedAt = deal?.created_at || deal?.scraped_at || deal?.first_seen_at
  const bidCount = deal?.bid_count || 0

  const onCtaClick = () => {
    try { trackClick(rawUrl, auctionId, cardId) } catch (err) { console.error('[DealOfTheDay] trackClick', err) }
  }

  const badgeLabel = isAuctionDeal ? '🔴 Live Auction Steal' : '💰 New Buy-It-Now Deal'
  const formatLine = isAuctionDeal
    ? `${bidCount} bid${bidCount === 1 ? '' : 's'} · ends ${countdown}`
    : `Buy Now · Listed ${relTime(listedAt)}`
  const ctaLabel = isAuctionDeal ? 'Bid on eBay' : 'Buy on eBay'

  return (
    <a
      href={ebayAffiliateUrl(rawUrl)}
      target="_blank"
      rel="noopener sponsored"
      onClick={onCtaClick}
      onAuxClick={onCtaClick}
      className="block mx-3 md:mx-0 bg-gradient-to-br from-red-900 via-red-950 to-gray-900 rounded-2xl border border-red-600/50 shadow-xl shadow-red-950/40 overflow-hidden hover:brightness-110 transition"
    >
      <div className="flex flex-col md:flex-row items-stretch">
        <div className="md:w-64 h-40 md:h-auto bg-black/40 flex items-center justify-center shrink-0 relative">
          {driver && (
            <img
              src={`${API}/api/drivers/photo?name=${encodeURIComponent(driver)}`}
              alt={driver}
              className="absolute top-3 left-3 w-14 h-14 rounded-full object-cover border-2 border-white/70 bg-gray-900 shadow-lg z-10"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          )}
          {img ? (
            <img src={img} alt={title} className="h-full w-full object-contain p-3" />
          ) : (
            <div className="text-red-300 text-xs font-bold">No image</div>
          )}
        </div>
        <div className="flex-1 p-4 md:p-6 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span className="bg-yellow-400 text-red-900 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">
                {badgeLabel}
              </span>
              {deal.verdict && (
                <span className="bg-white/20 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">
                  {String(deal.verdict).replace('_', ' ')}
                </span>
              )}
            </div>
            <h2 className="text-lg md:text-3xl font-black text-white leading-tight mb-1 line-clamp-2">
              {title}
            </h2>
            <div className="text-xs md:text-sm text-red-100 mb-1 md:mb-2 font-semibold">
              {deal.parallel || '—'}{deal.grade && deal.grade !== 'Raw' ? ` · ${deal.grade}` : ''}
            </div>
            <div className="text-[11px] md:text-xs text-yellow-200 font-bold">
              {formatLine}
            </div>
          </div>

          {/* Mobile-only: tighter price row — price + countdown only,
              median collapses into a parenthetical */}
          <div className="flex md:hidden items-end justify-between gap-3">
            <div>
              <div className="text-[10px] text-red-200 uppercase font-bold tracking-wider">
                {isAuctionDeal ? 'Current bid' : 'Buy now'}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-white tabular-nums">${price.toFixed(0)}</span>
                {medianComp != null && (
                  <span className="text-[10px] text-red-200">vs ${medianComp.toFixed(0)} med</span>
                )}
              </div>
              {isAuctionDeal && (
                <div className="text-base font-black text-yellow-300 tabular-nums mt-0.5">{countdown}</div>
              )}
            </div>
          </div>
          <div className="md:hidden">
            <div className="bg-white text-red-700 font-black text-sm px-4 py-3 rounded-xl shadow-lg flex items-center justify-center gap-2">
              {ctaLabel} <ExternalLink size={14} />
            </div>
          </div>

          {/* Desktop: original spacious layout */}
          <div className="hidden md:flex flex-wrap items-end gap-6">
            <div>
              <div className="text-[10px] text-red-200 uppercase font-bold tracking-wider">
                {isAuctionDeal ? 'Current bid' : 'Buy it now'}
              </div>
              <div className="text-5xl font-black text-white tabular-nums">${price.toFixed(0)}</div>
            </div>
            {medianComp != null && (
              <div>
                <div className="text-[10px] text-red-200 uppercase font-bold tracking-wider">Median comp</div>
                <div className="text-3xl font-black text-red-100 tabular-nums">${medianComp.toFixed(0)}</div>
              </div>
            )}
            {isAuctionDeal && (
              <div>
                <div className="text-[10px] text-red-200 uppercase font-bold tracking-wider">Time left</div>
                <div className="text-3xl font-black text-yellow-300 tabular-nums">{countdown}</div>
              </div>
            )}
            <div className="ml-auto">
              <div className="bg-white text-red-700 font-black text-base px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 hover:bg-yellow-50">
                {ctaLabel} <ExternalLink size={14} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </a>
  )
}

function KpiTile({ icon: Icon, label, value, sub, color = 'gray', onClick }) {
  const palettes = {
    blue:    'text-blue-400 bg-blue-600/10 border-blue-600/30',
    red:     'text-red-400 bg-red-600/10 border-red-600/30',
    cyan:    'text-cyan-400 bg-cyan-600/10 border-cyan-600/30',
    emerald: 'text-emerald-400 bg-emerald-600/10 border-emerald-600/30',
    green:   'text-green-400 bg-green-600/10 border-green-600/30',
    yellow:  'text-yellow-400 bg-yellow-600/10 border-yellow-600/30',
    violet:  'text-violet-400 bg-violet-600/10 border-violet-600/30',
    gray:    'text-gray-400 bg-gray-800/40 border-gray-700/50',
  }
  const cls = palettes[color] || palettes.gray
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      onClick={onClick}
      className={`rounded-xl md:rounded-2xl border p-2 md:p-4 ${cls} ${onClick ? 'hover:brightness-125 cursor-pointer text-left' : ''} transition-all`}
    >
      <div className="flex items-center gap-1 md:gap-2 mb-1 md:mb-2">
        <Icon size={11} className="md:hidden opacity-80" />
        <Icon size={13} className="hidden md:block opacity-80" />
        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider opacity-80 truncate">{label}</span>
      </div>
      {value === null ? (
        <div className="h-5 md:h-6 w-16 bg-gray-800/60 rounded animate-pulse" />
      ) : (
        <div className="text-sm md:text-xl font-black text-white truncate tabular-nums">{value}</div>
      )}
      {sub && <div className="hidden md:block text-[10px] text-gray-500 mt-0.5 truncate light:text-gray-600">{sub}</div>}
    </Cmp>
  )
}

function heatColor(count) {
  if (!count) return 'bg-gray-800/60 text-gray-600 light:bg-gray-300 light:text-gray-700'
  if (count <= 3) return 'bg-yellow-600/30 text-yellow-200'
  if (count <= 10) return 'bg-orange-600/40 text-orange-100'
  if (count <= 20) return 'bg-red-600/50 text-red-50'
  return 'bg-red-500 text-white'
}

function SalesHeatmap({ heatmap, loading, navigate }) {
  const cellMap = useMemo(() => {
    const m = {}
    for (const c of heatmap?.cells || []) {
      m[`${c.driver}||${c.parallel}`] = c
    }
    return m
  }, [heatmap])

  const drivers = heatmap?.drivers || []
  const parallels = heatmap?.parallels || []

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black text-white flex items-center gap-2">
          <Flame size={14} className="text-fuchsia-400" />
          Sales Heatmap <span className="text-[10px] text-gray-500 font-mono">(30d · driver × parallel)</span>
        </h2>
      </div>
      {loading ? (
        <div className="h-64 bg-gray-900/50 border border-gray-800/60 rounded-2xl animate-pulse" />
      ) : !drivers.length || !parallels.length ? (
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl py-10 text-center">
          <p className="text-sm text-gray-400 font-medium">Not enough data for heatmap yet</p>
          <p className="text-xs text-gray-600 mt-1">Needs 30d of sold_cards coverage</p>
        </div>
      ) : (
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl p-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[10px] border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left text-gray-500 font-bold uppercase tracking-wide pl-2 pr-3 py-1 sticky left-0 bg-gray-900/90 z-10">Driver</th>
                {parallels.map(p => (
                  <th key={p} className="text-center text-gray-500 font-bold uppercase tracking-wide px-1 py-1 min-w-[64px]">
                    <div className="truncate max-w-[72px] mx-auto" title={p}>{p}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d}>
                  <td className="text-gray-300 font-semibold pr-3 pl-2 py-0.5 whitespace-nowrap sticky left-0 bg-gray-900/90 z-10 text-xs">
                    <button
                      onClick={() => navigate(`/drivers?name=${encodeURIComponent(d)}`)}
                      className="hover:text-white hover:underline"
                    >{d}</button>
                  </td>
                  {parallels.map(p => {
                    const c = cellMap[`${d}||${p}`]
                    const cnt = c?.count || 0
                    return (
                      <td key={p} className="p-0">
                        <button
                          onClick={() => navigate(`/sales?driver=${encodeURIComponent(d)}&parallel=${encodeURIComponent(p)}`)}
                          title={c ? `${cnt} sales · avg $${Math.round(c.avg_price || 0)}` : '0 sales'}
                          className={`w-full h-9 rounded ${heatColor(cnt)} font-bold text-center hover:brightness-125 transition-all`}
                        >
                          {cnt || ''}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500 px-2">
            <span>Legend:</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-800/60 inline-block" />0</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-600/30 inline-block" />1-3</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-600/40 inline-block" />4-10</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600/50 inline-block" />11-20</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" />21+</span>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyRow({ text }) {
  return (
    <div className="py-10 text-center text-gray-600 text-xs">
      {text}
    </div>
  )
}

// Scoped error boundary so a single section blowing up never takes the whole
// dashboard with it (this is what caused mobile "shell only" renders).
class SectionBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('[Dashboard SectionBoundary]', err, info) }
  render() {
    if (this.state.err) {
      return (
        <div className="bg-red-950/30 border border-red-800/40 rounded-2xl px-3 py-2 text-[11px] text-red-300">
          Section failed to render — we're looking into it.
        </div>
      )
    }
    return this.props.children
  }
}
