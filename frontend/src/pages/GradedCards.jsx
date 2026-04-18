import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Shield, Gavel, Tag, RefreshCw } from 'lucide-react'
import AuctionCard from '../components/AuctionCard'
import AuctionModal from '../components/AuctionModal'
import { swrFetch } from '../lib/cache'
import { useVisibilityInterval, useProgressiveRender } from '../lib/hooks'
import { seriesOf, teamOf, ALL_TEAMS } from '../lib/drivers'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const GRADERS = ['All', 'PSA', 'BGS', 'SGC', 'CGC']
const GRADES = ['All', '10', '9.5', '9', '8.5', '8', '7', '6']
const FORMULA_TYPES = ['All', 'F1', 'F2', 'F3', 'Legends']

const isGraded = a => {
  const t = (a.title || '').toUpperCase()
  return /\b(PSA|BGS|SGC|CGC)\s*\d/.test(t) || /\bGEM\s*MT/.test(t)
}
const graderOf = a => {
  const t = (a.title || '').toUpperCase()
  if (t.includes('PSA')) return 'PSA'
  if (t.includes('BGS')) return 'BGS'
  if (t.includes('SGC')) return 'SGC'
  if (t.includes('CGC')) return 'CGC'
  return ''
}
const gradeOf = a => {
  const m = (a.title || '').toUpperCase().match(/\b(?:PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7|6)\b/)
  return m ? m[1] : ''
}
const isAuction = a => (a.buying_options || []).includes('AUCTION')
const isBIN = a => {
  const o = a.buying_options || []
  return (o.includes('FIXED_PRICE') || o.includes('BEST_OFFER')) && !o.includes('AUCTION')
}

export default function GradedCards() {
  const [auctions, setAuctions] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [grader, setGrader] = useState('All')
  const [grade, setGrade] = useState('All')
  const [formulaType, setFormulaType] = useState('All')
  const [teamFilter, setTeamFilter] = useState('All')
  const [selected, setSelected] = useState(null)

  const load = useCallback((showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    swrFetch(
      `${API}/api/auctions?limit=500&status=active`,
      d => { setAuctions(d.auctions || d || []); setLoading(false) },
      () => setRefreshing(false)
    )
  }, [])
  useEffect(() => { load() }, [load])
  useVisibilityInterval(() => load(), 30_000)

  const graded = useMemo(() => {
    return auctions.filter(a => {
      if (!isGraded(a)) return false
      if (grader !== 'All' && graderOf(a) !== grader) return false
      if (grade !== 'All' && gradeOf(a) !== grade) return false
      if (formulaType !== 'All' && seriesOf(a) !== formulaType) return false
      if (teamFilter !== 'All' && teamOf(a) !== teamFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!(a.title?.toLowerCase().includes(q) || a.card?.driver_name?.toLowerCase().includes(q))) return false
      }
      return true
    })
  }, [auctions, grader, grade, formulaType, teamFilter, search])

  const bins = useMemo(
    () => graded.filter(isBIN).sort((a, b) => a.current_price - b.current_price),
    [graded]
  )
  const auctionsList = useMemo(
    () => graded.filter(a => isAuction(a) && (a.time_left || 0) > 0)
                .sort((a, b) => a.time_left - b.time_left),
    [graded]
  )

  const auctionsRender = useProgressiveRender(auctionsList.length, 48, 36)
  const binsRender = useProgressiveRender(bins.length, 48, 36)

  if (loading) return (
    <div className="p-6">
      <div className="skeleton h-8 w-48 rounded mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {[...Array(10)].map((_, i) => <div key={i} className="skeleton h-72 rounded-2xl" />)}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-600/20 border border-yellow-500/30 flex items-center justify-center">
            <Shield size={18} className="text-yellow-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Graded Cards</h1>
            <p className="text-xs text-gray-500 mt-0.5">{graded.length} PSA/BGS/SGC listings on eBay</p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 flex items-center gap-2"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search driver or title…"
            className="input-field w-full pl-8 pr-3 py-2 text-xs"
          />
        </div>
        <select value={grader} onChange={e => setGrader(e.target.value)} className="input-field px-3 py-2 text-xs cursor-pointer">
          {GRADERS.map(g => <option key={g} value={g}>{g === 'All' ? 'All Graders' : g}</option>)}
        </select>
        <select value={grade} onChange={e => setGrade(e.target.value)} className="input-field px-3 py-2 text-xs cursor-pointer">
          {GRADES.map(g => <option key={g} value={g}>{g === 'All' ? 'All Grades' : `Grade ${g}`}</option>)}
        </select>
        <select value={formulaType} onChange={e => setFormulaType(e.target.value)} className="input-field px-3 py-2 text-xs cursor-pointer">
          {FORMULA_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Series' : t}</option>)}
        </select>
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="input-field px-3 py-2 text-xs cursor-pointer">
          {ALL_TEAMS.map(t => <option key={t} value={t}>{t === 'All' ? 'All Teams' : t}</option>)}
        </select>
      </div>

      {/* Auctions */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Gavel size={14} className="text-red-400" />
          <h2 className="text-base font-bold text-white">Graded Auctions</h2>
          <span className="text-xs text-gray-500">({auctionsList.length} ending soonest)</span>
        </div>
        {auctionsList.length === 0 ? (
          <div className="text-center py-10 bg-gray-900/40 rounded-2xl border border-gray-800/60">
            <Gavel size={24} className="mx-auto mb-2 text-gray-700" />
            <p className="text-sm text-gray-500">No live graded auctions right now</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {auctionsList.slice(0, auctionsRender.visibleCount).map(a => (
                <AuctionCard key={a.id} auction={a} onClick={() => setSelected(a)} />
              ))}
            </div>
            {auctionsRender.visibleCount < auctionsList.length && (
              <div ref={auctionsRender.sentinelRef} className="py-6 text-center text-xs text-gray-600">
                Loading more… ({auctionsRender.visibleCount} / {auctionsList.length})
              </div>
            )}
          </>
        )}
      </section>

      {/* BINs */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Tag size={14} className="text-green-400" />
          <h2 className="text-base font-bold text-white">Graded Buy It Now</h2>
          <span className="text-xs text-gray-500">({bins.length} listings, low→high)</span>
        </div>
        {bins.length === 0 ? (
          <div className="text-center py-10 bg-gray-900/40 rounded-2xl border border-gray-800/60">
            <Tag size={24} className="mx-auto mb-2 text-gray-700" />
            <p className="text-sm text-gray-500">No graded BIN listings right now</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {bins.slice(0, binsRender.visibleCount).map(a => (
                <AuctionCard key={a.id} auction={a} onClick={() => setSelected(a)} />
              ))}
            </div>
            {binsRender.visibleCount < bins.length && (
              <div ref={binsRender.sentinelRef} className="py-6 text-center text-xs text-gray-600">
                Loading more… ({binsRender.visibleCount} / {bins.length})
              </div>
            )}
          </>
        )}
      </section>

      {selected && <AuctionModal auction={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
