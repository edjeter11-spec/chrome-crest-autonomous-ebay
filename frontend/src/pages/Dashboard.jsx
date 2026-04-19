import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Gavel, Flame, Database, DollarSign, Zap, Activity,
  RefreshCw, Clock, TrendingUp, Users, Layers, ExternalLink,
  AlertTriangle, ChevronRight, Shield, BellRing
} from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import RaceCalendarStrip from '../components/RaceCalendarStrip'
import { swrFetch } from '../lib/cache'
import { useVisibilityInterval } from '../lib/hooks'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const isAuction = a => (a.buying_options || []).includes('AUCTION')

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
  const navigate = useNavigate()

  const [sales, setSales] = useState([])
  const [salesLoading, setSalesLoading] = useState(true)

  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [auctions, setAuctions] = useState([])
  const [auctionsLoading, setAuctionsLoading] = useState(true)

  const [snipes, setSnipes] = useState([])
  const [snipesLoading, setSnipesLoading] = useState(true)


  const [ebayLimited, setEbayLimited] = useState(false)

  const [ticker, setTicker] = useState([])
  const [alertsData, setAlertsData] = useState([])
  const [recent24hCount, setRecent24hCount] = useState(null)

  const [moverTab, setMoverTab] = useState('parallel')
  const [lastSync, setLastSync] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // "Welcome back" delta strip — computed once on first mount
  const [welcomeDelta, setWelcomeDelta] = useState(null)
  const [scraperHealth, setScraperHealth] = useState(null)

  useEffect(() => {
    let lastVisit = null
    try { lastVisit = window.localStorage.getItem('cc_last_visit') } catch {}
    const now = new Date().toISOString()
    try { window.localStorage.setItem('cc_last_visit', now) } catch {}
    if (!lastVisit) return  // first visit — skip the strip

    const since = lastVisit
    Promise.all([
      fetch(`${API}/api/sales?since=${encodeURIComponent(since)}&limit=500`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/alerts`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/watchlist/changes?since=${encodeURIComponent(since)}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([salesRes, alertsRes, watchRes]) => {
      // Falls back to client-side filtering if the `since` param isn't honored
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
  }, [])

  const loadAll = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)

    swrFetch(
      `${API}/api/sales?limit=200`,
      d => {
        const all = d.sales || d || []
        setSales(all.filter(isNotable).slice(0, 15))
        setSalesLoading(false)
      }
    )

    swrFetch(
      `${API}/api/sales/stats`,
      d => { setStats(d || {}); setStatsLoading(false) }
    )

    swrFetch(
      `${API}/api/auctions?buying=auction&limit=500`,
      d => { setAuctions(d.auctions || d || []); setAuctionsLoading(false) }
    )

    swrFetch(
      `${API}/api/auctions/snipe/targets`,
      d => { setSnipes(d.targets || d.auctions || d || []); setSnipesLoading(false) }
    )

    swrFetch(
      `${API}/api/sales?limit=150`,
      d => {
        const all = d.sales || d || []
        setTicker(all.filter(isNotable).slice(0, 10))
      }
    )

    swrFetch(
      `${API}/api/alerts`,
      d => setAlertsData(d.alerts || d || [])
    )

    swrFetch(
      `${API}/api/sales?limit=500`,
      d => {
        const all = d.sales || d || []
        const cutoff = Date.now() - 24 * 3600 * 1000
        const count = all.filter(s => s.sale_date && new Date(s.sale_date).getTime() >= cutoff).length
        setRecent24hCount(count)
      }
    )

    fetch(`${API}/api/debug/ebay`)
      .then(r => { if (r.status === 429) { setEbayLimited(true); return null } return r.ok ? r.json() : null })
      .catch(() => setEbayLimited(true))
      .finally(() => { setRefreshing(false); setLastSync(new Date()) })
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useVisibilityInterval(loadAll, 60_000)

  // --- KPI derivations ---
  const liveAuctionsCount = useMemo(
    () => auctions.filter(a => isAuction(a) && (a.time_left || 0) > 0).length,
    [auctions]
  )
  const endingSoonCount = useMemo(
    () => auctions.filter(a => isAuction(a) && (a.time_left || 0) > 0 && (a.time_left || 0) < 1800).length,
    [auctions]
  )
  const avg30d = useMemo(() => {
    if (!sales?.length) return null
    const cutoff = Date.now() - 30 * 86400 * 1000
    const within = sales.filter(s => s.sale_date && new Date(s.sale_date).getTime() >= cutoff && s.sale_price)
    if (!within.length) return null
    const sum = within.reduce((a, s) => a + (s.sale_price || 0), 0)
    return sum / within.length
  }, [sales])
  const topSnipeScore = useMemo(() => {
    if (!snipes?.length) return null
    return Math.max(...snipes.map(s => s.snipe_score || 0))
  }, [snipes])

  // --- Derived lists ---
  const endingStrip = useMemo(() => {
    return auctions
      .filter(a => isAuction(a) && (a.time_left || 0) > 0 && (a.time_left || 0) < 7200)
      .sort((a, b) => (a.time_left || 0) - (b.time_left || 0))
      .slice(0, 8)
  }, [auctions])

  const hotSnipes = useMemo(() => (snipes || []).slice(0, 6), [snipes])

  // New enthusiast-row derivations
  const endingUnderHour = useMemo(
    () => auctions.filter(a => isAuction(a) && (a.time_left || 0) > 0 && (a.time_left || 0) < 3600).length,
    [auctions]
  )
  const activeSnipesCount = useMemo(
    () => (alertsData || []).filter(a =>
      !a.triggered && (a.urgency === 'critical' || a.urgency === 'high')
    ).length,
    [alertsData]
  )
  const topDriverChips = useMemo(
    () => (stats?.top_drivers || []).slice(0, 8),
    [stats]
  )
  const POPULAR_PARALLELS = [
    'Autograph', 'Refractor', 'Neon Nations', 'SuperFractor', 'Helix', 'Vegas at Night',
  ]

  return (
    <div className="space-y-6 max-w-[1800px]">

      {/* Race calendar strip — top */}
      <RaceCalendarStrip />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-red-600 rounded-full shrink-0" />
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight leading-none">Operator Dashboard</h1>
            <p className="text-gray-500 text-xs mt-1.5 font-medium">F1 Card Hub · Live auctions, fresh sales, hot snipes</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {lastSync && (
            <span className="text-xs text-gray-600 font-mono hidden sm:inline">
              {lastSync.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

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

      {/* NEW: Live ticker strip */}
      {ticker.length > 0 && (
        <div className="relative overflow-hidden bg-gray-900/70 border border-gray-800/60 rounded-2xl">
          <div className="flex gap-3 px-3 py-2.5 ticker-track whitespace-nowrap">
            {[...ticker, ...ticker].map((s, i) => (
              <button
                key={i}
                onClick={() => s.driver_name && navigate(`/sales?driver=${encodeURIComponent(s.driver_name)}`)}
                className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-800/70 hover:bg-gray-800 border border-gray-700/40 text-xs text-gray-300 transition-colors"
                title={s.title}
              >
                <span className="text-red-400 font-black">●</span>
                <span className="text-gray-500 text-[10px] uppercase tracking-wide font-bold">Just sold</span>
                <span className="text-white font-semibold">{s.driver_name || '—'}</span>
                {s.parallel && <span className="text-cyan-400">{s.parallel}</span>}
                {s.grade && s.grade !== 'Raw' && <span className="text-amber-400 font-bold">{s.grade}</span>}
                <span className="text-emerald-400 font-black">${(s.sale_price ?? 0).toFixed(0)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* NEW: Hot right now — 3 big tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/auctions?buying=auction&sort=ending')}
          className="text-left bg-gradient-to-br from-red-900/30 to-red-950/20 border border-red-600/40 hover:border-red-500/60 rounded-2xl p-5 transition-colors"
        >
          <div className="flex items-center gap-2 text-red-400 mb-1">
            <Clock size={14} />
            <span className="text-[11px] font-black uppercase tracking-wider">Ending &lt; 1h</span>
          </div>
          <div className="text-4xl font-black text-red-400 tabular-nums">
            {auctionsLoading ? <span className="opacity-40">…</span> : endingUnderHour}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">Auctions closing in the next hour</div>
        </button>
        <button
          onClick={() => navigate('/alerts')}
          className="text-left bg-gradient-to-br from-orange-900/30 to-orange-950/20 border border-orange-600/40 hover:border-orange-500/60 rounded-2xl p-5 transition-colors"
        >
          <div className="flex items-center gap-2 text-orange-400 mb-1">
            <BellRing size={14} />
            <span className="text-[11px] font-black uppercase tracking-wider">Active Snipes</span>
          </div>
          <div className="text-4xl font-black text-orange-400 tabular-nums">
            {activeSnipesCount}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">Critical + high-urgency tracking</div>
        </button>
        <button
          onClick={() => navigate('/sales')}
          className="text-left bg-gradient-to-br from-emerald-900/30 to-emerald-950/20 border border-emerald-600/40 hover:border-emerald-500/60 rounded-2xl p-5 transition-colors"
        >
          <div className="flex items-center gap-2 text-emerald-400 mb-1">
            <Flame size={14} />
            <span className="text-[11px] font-black uppercase tracking-wider">Last 24h Sales</span>
          </div>
          <div className="text-4xl font-black text-emerald-400 tabular-nums">
            {recent24hCount == null ? <span className="opacity-40">…</span> : recent24hCount}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">Fresh comps logged today</div>
        </button>
      </div>

      {/* NEW: Quick driver jumps */}
      {topDriverChips.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users size={12} className="text-violet-400" />
            <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400">Jump to Driver</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {topDriverChips.map((d, i) => (
              <button
                key={i}
                onClick={() => navigate(`/drivers?name=${encodeURIComponent(d.driver)}`)}
                className="shrink-0 flex flex-col items-center gap-1.5 w-20"
                title={`${d.count} sold · $${Math.round(d.total_value || 0).toLocaleString()}`}
              >
                <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-800 border border-gray-700/50 hover:border-red-500/60 transition-colors">
                  <img
                    src={`${API}/api/drivers/photo?name=${encodeURIComponent(d.driver)}`}
                    alt={d.driver}
                    className="w-full h-full object-cover"
                    onError={e => { e.target.style.display = 'none' }}
                  />
                </div>
                <span className="text-[10px] text-gray-300 text-center leading-tight font-semibold truncate w-full">
                  {(d.driver || '').split(' ').slice(-1)[0]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* NEW: Quick parallel jumps */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Layers size={12} className="text-cyan-400" />
          <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400">Jump to Parallel</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {POPULAR_PARALLELS.map(p => (
            <button
              key={p}
              onClick={() => navigate(`/sales?parallel=${encodeURIComponent(p)}`)}
              className="px-3 py-1.5 rounded-full bg-gray-800/70 hover:bg-cyan-900/40 border border-gray-700/50 hover:border-cyan-600/50 text-xs font-bold text-gray-300 hover:text-cyan-300 transition-colors"
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

      {/* 1. KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile
          icon={Gavel}
          label="Live Auctions"
          value={auctionsLoading ? null : liveAuctionsCount.toLocaleString()}
          sub="Total active"
          color="blue"
        />
        <KpiTile
          icon={Clock}
          label="Ending ≤ 30m"
          value={auctionsLoading ? null : endingSoonCount.toLocaleString()}
          sub={endingSoonCount > 0 ? 'Hurry' : 'None imminent'}
          color={endingSoonCount > 0 ? 'red' : 'gray'}
          onClick={() => navigate('/auctions')}
        />
        <KpiTile
          icon={Database}
          label="Total Sales"
          value={statsLoading ? null : (stats?.total_count?.toLocaleString() ?? '0')}
          sub={stats?.week_count ? `+${stats.week_count.toLocaleString()} this week` : ' '}
          color="cyan"
        />
        <KpiTile
          icon={DollarSign}
          label="30d Avg Sale"
          value={salesLoading ? null : (avg30d != null ? `$${avg30d.toFixed(0)}` : '—')}
          sub={sales?.length ? `${sales.length} recent` : 'No data'}
          color="emerald"
        />
        <KpiTile
          icon={Zap}
          label="Top Snipe"
          value={snipesLoading ? null : (topSnipeScore != null ? Math.round(topSnipeScore) : '—')}
          sub={snipes?.length ? `${snipes.length} tracked` : 'None flagged'}
          color="red"
        />
        <KpiTile
          icon={Activity}
          label="eBay API"
          value={ebayLimited ? 'Limited' : 'OK'}
          sub={ebayLimited ? 'Quota · resets 07:00 UTC' : 'Nominal'}
          color={ebayLimited ? 'yellow' : 'green'}
        />
      </div>

      {/* 2 + 3. Sales feed + Market movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 2. What sold today */}
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <Flame size={14} className="text-orange-400" />
              Latest Sales
              {!salesLoading && <span className="text-[10px] text-gray-500 font-mono">({sales.length})</span>}
            </h2>
            <button
              onClick={() => loadAll(true)}
              className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <div className="divide-y divide-gray-800/50 max-h-[560px] overflow-y-auto">
            {salesLoading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 animate-pulse">
                  <div className="w-10 h-14 bg-gray-800 rounded shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-800 rounded w-3/4" />
                    <div className="h-2.5 bg-gray-800 rounded w-1/2" />
                  </div>
                  <div className="h-4 w-14 bg-gray-800 rounded" />
                </div>
              ))
            ) : sales.length === 0 ? (
              <div className="py-16 text-center text-gray-600">
                <Database size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No sales logged yet</p>
                <p className="text-xs mt-1 opacity-60">Cron ingests every 30 min</p>
              </div>
            ) : sales.map((s, i) => (
              <div
                key={s.id ?? i}
                onClick={() => s.driver_name && navigate(`/sales?driver=${encodeURIComponent(s.driver_name)}`)}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 cursor-pointer transition-colors"
              >
                {s.image_url ? (
                  <img
                    src={s.image_url}
                    alt=""
                    className="w-10 h-14 object-cover rounded border border-gray-800 shrink-0"
                    onError={e => { e.target.style.display = 'none' }}
                  />
                ) : (
                  <div className="w-10 h-14 rounded bg-gray-800/50 border border-gray-800 shrink-0 flex items-center justify-center text-[9px] text-gray-600">
                    —
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-white truncate">
                      {s.driver_name || '—'}
                    </span>
                    {s.parallel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 font-semibold">
                        {s.parallel}
                      </span>
                    )}
                    {s.grade && s.grade !== 'Raw' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 font-bold">
                        {s.grade}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5 truncate" title={s.title}>
                    {s.title || ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-emerald-400">
                    ${(s.sale_price ?? 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-gray-600">{saleTimeLabel(s)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Market movers */}
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-800/60">
            <h2 className="text-sm font-black text-white flex items-center gap-2 mb-2.5">
              <TrendingUp size={14} className="text-violet-400" />
              Market Movers
            </h2>
            <div className="flex gap-1 bg-gray-800/60 p-0.5 rounded-xl">
              <button
                onClick={() => setMoverTab('parallel')}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                  moverTab === 'parallel' ? 'bg-violet-600/30 text-violet-300' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Layers size={10} /> By Parallel
              </button>
              <button
                onClick={() => setMoverTab('driver')}
                className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                  moverTab === 'driver' ? 'bg-violet-600/30 text-violet-300' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Users size={10} /> By Driver
              </button>
            </div>
          </div>
          <div className="flex-1 max-h-[500px] overflow-y-auto divide-y divide-gray-800/50">
            {statsLoading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="px-4 py-2.5 animate-pulse">
                  <div className="h-3 bg-gray-800 rounded w-2/3 mb-1.5" />
                  <div className="h-2.5 bg-gray-800 rounded w-1/2" />
                </div>
              ))
            ) : moverTab === 'parallel' ? (
              (stats?.by_parallel?.length > 0 ? stats.by_parallel : []).slice(0, 12).map((p, i) => (
                <div
                  key={i}
                  onClick={() => navigate(`/sales?parallel=${encodeURIComponent(p.parallel)}`)}
                  className="px-4 py-2.5 hover:bg-gray-800/40 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate">{p.parallel || '—'}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {p.count} sold · avg ${Math.round(p.avg_price || 0)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black text-emerald-400">
                      ${Math.round(p.max_price || 0).toLocaleString()}
                    </div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wide">max</div>
                  </div>
                  <ChevronRight size={12} className="text-gray-600 shrink-0" />
                </div>
              ))
            ) : (
              (stats?.top_drivers?.length > 0 ? stats.top_drivers : []).slice(0, 12).map((d, i) => (
                <div
                  key={i}
                  onClick={() => navigate(`/drivers?name=${encodeURIComponent(d.driver)}`)}
                  className="px-4 py-2.5 hover:bg-gray-800/40 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate">{d.driver || '—'}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{d.count} sold</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black text-violet-400">
                      ${Math.round(d.total_value || 0).toLocaleString()}
                    </div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wide">volume</div>
                  </div>
                  <ChevronRight size={12} className="text-gray-600 shrink-0" />
                </div>
              ))
            )}
            {!statsLoading && moverTab === 'parallel' && !(stats?.by_parallel?.length) && (
              <EmptyRow text="No parallel breakdown yet" />
            )}
            {!statsLoading && moverTab === 'driver' && !(stats?.top_drivers?.length) && (
              <EmptyRow text="No driver breakdown yet" />
            )}
          </div>
        </div>
      </div>

      {/* 4. Ending soonest strip */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-white flex items-center gap-2">
            <Clock size={14} className="text-red-400" />
            Ending Soonest (&lt; 2h)
            {!auctionsLoading && <span className="text-[10px] text-gray-500 font-mono">({endingStrip.length})</span>}
          </h2>
          <button
            onClick={() => navigate('/auctions')}
            className="text-xs text-red-400 hover:underline font-medium flex items-center gap-1"
          >
            View all <ChevronRight size={11} />
          </button>
        </div>
        {auctionsLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {Array(4).fill(0).map((_, i) => (
              <div key={i} className="w-64 shrink-0 h-72 bg-gray-900 rounded-2xl border border-gray-800 animate-pulse" />
            ))}
          </div>
        ) : endingStrip.length === 0 ? (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl py-10 text-center">
            <AlertTriangle size={28} className="mx-auto mb-3 text-amber-600/60" />
            <p className="text-sm text-gray-400 font-medium">No auctions ending in the next 2 hours</p>
            <p className="text-xs text-gray-600 mt-1">Sync runs every 30m — next batch coming</p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
            {endingStrip.map(a => (
              <div key={a.id} className="w-64 shrink-0 snap-start">
                <AuctionCard auction={a} />
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
            className="text-xs text-red-400 hover:underline font-medium flex items-center gap-1"
          >
            All snipes <ChevronRight size={11} />
          </button>
        </div>
        {snipesLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="h-72 bg-gray-900 rounded-2xl border border-gray-800 animate-pulse" />
            ))}
          </div>
        ) : hotSnipes.length === 0 ? (
          <div className="bg-gray-900/50 border border-gray-800/60 rounded-2xl py-10 text-center">
            <Zap size={28} className="mx-auto mb-3 text-gray-600" />
            <p className="text-sm text-gray-400 font-medium">No snipes flagged right now</p>
            <p className="text-xs text-gray-600 mt-1">Check back after the next sync</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {hotSnipes.map(a => <AuctionCard key={a.id} auction={a} />)}
          </div>
        )}
      </div>

      {/* Scraper telemetry strip (footer) */}
      {scraperHealth?.sources?.length > 0 && (
        <div className="mt-4 bg-gray-900/50 border border-gray-800/50 rounded-2xl px-3 py-2 flex items-center gap-3 flex-wrap text-[10px]">
          <span className="text-gray-500 uppercase font-black tracking-wider">Scrapers</span>
          {scraperHealth.sources.map(s => {
            const sym = s.status === 'ok' ? '✓' : s.status === 'warn' ? '⚠' : s.status === 'blocked' ? '✗' : '–'
            const color = s.status === 'ok' ? 'text-emerald-400' : s.status === 'warn' ? 'text-amber-400' : s.status === 'blocked' ? 'text-red-400' : 'text-gray-500'
            const lastLabel = s.last_success_at
              ? relTime(s.last_success_at)
              : s.status === 'blocked' ? 'blocked' : 'no data'
            return (
              <span key={s.source} className="text-gray-400" title={`${s.runs} runs · ${s.success_rate}% success · avg ${s.avg_new_rows} new rows/run`}>
                {s.source} <span className={`font-black ${color}`}>{sym}</span> <span className="text-gray-600">{lastLabel}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
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
      className={`rounded-2xl border p-4 ${cls} ${onClick ? 'hover:brightness-125 cursor-pointer text-left' : ''} transition-all`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className="opacity-80" />
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      </div>
      {value === null ? (
        <div className="h-6 w-20 bg-gray-800/60 rounded animate-pulse" />
      ) : (
        <div className="text-xl font-black text-white truncate tabular-nums">{value}</div>
      )}
      {sub && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </Cmp>
  )
}

function heatColor(count) {
  if (!count) return 'bg-gray-800/60 text-gray-600'
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
