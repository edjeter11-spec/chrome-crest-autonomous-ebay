import { useState, useEffect, useCallback } from 'react'
import { Search, Zap, Bookmark, RefreshCw, Gavel, SlidersHorizontal } from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import AuctionModal from '../components/AuctionModal'
import ThemeToggle from '../components/ThemeToggle'
import { swrFetch } from '../lib/cache'
import { matchesParallel, AUTO_VARIANTS } from '../lib/parallels'
import { useVisibilityInterval, useProgressiveRender, usePersistedState } from '../lib/hooks'
import { seriesOf, teamOf, ALL_TEAMS } from '../lib/drivers'
import { applySeasonFilter } from '../lib/season'

const API = import.meta.env.VITE_API_URL || ''

const SORTS = [
  { value: 'ending', label: 'Ending Soonest' },
  { value: 'rarest', label: 'Rarest First' },
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

// Reject card lots / multi-card bundles — user wants single cards only.
// Matches: "Lot of 5", "5 card lot", "2x", "Lot*7", "(3) cards", "bundle",
// "team set", "5 cards", "2 card", "pack of", "10pc", etc.
const LOT_RE = /\b(lot\s*(of\s*)?\d*|lot\*?\d+|\d+\s*[\-xX]\s*\d+|\d+\s*(card|pc|pieces?|cards?)\s*(lot|bundle|set)?|\(\d+\)\s*cards?|bundle|\d+\s*card\s*lot|pack\s*of\s*\d+|team\s*set|card\s*lot)\b/i
const isCardLot = (a) => {
  const t = (a?.title || '').toLowerCase()
  if (LOT_RE.test(t)) return true
  // Also catch "2x", "x2", "x 3" style
  if (/\b[x×]\s*[2-9]\b|\b[2-9]\s*[x×]\b/.test(t)) return true
  return false
}

export default function Auctions() {
  const [auctions, setAuctions] = useState([])
  const [loading, setLoading] = useState(true)
  // Persisted filter state (localStorage-backed — fail-gracefully)
  const [filters, setFilters] = usePersistedState('cc_filters_auctions_v2', {
    search: '', sortBy: 'ending', filterParallel: 'All', printRun: 'Any',
    listingType: 'All', filterSnipe: false, filterWatchlist: false,
    filterRookie: false, formulaType: 'F1', teamFilter: 'All',
    filterStrongBuy: false, autoVariant: 'Any',
  })
  const setF = (patch) => setFilters(prev => ({ ...prev, ...patch }))
  const { search, sortBy, filterParallel, printRun, listingType,
          filterSnipe, filterWatchlist, filterRookie, formulaType, teamFilter,
          filterStrongBuy, autoVariant } = filters
  const [selected, setSelected] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    swrFetch(
      `${API}/api/auctions/with-verdicts?limit=500&status=active&buying=auction`,
      d => { setAuctions(applySeasonFilter(d.auctions || d || [])); setLoading(false) },
      () => setRefreshing(false)
    )
  }, [])

  useEffect(() => { load() }, [load])
  useVisibilityInterval(() => load(), 30_000)

  const handleWatchlist = (id, w) =>
    setAuctions(prev => prev.map(a => a.id === id ? { ...a, status: w ? 'watchlist' : 'active' } : a))

  // end_time is naive UTC → append 'Z' so JS doesn't read as local time.
  const nowMs = Date.now()
  const trueTimeLeft = (a) => {
    if (a.end_time) {
      const s = String(a.end_time)
      const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
      const diff = Math.floor((new Date(hasTz ? s : s + 'Z').getTime() - nowMs) / 1000)
      if (!Number.isNaN(diff)) return diff
    }
    return a.time_left || 0
  }

  const filtered = auctions
    .map(a => ({ ...a, time_left: trueTimeLeft(a) }))
    .filter(a => {
      if (!isAuction(a)) return false
      if (a.time_left <= 0) return false
      if (isCardLot(a)) return false
      if (formulaType !== 'All' && seriesOf(a) !== formulaType) return false
      if (teamFilter !== 'All' && teamOf(a) !== teamFilter) return false
      if (!matchesParallel(a, filterParallel, autoVariant)) return false
      if (printRun !== 'Any') {
        // Match exact print run like "/5" without matching "/50" or "/150"
        const re = new RegExp(`${printRun.replace('/', '\\/')}(?!\\d)`)
        if (!re.test(a.title || '')) return false
      }
      if (filterSnipe && !a.snipe_eligible) return false
      if (filterWatchlist && a.status !== 'watchlist') return false
      if (filterRookie && !ROOKIES.has(a.card?.driver_name)) return false
      if (filterStrongBuy && !(a.verdict === 'STRONG_BUY' || a.verdict === 'GOOD_BUY')) return false
      if (search) {
        const q = search.toLowerCase()
        return a.title?.toLowerCase().includes(q) || a.card?.driver_name?.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'ending') return a.time_left - b.time_left
      if (sortBy === 'rarest') {
        const ra = a.scarcity_rank ?? 99, rb = b.scarcity_rank ?? 99
        return ra - rb
      }
      if (sortBy === 'rarest_ending') { const rd = rarityOf(b) - rarityOf(a); return rd !== 0 ? rd : a.time_left - b.time_left }
      if (sortBy === 'snipe_score') return (b.snipe_score || 0) - (a.snipe_score || 0)
      if (sortBy === 'price_low') return a.current_price - b.current_price
      if (sortBy === 'price_high') return b.current_price - a.current_price
      return 0
    })

  // Emit ItemList JSON-LD for the first 20 visible auctions (SEO).
  useEffect(() => {
    const top = filtered.slice(0, 20)
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: top.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: a.title,
          image: a.image_url,
          offers: {
            '@type': 'Offer',
            price: a.current_price,
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            url: a.ebay_affiliate_url || a.affiliate_url || a.item_url,
          },
        },
      })),
    }
    const existing = document.getElementById('auctions-jsonld')
    if (existing) existing.remove()
    const tag = document.createElement('script')
    tag.type = 'application/ld+json'
    tag.id = 'auctions-jsonld'
    tag.textContent = JSON.stringify(payload)
    document.head.appendChild(tag)
    return () => { const el = document.getElementById('auctions-jsonld'); if (el) el.remove() }
  }, [auctions, search, sortBy, filterParallel, printRun, listingType, filterSnipe, filterWatchlist, filterRookie, formulaType, teamFilter, filterStrongBuy, autoVariant])

  const snipeCount = filtered.filter(a => a.snipe_eligible).length
  const strongBuyCount = auctions.filter(a => a.verdict === 'STRONG_BUY' || a.verdict === 'GOOD_BUY').length
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
              <button
                onClick={() => setF({ filterSnipe: !filterSnipe })}
                className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl border transition-colors ${filterSnipe ? 'bg-red-600/40 text-red-200 border-red-500/60' : 'bg-red-600/15 text-red-400 border-red-600/30 hover:bg-red-600/25'}`}
                aria-pressed={filterSnipe}
                title="Filter to snipeable auctions only"
              >
                <Zap size={10} fill="currentColor" /> {snipeCount} snipeable
              </button>
            )}
            {strongBuyCount > 0 && (
              <button
                onClick={() => setF({ filterStrongBuy: !filterStrongBuy })}
                className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl border transition-colors ${filterStrongBuy ? 'bg-green-600/40 text-green-200 border-green-500/60' : 'bg-green-600/15 text-green-400 border-green-600/30 hover:bg-green-600/25'}`}
                aria-pressed={filterStrongBuy}
                title="Filter to strong buys only"
              >
                🔥 {strongBuyCount} strong buys
              </button>
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
        {/* Search */}
        <div className="relative min-w-44">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setF({ search: e.target.value })}
            placeholder="Driver, title…"
            className="input-field w-full pl-8 pr-3 py-2 text-xs" />
        </div>

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        {/* Formula type */}
        <select value={formulaType} onChange={e => setF({ formulaType: e.target.value })}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {FORMULA_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Series' : t}</option>)}
        </select>

        {/* Team */}
        <select value={teamFilter} onChange={e => setF({ teamFilter: e.target.value })}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {ALL_TEAMS.map(t => <option key={t} value={t}>{t === 'All' ? 'All Teams' : t}</option>)}
        </select>

        {/* Parallel */}
        <select value={filterParallel} onChange={e => setF({ filterParallel: e.target.value })}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PARALLELS.map(p => <option key={p} value={p}>{p === 'All' ? 'All Parallels' : p === 'No Base' ? 'No Base Cards' : p}</option>)}
        </select>

        {/* Print run */}
        <select value={printRun} onChange={e => setF({ printRun: e.target.value })}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {PRINT_RUNS.map(p => <option key={p} value={p}>{p === 'Any' ? 'Any Print Run' : p}</option>)}
        </select>

        {/* Sort */}
        <select value={sortBy} onChange={e => setF({ sortBy: e.target.value })}
          className="input-field px-3 py-2 text-xs cursor-pointer">
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="w-px h-5 bg-gray-700/60 shrink-0" />

        {/* Toggle pills */}
        {[
          { label: '🔥 Strong Buys', active: filterStrongBuy, key: 'filterStrongBuy', activeCls: 'bg-green-600/20 text-green-400 border border-green-600/40' },
          { label: '⭐ Rookies', active: filterRookie, key: 'filterRookie' },
          { label: '⚡ Snipe Only', active: filterSnipe, key: 'filterSnipe' },
          { label: '🔖 Watchlist', active: filterWatchlist, key: 'filterWatchlist' },
        ].map(({ label, active, key, activeCls }) => (
          <button key={label} onClick={() => setF({ [key]: !active })}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              active ? (activeCls || 'bg-red-600/15 text-red-400 border border-red-600/30') : 'bg-gray-800/60 text-gray-500 hover:text-gray-200 border border-transparent hover:border-gray-700/50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Auto-variant sub-filter — only when parent filter is Autograph */}
      {filterParallel === 'Autograph' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pl-1 -mt-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold shrink-0 mr-1">Auto type:</span>
          {AUTO_VARIANTS.map(v => (
            <button key={v} onClick={() => setF({ autoVariant: v })}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition-colors ${
                autoVariant === v
                  ? 'bg-yellow-500 text-black border border-yellow-400'
                  : 'bg-gray-800/60 text-gray-400 border border-transparent hover:border-gray-700/50 hover:text-gray-200'
              }`}>
              {v}
            </button>
          ))}
        </div>
      )}

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
          <button onClick={() => setF({ filterParallel: 'All', search: '', printRun: 'Any', formulaType: 'F1', filterSnipe: false, filterRookie: false, filterWatchlist: false })}
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
