import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { Search, Zap, Bookmark, RefreshCw, Gavel, SlidersHorizontal, Target, Check, X } from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import AuctionModal from '../components/AuctionModal'
import ThemeToggle from '../components/ThemeToggle'
import { swrFetch } from '../lib/cache'
import { matchesParallel, AUTO_VARIANTS } from '../lib/parallels'
import { useVisibilityInterval, useProgressiveRender, usePersistedState } from '../lib/hooks'
import { seriesOf, teamOf, ALL_TEAMS } from '../lib/drivers'
import { applySeasonFilter } from '../lib/season'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'

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
  const [showSaveRule, setShowSaveRule] = useState(false)
  const [ruleToast, setRuleToast] = useState('')
  const { user } = useAuth() || { user: null }

  // Detect whether any filter is non-default so the "Save as Snipe Rule" CTA only
  // appears when there's actually something to save.
  const hasActiveFilter = (
    (filterParallel && filterParallel !== 'All') ||
    (printRun && printRun !== 'Any') ||
    (listingType && listingType !== 'All') ||
    (formulaType && formulaType !== 'F1' && formulaType !== 'All') ||
    (teamFilter && teamFilter !== 'All') ||
    (autoVariant && autoVariant !== 'Any') ||
    filterSnipe || filterWatchlist || filterRookie || filterStrongBuy ||
    (search && search.trim().length > 0)
  )

  const load = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    swrFetch(
      `${API}/api/auctions/with-verdicts?limit=500&status=active&buying=auction`,
      d => {
        const list = applySeasonFilter(d.auctions || d || [])
        setAuctions(list)
        setLoading(false)
        // Stale-data nudge: if the freshest listing is >10 min old, fire a
        // fire-and-forget background eBay refresh. Server-side rate-limits
        // per-IP to 1/5min, so spamming is harmless.
        try {
          const top = list[0]
          const lu = top?.last_updated
          if (lu) {
            const ts = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(lu) ? lu : lu + 'Z')
            if (!Number.isNaN(ts) && Date.now() - ts > 10 * 60_000) {
              if (!window.__cc_stale_refresh_fired) {
                window.__cc_stale_refresh_fired = true
                fetch(`${API}/api/auctions/refresh-stale`, { method: 'POST' })
                  .catch(() => {})
                  .finally(() => {
                    // Allow another attempt next full page load
                    setTimeout(() => { window.__cc_stale_refresh_fired = false }, 5 * 60_000)
                  })
              }
            }
          }
        } catch {}
      },
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
      // Real-time expiry detection: hide ended auctions from active list
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
            type="search"
            inputMode="search"
            autoCapitalize="off"
            autoCorrect="off"
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

        {user && hasActiveFilter && (
          <button
            onClick={() => setShowSaveRule(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-600/40 transition-colors"
            title="Save the current filter combination as a Sniper rule"
          >
            <Target size={12} /> Save as Snipe Rule
          </button>
        )}
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
          {Array(12).fill(0).map((_, i) => (
            <div
              key={i}
              className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden animate-pulse flex flex-col"
            >
              <div className="h-44 bg-gray-800" />
              <div className="p-3 flex flex-col gap-2">
                <div className="h-3 bg-gray-800 rounded w-full" />
                <div className="h-3 bg-gray-800 rounded w-3/4" />
                <div className="h-5 bg-gray-800 rounded w-1/2 mt-1" />
                <div className="h-8 bg-gray-800 rounded mt-1" />
              </div>
            </div>
          ))}
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
              <AuctionCard
                key={a.id}
                auction={a}
                onWatchlistChange={handleWatchlist}
                onClick={() => setSelected(a)}
                onExpiry={(id) => {
                  // Auto-remove expired listing after 3s fade
                  setTimeout(() => {
                    setAuctions(prev => prev.filter(x => x.id !== id))
                  }, 3000)
                }}
              />
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

      {showSaveRule && (
        <SaveFilterAsSniperModal
          user={user}
          filters={filters}
          onClose={() => setShowSaveRule(false)}
          onSaved={(name) => { setShowSaveRule(false); setRuleToast(name || 'Snipe rule saved') }}
        />
      )}

      {ruleToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-gray-900 border border-green-600/40 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-600/30 border border-green-500/60 flex items-center justify-center shrink-0">
            <Check size={16} className="text-green-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">Snipe rule saved</div>
            <div className="text-[11px] text-gray-400 truncate">{ruleToast}</div>
          </div>
          <button onClick={() => setRuleToast('')} className="text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function SaveFilterAsSniperModal({ user, filters, onClose, onSaved }) {
  const [maxPrice, setMaxPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parallel = filters.filterParallel && filters.filterParallel !== 'All' ? filters.filterParallel : null
  const summaryParts = [
    filters.formulaType && filters.formulaType !== 'All' ? filters.formulaType : null,
    filters.teamFilter && filters.teamFilter !== 'All' ? filters.teamFilter : null,
    parallel,
    filters.autoVariant && filters.autoVariant !== 'Any' ? filters.autoVariant : null,
    filters.printRun && filters.printRun !== 'Any' ? filters.printRun : null,
    filters.filterSnipe ? 'Snipe-only' : null,
    filters.filterStrongBuy ? 'Strong Buys' : null,
    filters.filterRookie ? 'Rookies' : null,
    filters.search ? `"${filters.search}"` : null,
  ].filter(Boolean)
  const summary = summaryParts.length ? summaryParts.join(' · ') : 'All auctions'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!user || !supabaseReady) {
      setError('Sign in required to save rules.')
      return
    }
    setSaving(true)
    try {
      const row = {
        user_id: user.id,
        driver_name: null,
        parallel,
        grade: null,
        max_price: maxPrice ? Number(maxPrice) : null,
        max_percent_of_median: null,
        ending_soon_only: false,
        max_per_day: 3,
        active: true,
        name: maxPrice ? `${summary} · <$${maxPrice}` : summary,
      }
      const { error: err } = await supabase.from('user_snipe_rules').insert(row)
      if (err) { setError(err.message); setSaving(false); return }
      onSaved(row.name)
    } catch (e) {
      setError(e?.message || 'Error creating rule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800/60 max-w-sm w-full p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <Target size={18} className="text-red-500" />
            Save Filters as Snipe Rule
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-semibold">Rule Preview</label>
            <div className="bg-gray-800/50 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-300 space-y-1">
              <div><span className="text-gray-500">Matches:</span> <span className="text-white font-semibold">{summary}</span></div>
              {parallel && <div><span className="text-gray-500">Parallel:</span> <span className="text-white">{parallel}</span></div>}
              <div><span className="text-gray-500">Driver:</span> <span className="text-gray-400 italic">any</span></div>
              <div><span className="text-gray-500">Max/day:</span> <span className="text-white">3</span></div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-semibold">Max Price $ <span className="text-gray-600 normal-case">(optional)</span></label>
            <input type="number" step="1" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="e.g. 250" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-semibold text-sm px-4 py-2.5 rounded-lg">
              {saving ? 'Saving…' : 'Save Rule'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-sm px-4 py-2.5 rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
