import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Gavel, Flame, Database, DollarSign, Zap, Activity,
  RefreshCw, Clock, TrendingUp, Users, Layers, ExternalLink,
  AlertTriangle, ChevronRight
} from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const isAuction = a => (a.buying_options || []).includes('AUCTION')

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

  const [moverTab, setMoverTab] = useState('parallel')
  const [lastSync, setLastSync] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadAll = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)

    swrFetch(
      `${API}/api/sales?limit=15`,
      d => { setSales(d.sales || d || []); setSalesLoading(false) }
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

    fetch(`${API}/api/debug/ebay`)
      .then(r => { if (r.status === 429) { setEbayLimited(true); return null } return r.ok ? r.json() : null })
      .catch(() => setEbayLimited(true))
      .finally(() => { setRefreshing(false); setLastSync(new Date()) })
  }, [])

  useEffect(() => {
    loadAll()
    const t = setInterval(loadAll, 60_000)
    return () => clearInterval(t)
  }, [loadAll])

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

  return (
    <div className="space-y-6 max-w-[1800px]">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-red-600 rounded-full shrink-0" />
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight leading-none">Operator Dashboard</h1>
            <p className="text-gray-500 text-xs mt-1.5 font-medium">F1 Chrome Crest · Live auctions, fresh sales, hot snipes</p>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* 2. What sold today */}
        <div className="lg:col-span-2 bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden">
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
                  <div className="text-[10px] text-gray-600">{relTime(s.sale_date)}</div>
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
                  onClick={() => navigate(`/sales?driver=${encodeURIComponent(d.driver)}`)}
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

function EmptyRow({ text }) {
  return (
    <div className="py-10 text-center text-gray-600 text-xs">
      {text}
    </div>
  )
}
