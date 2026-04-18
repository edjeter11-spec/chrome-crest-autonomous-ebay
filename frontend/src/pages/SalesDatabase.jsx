import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Database, Download, Search, RefreshCw, ExternalLink,
  DollarSign, Package, Calendar, TrendingUp, ChevronDown, ChevronUp, Share2
} from 'lucide-react'

async function shareSale(e, sale) {
  e.stopPropagation()
  e.preventDefault()
  const url = `${window.location.origin}/sales?id=${sale.id}`
  const shareData = {
    title: 'F1 Card Hub — sale',
    text: `${sale.driver_name || 'F1 card'} sold for $${sale.sale_price?.toFixed(2) ?? ''}`,
    url,
  }
  try {
    if (navigator.share) { await navigator.share(shareData); return }
  } catch { return }
  try { await navigator.clipboard.writeText(url) } catch {}
}
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const PARALLELS = [
  'All', 'Autograph', 'Superfractor 1/1', 'Red /5', 'Black /10', 'Orange /25',
  'Gold /50', 'F1 75th /75', 'Green /99', 'Blue /150', 'Aqua /199',
  'Pink /250', 'Teal /299',
  'Vegas at Night', 'Neon Nations', 'Floor It', 'Speed Wheels', 'Top Speed',
  'Four & More', 'Diamond 75th', 'Helix', 'Ultrasonic', 'The Grail', 'Futuro',
  'The Chain', 'The Grid', 'Helmet Collection', 'Speed Demons', 'Ace of Trades',
  'Prism Refractor', 'Refractor', 'B&W Ray Wave', 'B&W Lazer', 'Checker Flag',
]

const GRADES = ['All', 'Graded', 'Raw', 'PSA 10', 'PSA 9.5', 'PSA 9',
                'BGS 9.5', 'BGS 9', 'SGC 10', 'SGC 9.5']

const DRIVERS = [
  'All', 'Max Verstappen', 'Lewis Hamilton', 'Charles Leclerc', 'Lando Norris',
  'Oscar Piastri', 'Fernando Alonso', 'Carlos Sainz', 'George Russell',
  'Sergio Perez', 'Lance Stroll', 'Valtteri Bottas', 'Esteban Ocon',
  'Pierre Gasly', 'Yuki Tsunoda', 'Nico Hulkenberg', 'Kevin Magnussen',
  'Zhou Guanyu', 'Alexander Albon', 'Gabriel Bortoleto', 'Liam Lawson',
  'Andrea Kimi Antonelli', 'Oliver Bearman', 'Jack Doohan', 'Isack Hadjar',
]

const PAGE_SIZE = 100

export default function SalesDatabase() {
  const [sales, setSales] = useState([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [driver, setDriver] = useState('All')
  const [parallel, setParallel] = useState('All')
  const [grade, setGrade] = useState('All')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState('sale_date')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(0)

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (driver !== 'All') p.set('driver', driver)
    if (parallel !== 'All') p.set('parallel', parallel)
    if (grade !== 'All') p.set('grade', grade)
    if (minPrice) p.set('min_price', minPrice)
    if (maxPrice) p.set('max_price', maxPrice)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    p.set('limit', PAGE_SIZE)
    p.set('offset', page * PAGE_SIZE)
    return p.toString()
  }, [driver, parallel, grade, minPrice, maxPrice, dateFrom, dateTo, page])

  const statsQs = useMemo(() => {
    const p = new URLSearchParams()
    if (driver !== 'All') p.set('driver', driver)
    if (parallel !== 'All') p.set('parallel', parallel)
    if (grade !== 'All') p.set('grade', grade)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    return p.toString()
  }, [driver, parallel, grade, dateFrom, dateTo])

  const load = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    swrFetch(
      `${API}/api/sales?${qs}`,
      d => { setSales(d.sales || []); setTotal(d.total || 0); setLoading(false) },
      () => setRefreshing(false)
    )
    swrFetch(
      `${API}/api/sales/stats?${statsQs}`,
      d => setStats(d),
    )
  }, [qs, statsQs])

  useEffect(() => { load() }, [load])

  const resetFilters = () => {
    setDriver('All'); setParallel('All'); setGrade('All')
    setMinPrice(''); setMaxPrice(''); setDateFrom(''); setDateTo('')
    setSearch(''); setPage(0)
  }

  const filteredSorted = useMemo(() => {
    let arr = sales
    if (search) {
      const s = search.toLowerCase()
      arr = arr.filter(x =>
        (x.title || '').toLowerCase().includes(s) ||
        (x.driver_name || '').toLowerCase().includes(s)
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    const key = sortField
    return [...arr].sort((a, b) => {
      const av = a[key], bv = b[key]
      if (av == null) return 1
      if (bv == null) return -1
      if (key === 'sale_date') return (new Date(av) - new Date(bv)) * dir
      if (typeof av === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [sales, search, sortField, sortDir])

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const exportCsv = () => {
    const p = new URLSearchParams(qs)
    p.delete('limit'); p.delete('offset')
    window.open(`${API}/api/sales/export.csv?${p.toString()}`, '_blank')
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const SortHeader = ({ field, children, align = 'left' }) => (
    <th
      onClick={() => toggleSort(field)}
      className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 cursor-pointer hover:text-white transition-colors select-none text-${align}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortField === field && (
          sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
        )}
      </span>
    </th>
  )

  return (
    <div className="space-y-4 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="w-1 h-7 bg-cyan-600 rounded-full shrink-0" />
        <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
          <Database size={20} className="text-cyan-400" />
          Sales Database
        </h1>
        {!loading && (
          <span className="text-[10px] md:text-xs font-semibold px-2 md:px-2.5 py-1 rounded-xl bg-gray-800 text-gray-300 border border-gray-700/50">
            {total.toLocaleString()} sales
          </span>
        )}
        <button onClick={exportCsv}
          className="ml-auto flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-600/40 text-[11px] md:text-xs font-bold transition-colors">
          <Download size={12} /> <span className="hidden sm:inline">Export </span>CSV
        </button>
        <button onClick={() => load(true)}
          className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox icon={Package} label="Total Sales" value={stats.total_count?.toLocaleString() ?? 0} color="cyan" />
          <StatBox icon={DollarSign} label="Total Value" value={`$${(stats.total_value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="emerald" />
          <StatBox icon={Calendar} label="This Week" value={(stats.week_count || 0).toLocaleString()} color="yellow" />
          <StatBox icon={TrendingUp} label="Top Parallel"
            value={stats.by_parallel?.[0]?.parallel ?? '—'}
            sub={stats.by_parallel?.[0] ? `${stats.by_parallel[0].count} sold · median $${Math.round(stats.by_parallel[0].median_price ?? stats.by_parallel[0].avg_price)}` : ''}
            color="violet" />
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl px-3 md:px-4 py-3 flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="relative w-full sm:min-w-48 sm:w-auto sm:flex-1 md:flex-none">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search title or driver…"
            className="input-field w-full pl-8 pr-3 py-2 text-xs" />
        </div>

        <select value={driver} onChange={e => { setDriver(e.target.value); setPage(0) }}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {DRIVERS.map(d => <option key={d} value={d}>{d === 'All' ? 'All Drivers' : d}</option>)}
        </select>

        <select value={parallel} onChange={e => { setParallel(e.target.value); setPage(0) }}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PARALLELS.map(p => <option key={p} value={p}>{p === 'All' ? 'All Parallels' : p}</option>)}
        </select>

        <select value={grade} onChange={e => { setGrade(e.target.value); setPage(0) }}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {GRADES.map(g => <option key={g} value={g}>{g === 'All' ? 'Any Grade' : g}</option>)}
        </select>

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        <input type="number" value={minPrice} onChange={e => { setMinPrice(e.target.value); setPage(0) }}
          placeholder="$ min" className="input-field w-24 px-3 py-2 text-xs" />
        <input type="number" value={maxPrice} onChange={e => { setMaxPrice(e.target.value); setPage(0) }}
          placeholder="$ max" className="input-field w-24 px-3 py-2 text-xs" />

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
          className="input-field px-3 py-2 text-xs" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
          className="input-field px-3 py-2 text-xs" />

        <button onClick={resetFilters}
          className="ml-auto text-xs text-cyan-400 hover:underline font-medium">
          Clear
        </button>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array(6).fill(0).map((_, i) => (
            <div key={i} className="bg-gray-900/70 border border-gray-800/60 rounded-2xl p-3 animate-pulse">
              <div className="h-3 bg-gray-800 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-800 rounded w-3/4" />
            </div>
          ))
        ) : filteredSorted.length === 0 ? (
          <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl py-12 text-center text-gray-600">
            <Database size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No sales match these filters yet</p>
          </div>
        ) : filteredSorted.map(s => (
          <div key={s.id} className="bg-gray-900/70 border border-gray-800/60 rounded-2xl p-3 flex gap-3">
            {s.image_url ? (
              <img src={s.image_url} alt="" className="w-14 h-18 object-cover rounded border border-gray-800 shrink-0"
                style={{ height: '72px' }}
                onError={(e) => { e.target.style.display = 'none' }} />
            ) : (
              <div className="w-14 shrink-0 rounded bg-gray-800/50 border border-gray-800 flex items-center justify-center text-[9px] text-gray-600"
                style={{ height: '72px' }}>No img</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-bold text-white truncate">{s.driver_name || '—'}</span>
                <span className="text-sm font-black text-emerald-400 whitespace-nowrap"
                  title={s.shipping_cost ? `Item $${s.sale_price?.toFixed(2)} + ship $${s.shipping_cost?.toFixed(2)}` : undefined}>
                  ${(s.total_cost ?? s.sale_price)?.toFixed(2)}
                  {s.shipping_cost > 0 && (
                    <span className="text-[10px] text-gray-500 font-medium ml-1">(+${s.shipping_cost?.toFixed(2)} ship)</span>
                  )}
                </span>
              </div>
              <div className="text-[11px] text-cyan-300 truncate mb-1">{s.parallel || '—'}</div>
              <div className="text-[11px] text-gray-400 line-clamp-2 mb-1.5">{s.title}</div>
              <div className="flex items-center gap-2 flex-wrap">
                {s.grade ? (
                  <span className="px-1.5 py-0.5 rounded bg-amber-600/15 text-amber-400 border border-amber-600/30 font-bold text-[10px]">
                    {s.grade}
                  </span>
                ) : (
                  <span className="text-gray-500 text-[10px]">Raw</span>
                )}
                <span className="text-[10px] text-gray-500">
                  {s.sale_date ? new Date(s.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                </span>
                <button
                  onClick={(e) => shareSale(e, s)}
                  title="Share sale"
                  className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                >
                  <Share2 size={11} />
                </button>
                {s.ebay_url && (
                  <a href={s.ebay_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gray-800 text-gray-400">
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800/70">
              <tr>
                <SortHeader field="sale_date">Date</SortHeader>
                <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-left">Image</th>
                <SortHeader field="driver_name">Driver</SortHeader>
                <SortHeader field="parallel">Parallel</SortHeader>
                <SortHeader field="grade">Grade</SortHeader>
                <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-left">Title</th>
                <SortHeader field="sale_price" align="right">Price</SortHeader>
                <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-center">eBay</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(12).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-gray-800/40 animate-pulse">
                    {Array(8).fill(0).map((_, j) => (
                      <td key={j} className="px-3 py-3"><div className="h-3 bg-gray-800 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : filteredSorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-gray-600">
                    <Database size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No sales match these filters yet</p>
                    <p className="text-xs mt-1 opacity-60">The database grows with each cron run (every 30 min).</p>
                  </td>
                </tr>
              ) : filteredSorted.map(s => (
                <tr key={s.id} className="border-b border-gray-800/40 hover:bg-gray-800/40 transition-colors">
                  <td className="px-3 py-2 text-xs text-gray-300 whitespace-nowrap">
                    {s.sale_date ? new Date(s.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {s.image_url ? (
                      <img src={s.image_url} alt="" className="w-10 h-12 object-cover rounded border border-gray-800"
                        onError={(e) => { e.target.style.display = 'none' }} />
                    ) : (
                      <div className="w-10 h-12 rounded bg-gray-800/50 border border-gray-800 flex items-center justify-center text-[9px] text-gray-600">No img</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold text-white whitespace-nowrap">{s.driver_name || '—'}</td>
                  <td className="px-3 py-2 text-xs text-cyan-300 whitespace-nowrap">{s.parallel || '—'}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {s.grade ? (
                      <span className="px-2 py-0.5 rounded bg-amber-600/15 text-amber-400 border border-amber-600/30 font-bold text-[10px]">
                        {s.grade}
                      </span>
                    ) : (
                      <span className="text-gray-500 text-[10px]">Raw</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 max-w-md truncate" title={s.title}>{s.title}</td>
                  <td className="px-3 py-2 text-xs font-black text-emerald-400 text-right whitespace-nowrap"
                    title={s.shipping_cost ? `Item $${s.sale_price?.toFixed(2)} + ship $${s.shipping_cost?.toFixed(2)}` : undefined}>
                    ${(s.total_cost ?? s.sale_price)?.toFixed(2)}
                    {s.shipping_cost > 0 && (
                      <div className="text-[9px] text-gray-500 font-medium">+${s.shipping_cost?.toFixed(2)} ship</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={(e) => shareSale(e, s)}
                        title="Share sale"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                      >
                        <Share2 size={12} />
                      </button>
                      {s.ebay_url && (
                        <a href={s.ebay_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-800 hover:bg-cyan-600/20 text-gray-400 hover:text-cyan-400 transition-colors">
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination (shared) */}
      {total > PAGE_SIZE && (
        <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl flex items-center justify-between px-3 md:px-4 py-3 flex-wrap gap-2">
          <span className="text-[11px] md:text-xs text-gray-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-gray-300 transition-colors">
              Prev
            </button>
            <span className="text-xs text-gray-500 px-1">{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-gray-300 transition-colors">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Breakdown panels */}
      {stats && stats.top_drivers?.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BreakdownPanel title="Top Drivers by Volume" items={stats.top_drivers}
            renderItem={d => ({ label: d.driver, value: d.count, sub: `$${Math.round(d.total_value).toLocaleString()}` })}
            accent="cyan" />
          <BreakdownPanel title="By Parallel" items={stats.by_parallel}
            renderItem={p => ({
              label: p.parallel,
              value: p.count,
              sub: p.low_confidence
                ? `thin data (n=${p.count})`
                : `median $${Math.round(p.median_price ?? p.avg_price)} · avg $${Math.round(p.avg_price)}`,
            })}
            accent="violet" />
        </div>
      )}
    </div>
  )
}

function StatBox({ icon: Icon, label, value, sub, color }) {
  const colors = {
    cyan: 'text-cyan-400 bg-cyan-600/10 border-cyan-600/30',
    emerald: 'text-emerald-400 bg-emerald-600/10 border-emerald-600/30',
    yellow: 'text-yellow-400 bg-yellow-600/10 border-yellow-600/30',
    violet: 'text-violet-400 bg-violet-600/10 border-violet-600/30',
  }
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="opacity-80" />
        <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      </div>
      <div className="text-xl font-black text-white truncate">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

function BreakdownPanel({ title, items, renderItem, accent }) {
  return (
    <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl p-4">
      <h3 className="text-sm font-black text-white mb-3">{title}</h3>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {items.slice(0, 10).map((it, i) => {
          const { label, value, sub } = renderItem(it)
          return (
            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-800/40">
              <span className="text-xs text-gray-300 truncate flex-1">{label || '—'}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[10px] text-gray-500">{sub}</span>
                <span className={`text-xs font-black text-${accent}-400 min-w-10 text-right`}>{value}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
