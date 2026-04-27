import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { Search, Tag, Bookmark, RefreshCw, ExternalLink, MessageSquare } from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import AuctionModal from '../components/AuctionModal'
import ThemeToggle from '../components/ThemeToggle'
import { swrFetch } from '../lib/cache'
import { matchesParallel, AUTO_VARIANTS } from '../lib/parallels'
import { useVisibilityInterval, useProgressiveRender } from '../lib/hooks'
import { seriesOf, teamOf, ALL_TEAMS } from '../lib/drivers'
import { applySeasonFilter } from '../lib/season'

const API = import.meta.env.VITE_API_URL || ''

const SORTS = [
  { value: 'best_value', label: 'Best Value (snipe + comps)' },
  { value: 'price_high', label: 'Price: High → Low' },
  { value: 'price_low', label: 'Price: Low → High' },
  { value: 'best_offer', label: 'Best Offer First' },
  { value: 'rarest', label: 'Rarest First' },
]

// Composite "is this worth buying" score:
//   60% snipe_score (already computed against median by backend)
//   30% rarity tier (numbered parallels score higher)
//   10% bonus when row has scarcity_count <= 99 (rare)
function valueScore(a) {
  const snipe = a.snipe_score || 0
  const rarity = (() => {
    const t = a.scarcity_tier
    if (t === 'S' || t === 'A+') return 100
    if (t === 'A' || t === 'A-') return 80
    if (t === 'B+' || t === 'B') return 60
    if (t === 'B-') return 40
    if (t === 'C+' || t === 'C') return 25
    return 10
  })()
  const rareBonus = (a.scarcity_count != null && a.scarcity_count <= 99) ? 100 : 0
  return snipe * 0.6 + rarity * 0.3 + rareBonus * 0.1
}

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
const FORMULA_TYPES = ['All', 'F1', 'F2', 'F3', 'Legends']

const RARITY = {
  'Autograph': 100, 'Red /5': 95, 'Orange /25': 85, 'Gold /50': 80,
  'Green /99': 75, 'Blue /150': 70, 'Prism Refractor': 65, 'Refractor': 55, 'Base': 0,
}
const rarityOf = a => RARITY[a.card?.parallel] ?? 30
const ROOKIES = new Set(['Andrea Kimi Antonelli', 'Gabriel Bortoleto', 'Oliver Bearman', 'Jack Doohan', 'Isack Hadjar', 'Liam Lawson'])
const isBIN = a => { const o = a.buying_options || []; return (o.includes('FIXED_PRICE') || o.includes('BEST_OFFER')) && !o.includes('AUCTION') }

// Same lot filter as Auctions page — no multi-card bundles.
const LOT_RE = /\b(lot\s*(of\s*)?\d*|lot\*?\d+|\d+\s*(card|pc|pieces?|cards?)\s*(lot|bundle|set)?|\(\d+\)\s*cards?|bundle|\d+\s*card\s*lot|pack\s*of\s*\d+|team\s*set|card\s*lot)\b/i
const isCardLot = (a) => {
  const t = (a?.title || '').toLowerCase()
  if (LOT_RE.test(t)) return true
  if (/\b[x×]\s*[2-9]\b|\b[2-9]\s*[x×]\b/.test(t)) return true
  return false
}

export default function BuyItNow() {
  const [auctions, setAuctions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('best_value')
  const [filterParallel, setFilterParallel] = useState('No Base')
  const [autoVariant, setAutoVariant] = useState('Any')
  const [printRun, setPrintRun] = useState('Any')
  const [filterWatchlist, setFilterWatchlist] = useState(false)
  const [filterRookie, setFilterRookie] = useState(false)
  const [filterBestOffer, setFilterBestOffer] = useState(false)
  const [filterStrongBuy, setFilterStrongBuy] = useState(false)
  const [filterPremium, setFilterPremium] = useState(true)
  const [formulaType, setFormulaType] = useState('F1')
  const [teamFilter, setTeamFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    swrFetch(
      `${API}/api/auctions/with-verdicts?limit=500&status=active&buying=bin`,
      d => { setAuctions(applySeasonFilter(d.auctions || d || [])); setLoading(false) },
      () => setRefreshing(false)
    )
  }, [])

  useEffect(() => { load() }, [load])
  useVisibilityInterval(() => load(), 30_000)

  const handleWatchlist = (id, w) =>
    setAuctions(prev => prev.map(a => a.id === id ? { ...a, status: w ? 'watchlist' : 'active' } : a))

  const filtered = auctions
    .filter(a => {
      if (!isBIN(a)) return false
      if (isCardLot(a)) return false
      if (formulaType !== 'All' && seriesOf(a) !== formulaType) return false
      if (teamFilter !== 'All' && teamOf(a) !== teamFilter) return false
      if (!matchesParallel(a, filterParallel, autoVariant)) return false
      if (printRun !== 'Any') {
        const re = new RegExp(`${printRun.replace('/', '\\/')}(?!\\d)`)
        if (!re.test(a.title || '')) return false
      }
      if (filterWatchlist && a.status !== 'watchlist') return false
      if (filterRookie && !ROOKIES.has(a.card?.driver_name)) return false
      if (filterBestOffer && !(a.buying_options || []).includes('BEST_OFFER')) return false
      if (filterStrongBuy && !(a.verdict === 'STRONG_BUY' || a.verdict === 'GOOD_BUY')) return false
      // Premium: hide low-end BIN — buy_now (or current) price must be at least $150
      if (filterPremium && Math.max(a.buy_now_price || 0, a.current_price || 0) < 150) return false
      if (search) {
        const q = search.toLowerCase()
        return a.title?.toLowerCase().includes(q) || a.card?.driver_name?.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'best_value') return valueScore(b) - valueScore(a)
      if (sortBy === 'price_low') return a.current_price - b.current_price
      if (sortBy === 'price_high') return b.current_price - a.current_price
      if (sortBy === 'best_offer') {
        const aBO = (a.buying_options || []).includes('BEST_OFFER') ? 1 : 0
        const bBO = (b.buying_options || []).includes('BEST_OFFER') ? 1 : 0
        return bBO - aBO
      }
      if (sortBy === 'rarest') return rarityOf(b) - rarityOf(a)
      return 0
    })

  const bestOfferCount = filtered.filter(a => (a.buying_options || []).includes('BEST_OFFER')).length
  const strongBuyCount = auctions.filter(a => a.verdict === 'STRONG_BUY' || a.verdict === 'GOOD_BUY').length
  const { visibleCount, sentinelRef } = useProgressiveRender(filtered.length, 60, 40)

  return (
    <div className="space-y-4 max-w-[1700px]">
      {/* Mobile deals toggle (Live Auctions / Buy It Now) — hidden on md+ since sidebar shows both */}
      <div className="md:hidden flex gap-2 sticky top-0 bg-gray-950 z-20 py-2 -mx-3 px-3 border-b border-gray-800">
        <NavLink
          to="/auctions"
          end
          className={({ isActive }) =>
            `flex-1 text-center px-3 py-2.5 rounded-xl text-sm font-black transition-all ${
              isActive
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
                : 'bg-gray-800 text-gray-300 active:bg-gray-700'
            }`
          }
        >
          🔴 Live Auctions
        </NavLink>
        <NavLink
          to="/bin"
          className={({ isActive }) =>
            `flex-1 text-center px-3 py-2.5 rounded-xl text-sm font-black transition-all ${
              isActive
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'bg-gray-800 text-gray-300 active:bg-gray-700'
            }`
          }
        >
          💰 Buy It Now
        </NavLink>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-1 h-7 bg-green-600 rounded-full shrink-0" />
        <h1 className="text-2xl font-black text-white tracking-tight">Buy It Now</h1>
        {!loading && (
          <>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-gray-800 text-gray-300 border border-gray-700/50">
              {filtered.length} listings
            </span>
            {bestOfferCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl bg-blue-600/15 text-blue-400 border border-blue-600/30">
                <MessageSquare size={10} /> {bestOfferCount} accepting offers
              </span>
            )}
            {strongBuyCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl bg-green-600/15 text-green-400 border border-green-600/30">
                🔥 {strongBuyCount} strong buys
              </span>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button onClick={() => load(true)} className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
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

        <select value={filterParallel} onChange={e => setFilterParallel(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PARALLELS.map(p => <option key={p} value={p}>{p === 'All' ? 'All Parallels' : p === 'No Base' ? 'No Base Cards' : p}</option>)}
        </select>

        {filterParallel === 'Autograph' && (
          <select value={autoVariant} onChange={e => setAutoVariant(e.target.value)}
            className="input-field px-3 py-2 text-xs cursor-pointer border-yellow-500/40">
            {AUTO_VARIANTS.map(v => <option key={v} value={v}>{v === 'Any' ? 'Any Auto Type' : `Auto · ${v}`}</option>)}
          </select>
        )}

        <select value={printRun} onChange={e => setPrintRun(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PRINT_RUNS.map(p => <option key={p} value={p}>{p === 'Any' ? 'Any Print Run' : p}</option>)}
        </select>

        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        {[
          { label: '💎 Premium ($150+)', active: filterPremium, set: setFilterPremium, activeCls: 'bg-amber-600/25 text-amber-300 border border-amber-500/50' },
          { label: '🔥 Strong Buys', active: filterStrongBuy, set: setFilterStrongBuy, activeCls: 'bg-green-600/25 text-green-400 border border-green-600/50' },
          { label: '💬 Best Offer Only', active: filterBestOffer, set: setFilterBestOffer },
          { label: '⭐ Rookies', active: filterRookie, set: setFilterRookie },
          { label: '🔖 Watchlist', active: filterWatchlist, set: setFilterWatchlist },
        ].map(({ label, active, set, activeCls }) => (
          <button key={label} onClick={() => set(!active)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              active ? (activeCls || 'bg-green-600/15 text-green-400 border border-green-600/30') : 'bg-gray-800/60 text-gray-500 hover:text-gray-200 border border-transparent hover:border-gray-700/50'
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
          <Tag size={36} className="mb-4 opacity-20" />
          <p className="text-sm font-medium">No BIN listings match your filters</p>
          <button onClick={() => { setFilterParallel('No Base'); setSearch(''); setPrintRun('Any'); setFormulaType('F1'); setFilterBestOffer(false); setFilterRookie(false); setFilterWatchlist(false) }}
            className="mt-3 text-xs text-green-400 hover:underline">Clear filters</button>
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
