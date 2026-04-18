import { useState, useEffect, useCallback } from 'react'
import { Search, Zap, Bookmark, RefreshCw, Gavel, SlidersHorizontal } from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import AuctionModal from '../components/AuctionModal'
import { swrFetch } from '../lib/cache'
import { matchesParallel } from '../lib/parallels'
import { useVisibilityInterval, useProgressiveRender } from '../lib/hooks'
import { seriesOf, teamOf, ALL_TEAMS } from '../lib/drivers'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const SORTS = [
  { value: 'ending', label: 'Ending Soonest' },
  { value: 'rarest_ending', label: 'Rarest → Ending' },
  { value: 'snipe_score', label: 'Best Snipe Score' },
  { value: 'price_low', label: 'Price: Low → High' },
  { value: 'price_high', label: 'Price: High → Low' },
]

const PARALLELS = [
  'All', 'No Base',
  // Inserts
  'Autograph', 'Vegas at Night', 'Neon Nations', 'Floor It', 'Speed Wheels', 'Top Speed',
  'Four & More', 'Diamond 75th', 'Helix', 'Ultrasonic', 'The Grail', 'Futuro',
  'The Chain', 'The Grid', 'Helmet Collection', 'Speed Demons', 'Ace of Trades',
  // Numbered parallels
  'SuperFractor', 'Red /5', 'Black /10', 'Orange /25', 'Gold /50', 'F1 75th /75',
  'Green /99', 'Blue /150', 'Aqua /199', 'Pink /250', 'Teal /299',
  // Base parallels
  'Prism Refractor', 'Refractor', 'B&W Ray Wave', 'B&W Lazer', 'Checker Flag',
]
const PRINT_RUNS = ['Any', '/5', '/25', '/50', '/99', '/150']
const LISTING_TYPES = ['All', 'Auction', 'Buy It Now']
const FORMULA_TYPES = ['All', 'F1', 'F2', 'F3', 'Legends']

const RARITY = {
  'Autograph': 100, 'Red /5': 95, 'Orange /25': 85, 'Gold /50': 80,
  'Green /99': 75, 'Blue /150': 70, 'Prism Refractor': 65, 'Refractor': 55, 'Base': 0,
}
const rarityOf = a => RARITY[a.card?.parallel] ?? 30
const ROOKIES = new Set(['Andrea Kimi Antonelli', 'Gabriel Bortoleto', 'Oliver Bearman', 'Jack Doohan', 'Isack Hadjar', 'Liam Lawson'])
const isAuction = a => { const o = a.buying_options || []; return o.includes('AUCTION') }
const isBIN = a => { const o = a.buying_options || []; return o.includes('FIXED_PRICE') || o.includes('BEST_OFFER') }

export default function Auctions() {
  const [auctions, setAuctions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('ending')
  const [filterParallel, setFilterParallel] = useState('All')
  const [printRun, setPrintRun] = useState('Any')
  const [listingType, setListingType] = useState('All')
  const [filterSnipe, setFilterSnipe] = useState(false)
  const [filterWatchlist, setFilterWatchlist] = useState(false)
  const [filterRookie, setFilterRookie] = useState(false)
  const [formulaType, setFormulaType] = useState('All')
  const [teamFilter, setTeamFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    swrFetch(
      `${API}/api/auctions?limit=500&status=active&buying=auction`,
      d => { setAuctions(d.auctions || d || []); setLoading(false) },
      () => setRefreshing(false)
    )
  }, [])

  useEffect(() => { load() }, [load])
  useVisibilityInterval(() => load(), 30_000)

  const handleWatchlist = (id, w) =>
    setAuctions(prev => prev.map(a => a.id === id ? { ...a, status: w ? 'watchlist' : 'active' } : a))

  const filtered = auctions
    .filter(a => {
      if (!isAuction(a)) return false
      if ((a.time_left || 0) <= 0) return false
      if (formulaType !== 'All' && seriesOf(a) !== formulaType) return false
      if (teamFilter !== 'All' && teamOf(a) !== teamFilter) return false
      if (!matchesParallel(a, filterParallel)) return false
      if (printRun !== 'Any') {
        // Match exact print run like "/5" without matching "/50" or "/150"
        const re = new RegExp(`${printRun.replace('/', '\\/')}(?!\\d)`)
        if (!re.test(a.title || '')) return false
      }
      if (filterSnipe && !a.snipe_eligible) return false
      if (filterWatchlist && a.status !== 'watchlist') return false
      if (filterRookie && !ROOKIES.has(a.card?.driver_name)) return false
      if (search) {
        const q = search.toLowerCase()
        return a.title?.toLowerCase().includes(q) || a.card?.driver_name?.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'ending') return a.time_left - b.time_left
      if (sortBy === 'rarest_ending') { const rd = rarityOf(b) - rarityOf(a); return rd !== 0 ? rd : a.time_left - b.time_left }
      if (sortBy === 'snipe_score') return (b.snipe_score || 0) - (a.snipe_score || 0)
      if (sortBy === 'price_low') return a.current_price - b.current_price
      if (sortBy === 'price_high') return b.current_price - a.current_price
      return 0
    })

  const snipeCount = filtered.filter(a => a.snipe_eligible).length
  const { visibleCount, sentinelRef } = useProgressiveRender(filtered.length, 60, 40)

  return (
    <div className="space-y-4 max-w-[1700px]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-1 h-7 bg-red-600 rounded-full shrink-0" />
        <h1 className="text-2xl font-black text-white tracking-tight">Live Auctions</h1>
        {!loading && (
          <>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-gray-800 text-gray-300 border border-gray-700/50">
              {filtered.length} listings
            </span>
            {snipeCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl bg-red-600/15 text-red-400 border border-red-600/30">
                <Zap size={10} fill="currentColor" /> {snipeCount} snipeable
              </span>
            )}
          </>
        )}
        <button onClick={() => load(true)} className="ml-auto p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative min-w-44">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Driver, title…"
            className="input-field w-full pl-8 pr-3 py-2 text-xs" />
        </div>

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        {/* Formula type */}
        <select value={formulaType} onChange={e => setFormulaType(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {FORMULA_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Series' : t}</option>)}
        </select>

        {/* Team */}
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {ALL_TEAMS.map(t => <option key={t} value={t}>{t === 'All' ? 'All Teams' : t}</option>)}
        </select>

        {/* Parallel */}
        <select value={filterParallel} onChange={e => setFilterParallel(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PARALLELS.map(p => <option key={p} value={p}>{p === 'All' ? 'All Parallels' : p === 'No Base' ? 'No Base Cards' : p}</option>)}
        </select>

        {/* Print run */}
        <select value={printRun} onChange={e => setPrintRun(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PRINT_RUNS.map(p => <option key={p} value={p}>{p === 'Any' ? 'Any Print Run' : p}</option>)}
        </select>

        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        {/* Toggle pills */}
        {[
          { label: '⭐ Rookies', active: filterRookie, set: setFilterRookie },
          { label: '⚡ Snipe Only', active: filterSnipe, set: setFilterSnipe },
          { label: '🔖 Watchlist', active: filterWatchlist, set: setFilterWatchlist },
        ].map(({ label, active, set }) => (
          <button key={label} onClick={() => set(!active)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              active ? 'bg-red-600/15 text-red-400 border border-red-600/30' : 'bg-gray-800/60 text-gray-500 hover:text-gray-200 border border-transparent hover:border-gray-700/50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
          {Array(18).fill(0).map((_, i) => <div key={i} className="bg-gray-900 rounded-2xl border border-gray-800 h-72 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-20 text-gray-600">
          <Gavel size={36} className="mb-4 opacity-20" />
          <p className="text-sm font-medium">No live auctions right now</p>
          <p className="text-xs text-gray-600 mt-1">Auction listings sync every hour — check back soon</p>
          <button onClick={() => { setFilterParallel('All'); setSearch(''); setPrintRun('Any'); setFormulaType('All'); setFilterSnipe(false); setFilterRookie(false); setFilterWatchlist(false) }}
            className="mt-3 text-xs text-red-400 hover:underline">Clear filters</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {filtered.slice(0, visibleCount).map(a => (
              <AuctionCard key={a.id} auction={a} onWatchlistChange={handleWatchlist} onClick={() => setSelected(a)} />
            ))}
          </div>
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="py-6 text-center text-xs text-gray-600">
              Loading more… ({visibleCount} / {filtered.length})
            </div>
          )}
        </>
      )}

      {selected && <AuctionModal auction={selected} onClose={() => setSelected(null)} onWatchlistChange={handleWatchlist} />}
    </div>
  )
}
