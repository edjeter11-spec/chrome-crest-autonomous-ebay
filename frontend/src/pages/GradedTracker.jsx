import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import {
  Shield, ExternalLink, TrendingUp, Award, BarChart2, Search,
  X, Clock, Gavel, Info,
} from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'

const API = import.meta.env.VITE_API_URL || ''

const DriverPriceChart = lazy(() => import('../components/DriverPriceChart'))

const SOURCE_STYLES = {
  eBay:               { bg: 'bg-gray-700/60',   text: 'text-gray-200',   border: 'border-gray-600/50' },
  'eBay-detail':      { bg: 'bg-gray-600/50',   text: 'text-gray-100',   border: 'border-gray-500/50' },
  Goldin:             { bg: 'bg-yellow-800/40', text: 'text-yellow-300', border: 'border-yellow-700/50' },
  PWCC:               { bg: 'bg-blue-800/40',   text: 'text-blue-300',   border: 'border-blue-700/50' },
  MySlabs:            { bg: 'bg-purple-800/40', text: 'text-purple-300', border: 'border-purple-700/50' },
  Mavin:              { bg: 'bg-teal-800/40',   text: 'text-teal-300',   border: 'border-teal-700/50' },
  Heritage:           { bg: 'bg-rose-800/40',   text: 'text-rose-300',   border: 'border-rose-700/50' },
  'Fanatics Collect': { bg: 'bg-orange-800/40', text: 'text-orange-300', border: 'border-orange-700/50' },
  HEROES:             { bg: 'bg-green-800/40',  text: 'text-green-300',  border: 'border-green-700/50' },
}
const DEFAULT_SOURCE_STYLE = { bg: 'bg-gray-800/40', text: 'text-gray-300', border: 'border-gray-700/50' }

function SourceBadge({ source }) {
  const s = SOURCE_STYLES[source] || DEFAULT_SOURCE_STYLE
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase ${s.bg} ${s.text} border ${s.border}`}>
      {source || 'eBay'}
    </span>
  )
}

function GradeBadge({ grade, driver, parallel, clickable = false }) {
  if (!grade) return null
  const color = grade === 'PSA 10' ? 'text-yellow-400 bg-yellow-900/30 border-yellow-800/40'
    : grade?.startsWith('PSA 9') ? 'text-green-400 bg-green-900/30 border-green-800/40'
    : 'text-gray-300 bg-gray-800/60 border-gray-700/50'

  const psaPopUrl = clickable && driver && parallel ? getPsaPopUrl(driver, parallel, grade) : null

  const badge = (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${color} ${psaPopUrl ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}>
      {grade}
    </span>
  )

  if (psaPopUrl) {
    return (
      <a href={psaPopUrl} target="_blank" rel="noopener noreferrer" title="View PSA population report">
        {badge}
      </a>
    )
  }

  return badge
}

function getPsaPopUrl(driver, parallel, grade) {
  // PSA population report URL format: https://www.psacard.com/pop
  // Query params: card_name, parallel (optional), grade (optional)
  const params = new URLSearchParams()
  params.set('card_name', `${driver} 2025 Topps Chrome`)
  if (parallel && parallel !== 'Base') params.set('parallel', parallel)
  if (grade && grade !== 'Raw') params.set('grade', grade)
  return `https://www.psacard.com/pop?${params.toString()}`
}

function Countdown({ endTime }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!endTime) return <span className="text-gray-600">—</span>
  const diff = Math.max(0, new Date(endTime) - new Date())
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  const txt = days > 0 ? `${days}d ${hours}h`
    : hours > 0 ? `${hours}h ${mins}m`
    : `${mins}m ${secs}s`
  const urgent = diff < 3600000
  return <span className={urgent ? 'text-red-400 font-bold' : 'text-gray-300'}>{txt}</span>
}

export default function GradedTracker() {
  const [leaderboard, setLeaderboard] = useState(null)
  const [sourceCounts, setSourceCounts] = useState(null)
  const [activeAuctions, setActiveAuctions] = useState([])
  const [sales, setSales] = useState([])
  const [salesTotal, setSalesTotal] = useState(0)
  const [salesLoading, setSalesLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({ grade: '', parallel: '', source: '', search: '' })
  const [sortKey, setSortKey] = useState('total_graded')
  const [sortOrder, setSortOrder] = useState('desc')
  const [drawerDriver, setDrawerDriver] = useState(null)

  const pageSize = 50

  useEffect(() => {
    fetch(`${API}/api/graded/leaderboard?sort=${sortKey}&order=${sortOrder}`)
      .then(r => r.json()).then(setLeaderboard).catch(() => {})
  }, [sortKey, sortOrder])

  useEffect(() => {
    fetch(`${API}/api/graded/source-counts`).then(r => r.json()).then(setSourceCounts).catch(() => {})
    fetch(`${API}/api/graded/active-auctions?limit=5`).then(r => r.json()).then(d => setActiveAuctions(d.auctions || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setSalesLoading(true)
    const qs = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize),
    })
    if (filters.grade) qs.set('grade', filters.grade)
    if (filters.parallel) qs.set('parallel', filters.parallel)
    if (filters.source) qs.set('source', filters.source)
    if (filters.search) qs.set('driver', filters.search)
    qs.set('year', '2025')
    fetch(`${API}/api/graded/sales?${qs}`).then(r => r.json()).then(d => {
      setSales(d.sales || [])
      setSalesTotal(d.total || 0)
      setSalesLoading(false)
    }).catch(() => setSalesLoading(false))
  }, [page, filters])

  const handleSort = (key) => {
    if (sortKey === key) setSortOrder(o => o === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortOrder('desc') }
  }

  const sortIcon = (k) => sortKey === k ? (sortOrder === 'desc' ? '↓' : '↑') : ''

  const kpis = leaderboard?.kpis
  const rows = leaderboard?.rows || []
  const filteredRows = useMemo(() => {
    if (!filters.search) return rows
    return rows.filter(r => (r.driver || '').toLowerCase().includes(filters.search.toLowerCase()))
  }, [rows, filters.search])

  return (
    <div className="space-y-5 max-w-[1500px]">
      {/* Header */}
      <div>
        <h1 className="page-title">Graded F1 Cards</h1>
        <p className="text-sm text-gray-500 mt-1">
          Real graded sales from eBay, Goldin, PWCC + MySlabs. Observed pop estimate from {kpis?.total_graded_sales?.toLocaleString() || 0} tracked graded sales.
        </p>
      </div>

      {/* Data source banner */}
      <div className="panel p-4 border border-yellow-900/30 bg-gradient-to-r from-yellow-950/20 to-gray-900/60">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-300 leading-relaxed">
              PSA hasn't indexed the 2025 Topps Chrome F1 set yet. We surface real graded sales from every marketplace we can reach + compute an observed pop estimate.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {(() => {
                // Always show the major sources even if count is 0, so users know
                // whether the integration exists yet. Show "Coming soon" for 0 counts
                // on partner sources; working sources (eBay, SportsCardsPro) always show counts.
                const present = sourceCounts?.sources || {}
                const ALWAYS_SHOW = ['eBay', 'SportsCardsPro', 'Goldin', 'PWCC', 'MySlabs']
                const WORKING = new Set(['eBay', 'SportsCardsPro'])
                const merged = { ...Object.fromEntries(ALWAYS_SHOW.map(s => [s, 0])), ...present }
                return Object.entries(merged).sort((a,b) => (b[1]||0) - (a[1]||0)).map(([src, cnt]) => {
                  const style = SOURCE_STYLES[src] || DEFAULT_SOURCE_STYLE
                  const isZero = !cnt || cnt === 0
                  const showComingSoon = isZero && !WORKING.has(src)
                  return (
                    <div key={src} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${style.bg} ${style.border} ${showComingSoon ? 'opacity-60' : ''}`}>
                      <span className={`font-bold ${style.text}`}>{src}</span>
                      <span className="text-white font-black">
                        {showComingSoon ? 'Coming soon' : (cnt ?? '—')}
                      </span>
                    </div>
                  )
                })
              })()}
              {sourceCounts?.myslabs_active_listings > 0 && (
                <div className="px-2.5 py-1 rounded-lg text-[11px] border border-purple-700/40 bg-purple-900/20 text-purple-300">
                  {sourceCounts.myslabs_active_listings} active MySlabs listings
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Graded Sales', value: (kpis.total_graded_sales || 0).toLocaleString(), color: 'text-white' },
            { label: 'Total $ Value', value: `$${(kpis.total_graded_value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-green-400' },
            { label: 'Drivers w/ PSA 10', value: kpis.drivers_with_psa10 || 0, color: 'text-yellow-400' },
            { label: 'Most Graded', value: kpis.most_graded_driver || '—', color: 'text-blue-400', small: true },
            { label: 'Highest Sale', value: `$${(kpis.highest_sale?.price || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-red-400' },
            { label: 'Active Graded Auctions', value: kpis.active_graded_auctions || 0, color: 'text-purple-400' },
          ].map(k => (
            <div key={k.label} className="panel p-3">
              <div className={`${k.small ? 'text-sm font-bold truncate' : 'text-xl font-black'} ${k.color}`}>{k.value}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="panel p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={filters.search}
            onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0) }}
            placeholder="Search driver…"
            className="input-field w-full pl-8 pr-3 py-2 text-xs"
          />
        </div>
        <select value={filters.grade} onChange={e => { setFilters(f => ({ ...f, grade: e.target.value })); setPage(0) }}
          className="input-field text-xs py-2 px-2">
          <option value="">All Grades</option>
          <option value="PSA 10">PSA 10</option>
          <option value="PSA 9">PSA 9</option>
          <option value="PSA 8">PSA 8</option>
          <option value="BGS 9.5">BGS 9.5</option>
          <option value="BGS 9">BGS 9</option>
        </select>
        <select value={filters.parallel} onChange={e => { setFilters(f => ({ ...f, parallel: e.target.value })); setPage(0) }}
          className="input-field text-xs py-2 px-2">
          <option value="">All Parallels</option>
          <option value="Refractor">Refractor</option>
          <option value="Gold /50">Gold /50</option>
          <option value="Orange /25">Orange /25</option>
          <option value="Red /5">Red /5</option>
          <option value="Autograph">Autograph</option>
        </select>
        <select value={filters.source} onChange={e => { setFilters(f => ({ ...f, source: e.target.value })); setPage(0) }}
          className="input-field text-xs py-2 px-2">
          <option value="">All Sources</option>
          <option value="eBay">eBay</option>
          <option value="Goldin">Goldin</option>
          <option value="PWCC">PWCC</option>
          <option value="MySlabs">MySlabs</option>
        </select>
      </div>

      {/* Leaderboard */}
      <div className="panel p-4">
        <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Award size={14} className="text-yellow-400" />
          Driver Leaderboard
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 font-semibold">Driver</th>
                <th className="text-right py-2 font-semibold cursor-pointer hover:text-white" onClick={() => handleSort('total_graded')}>Total Graded {sortIcon('total_graded')}</th>
                <th className="text-right py-2 font-semibold cursor-pointer hover:text-white" onClick={() => handleSort('psa_10')}>PSA 10 {sortIcon('psa_10')}</th>
                <th className="text-right py-2 font-semibold cursor-pointer hover:text-white" onClick={() => handleSort('avg_psa_10')}>Avg PSA 10 {sortIcon('avg_psa_10')}</th>
                <th className="text-right py-2 font-semibold cursor-pointer hover:text-white" onClick={() => handleSort('max_price')}>Highest {sortIcon('max_price')}</th>
                <th className="text-right py-2 font-semibold cursor-pointer hover:text-white" onClick={() => handleSort('gem_rate')}>Gem Rate % {sortIcon('gem_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-600">No graded sales yet.</td></tr>
              ) : filteredRows.map(r => (
                <tr key={r.driver} onClick={() => setDrawerDriver(r.driver)}
                  className="border-b border-gray-800/40 hover:bg-gray-900/50 cursor-pointer transition-colors">
                  <td className="py-2 font-semibold text-white">{r.driver}</td>
                  <td className="py-2 text-right text-gray-300">{r.total_graded}</td>
                  <td className="py-2 text-right text-yellow-400 font-bold">{r.psa_10}</td>
                  <td className="py-2 text-right text-white">{r.avg_psa_10 ? `$${r.avg_psa_10.toLocaleString()}` : '—'}</td>
                  <td className="py-2 text-right text-green-400 font-bold">${r.max_price.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-300">{r.gem_rate_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active graded auctions */}
      <div className="panel p-4">
        <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Gavel size={14} className="text-red-400" />
          Live Graded Auctions
          <span className="text-[10px] text-gray-600 font-normal">(ending soonest)</span>
        </h2>
        {activeAuctions.length === 0 ? (
          <p className="text-xs text-gray-600 py-3">No graded auctions active.</p>
        ) : (
          <div className="space-y-1.5">
            {activeAuctions.map(a => (
              <a key={a.id} href={ebayAffiliateUrl(a.ebay_url)} target="_blank" rel="sponsored noopener"
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-900/60 transition-colors">
                {a.image_url && <img src={a.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{a.title}</div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-2 mt-0.5">
                    <Clock size={9} /> <Countdown endTime={a.end_time} />
                  </div>
                </div>
                <div className="text-sm font-black text-green-400 shrink-0">${a.current_price?.toFixed(2)}</div>
                <ExternalLink size={11} className="text-gray-600 shrink-0" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Every graded sale feed */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <TrendingUp size={14} className="text-green-400" />
            Every Graded Sale
            <span className="text-[10px] text-gray-600 font-normal">{salesTotal.toLocaleString()} total</span>
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
              className="px-2 py-1 rounded-lg bg-gray-800 text-gray-300 disabled:opacity-40">Prev</button>
            <span className="text-gray-500">Page {page + 1} / {Math.max(1, Math.ceil(salesTotal / pageSize))}</span>
            <button disabled={(page + 1) * pageSize >= salesTotal} onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 rounded-lg bg-gray-800 text-gray-300 disabled:opacity-40">Next</button>
          </div>
        </div>
        {salesLoading ? (
          <div className="space-y-1.5">{Array(10).fill(0).map((_, i) => <div key={i} className="h-10 skeleton rounded-lg" />)}</div>
        ) : sales.length === 0 ? (
          <p className="text-xs text-gray-600 py-6 text-center">No sales match the filters.</p>
        ) : (
          <div className="space-y-1">
            {sales.map(s => (
              <a key={s.id} href={s.ebay_url ? ebayAffiliateUrl(s.ebay_url) : '#'} target="_blank" rel="sponsored noopener"
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-900/60 transition-colors">
                {s.image_url ? (
                  <img src={s.image_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" loading="lazy" />
                ) : (
                  <div className="w-8 h-8 rounded bg-gray-800 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{s.driver_name || s.title?.slice(0, 60)}</div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-1.5 mt-0.5">
                    <span className="truncate">{s.parallel}</span>
                    <GradeBadge grade={s.grade} driver={s.driver_name} parallel={s.parallel} clickable={true} />
                  </div>
                </div>
                <div className="text-sm font-black text-green-400 shrink-0 w-20 text-right">${s.sale_price?.toFixed(2)}</div>
                <div className="text-[10px] text-gray-500 shrink-0 w-20 text-right">{s.sale_date?.slice(0, 10)}</div>
                <SourceBadge source={s.source} />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Driver detail drawer */}
      {drawerDriver && (
        <DriverDrawer driver={drawerDriver} onClose={() => setDrawerDriver(null)} />
      )}
    </div>
  )
}

function DriverDrawer({ driver, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetch(`${API}/api/graded/driver-detail?driver=${encodeURIComponent(driver)}`)
      .then(r => r.json()).then(setData).catch(() => setData({ breakdown: [], top_sales: [], trend_90d: [] }))
  }, [driver])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-2xl h-full bg-gray-950 border-l border-gray-800 overflow-y-auto">
        <div className="sticky top-0 bg-gray-950/95 backdrop-blur-md border-b border-gray-800 p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-black text-white">{driver}</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">Graded sales detail</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!data ? (
            <div className="h-40 skeleton rounded-xl" />
          ) : (
            <>
              {/* Parallel × grade breakdown */}
              <div>
                <h3 className="text-xs font-bold text-white mb-2 uppercase tracking-wide">Parallel × Grade</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-1.5">Parallel</th>
                      <th className="text-left py-1.5">Grade</th>
                      <th className="text-right py-1.5">Count</th>
                      <th className="text-right py-1.5">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.breakdown || []).slice(0, 30).map((r, i) => (
                      <tr key={i} className="border-b border-gray-800/50">
                        <td className="py-1.5 text-gray-300">{r.parallel}</td>
                        <td className="py-1.5"><GradeBadge grade={r.grade} driver={driver} parallel={r.parallel} clickable={true} /></td>
                        <td className="py-1.5 text-right text-white">{r.count}</td>
                        <td className="py-1.5 text-right text-green-400 font-bold">${r.avg_price?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 90d trend chart */}
              <div>
                <h3 className="text-xs font-bold text-white mb-2 uppercase tracking-wide">90-Day Price Trend</h3>
                <Suspense fallback={<div className="h-40 skeleton rounded-xl" />}>
                  <DriverPriceChart driver={driver} days={90} />
                </Suspense>
              </div>

              {/* Top sales */}
              <div>
                <h3 className="text-xs font-bold text-white mb-2 uppercase tracking-wide">Top 10 Graded Sales</h3>
                <div className="space-y-1">
                  {(data.top_sales || []).map((s, i) => (
                    <a key={i} href={s.ebay_url ? ebayAffiliateUrl(s.ebay_url) : '#'} target="_blank" rel="sponsored noopener"
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-900/60">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate">{s.title}</div>
                        <div className="text-[10px] text-gray-500 flex items-center gap-2 mt-0.5">
                          {s.parallel} <GradeBadge grade={s.grade} driver={driver} parallel={s.parallel} clickable={true} /> <SourceBadge source={s.source} />
                        </div>
                      </div>
                      <div className="text-sm font-black text-green-400">${s.sale_price?.toLocaleString()}</div>
                    </a>
                  ))}
                </div>
              </div>

              <a href={`/sales?driver=${encodeURIComponent(driver)}&grade=10`}
                className="block text-center py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-colors">
                View all sales for {driver} →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
