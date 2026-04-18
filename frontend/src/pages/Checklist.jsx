import { useEffect, useState, useMemo } from 'react'
import { CheckCircle2, Circle, Filter, Search } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const OWNED_KEY = 'cc_owned_cards'

function loadOwned() {
  try {
    const raw = localStorage.getItem(OWNED_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch { return new Set() }
}
function saveOwned(set) {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify([...set])) } catch {}
}

export default function Checklist() {
  const [data, setData] = useState(null)
  const [owned, setOwned] = useState(() => loadOwned())
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [onMarket, setOnMarket] = useState(false)

  useEffect(() => {
    swrFetch(`${API}/api/checklist/2025-topps-chrome-f1`, d => setData(d))
  }, [])

  const toggleOwn = (num) => {
    setOwned(prev => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num); else next.add(num)
      saveOwned(next)
      return next
    })
  }

  const cards = data?.cards || []
  const categories = useMemo(() => ['All', ...new Set(cards.map(c => c.category))], [cards])

  const filtered = useMemo(() => {
    return cards.filter(c => {
      if (category !== 'All' && c.category !== category) return false
      if (onlyMissing && owned.has(c.card_num)) return false
      if (onMarket && !c.on_market_now) return false
      if (search) {
        const s = search.toLowerCase()
        if (!c.driver.toLowerCase().includes(s) && !c.parallel.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [cards, category, onlyMissing, onMarket, search, owned])

  const ownedCount = cards.filter(c => owned.has(c.card_num)).length
  const totalValue = cards.reduce((s, c) => s + (owned.has(c.card_num) ? (c.latest_avg_price || 0) : 0), 0)
  const remainingValue = cards.reduce((s, c) => s + (!owned.has(c.card_num) ? (c.latest_avg_price || 0) : 0), 0)
  const completion = cards.length ? Math.round(ownedCount / cards.length * 100) : 0

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-purple-500 rounded-full shrink-0" />
          <h1 className="text-2xl font-black text-white tracking-tight">Set Checklist</h1>
        </div>
        <p className="text-xs text-gray-500 mt-2 ml-4">2025 Topps Chrome F1 · track ownership · values from live sold comps</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Completion</div>
          <div className="text-2xl font-black text-white tabular-nums">{completion}%</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{ownedCount} / {cards.length}</div>
          <div className="w-full bg-gray-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div className="bg-emerald-500 h-full" style={{ width: `${completion}%` }} />
          </div>
        </div>
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Collection Value</div>
          <div className="text-2xl font-black text-emerald-400 tabular-nums">${Math.round(totalValue).toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">based on 30d avg</div>
        </div>
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Missing Value</div>
          <div className="text-2xl font-black text-amber-400 tabular-nums">${Math.round(remainingValue).toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">to complete set</div>
        </div>
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Set Market Value</div>
          <div className="text-2xl font-black text-violet-400 tabular-nums">${Math.round(data?.total_market_value || 0).toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">all {cards.length} cards</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
        <Filter size={12} className="text-gray-500" />
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg px-2 py-1 border border-gray-700">
          <Search size={10} className="text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search driver / parallel"
            className="bg-transparent text-white text-xs w-40 focus:outline-none" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} className="accent-purple-500" />
          Hide owned
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={onMarket} onChange={e => setOnMarket(e.target.checked)} className="accent-emerald-500" />
          Only on market now
        </label>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} showing</span>
      </div>

      {/* List */}
      <div className="bg-gray-900/70 border border-gray-800 rounded-2xl overflow-hidden">
        {!data ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No cards match</div>
        ) : (
          <div className="divide-y divide-gray-800/60">
            {filtered.map(c => {
              const isOwned = owned.has(c.card_num)
              return (
                <div key={c.card_num}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isOwned ? 'bg-emerald-900/10' : 'hover:bg-gray-800/40'}`}>
                  <button onClick={() => toggleOwn(c.card_num)} className="shrink-0">
                    {isOwned
                      ? <CheckCircle2 size={18} className="text-emerald-400" />
                      : <Circle size={18} className="text-gray-600 hover:text-gray-400" />}
                  </button>
                  <div className="text-[10px] font-mono text-gray-600 w-10 shrink-0">#{c.card_num}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${isOwned ? 'text-emerald-300' : 'text-white'}`}>{c.driver}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 font-semibold">
                        {c.parallel}
                      </span>
                      <span className="text-[10px] text-gray-600 uppercase tracking-wider">{c.category}</span>
                      {c.on_market_now && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-800/40 font-bold">
                          {c.live_count} LIVE
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 w-24">
                    <div className="text-sm font-black text-emerald-400">
                      {c.latest_avg_price > 0 ? `$${c.latest_avg_price.toFixed(2)}` : <span className="text-gray-600">—</span>}
                    </div>
                    <div className="text-[10px] text-gray-600">{c.sold_count_30d} sold 30d</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
