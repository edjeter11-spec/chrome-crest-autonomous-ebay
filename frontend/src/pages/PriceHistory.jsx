import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Search, RefreshCw } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TooltipStyle = { background: '#111827', border: '1px solid #1f2937', color: '#f9fafb', borderRadius: '12px', fontSize: 12 }

const RARITY = {
  'Autograph': 100, 'Red /5': 95, 'Orange /25': 85, 'Gold /50': 80,
  'Green /99': 75, 'Blue /150': 70, 'Prism Refractor': 65, 'Refractor': 55, 'Base': 0,
}

export default function PriceHistory() {
  const [cards, setCards] = useState([])
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [rawHistory, setRawHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    fetch(`${API}/api/cards?limit=500`)
      .then(r => r.json())
      .then(d => {
        const arr = (d.cards || d || []).sort((a, b) =>
          (RARITY[b.parallel] ?? 30) - (RARITY[a.parallel] ?? 30)
        )
        setCards(arr)
        if (arr.length) setSelected(arr[0])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selected) return
    setHistoryLoading(true)
    setHistory([])
    setRawHistory([])
    fetch(`${API}/api/cards/${selected.id}/price-history`)
      .then(r => r.json())
      .then(d => {
        const raw = (d.history || d || []).sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date))
        setRawHistory(raw)
        setHistory(raw.map(h => ({
          date: new Date(h.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          price: h.price,
          condition: h.condition,
          source: h.source,
        })))
        setHistoryLoading(false)
      })
      .catch(() => setHistoryLoading(false))
  }, [selected])

  const triggerSync = async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const r = await fetch(`${API}/api/sync/price-history`, { method: 'POST' })
      const d = await r.json()
      setSyncMsg(`Synced ${d.drivers_synced} drivers, +${d.records_added} new sales`)
      // Reload history for selected card
      if (selected) {
        const r2 = await fetch(`${API}/api/cards/${selected.id}/price-history`)
        const d2 = await r2.json()
        const raw = (d2.history || d2 || []).sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date))
        setRawHistory(raw)
        setHistory(raw.map(h => ({
          date: new Date(h.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          price: h.price,
          condition: h.condition,
          source: h.source,
        })))
      }
    } catch { setSyncMsg('Sync failed') }
    setSyncing(false)
  }

  const filtered = cards.filter(c =>
    !search || c.driver_name?.toLowerCase().includes(search.toLowerCase()) || c.parallel?.toLowerCase().includes(search.toLowerCase())
  )

  const minPrice = history.length ? Math.min(...history.map(h => h.price)) : 0
  const maxPrice = history.length ? Math.max(...history.map(h => h.price)) : 0
  const avgPrice = history.length ? history.reduce((s, h) => s + h.price, 0) / history.length : 0
  const trend = history.length > 1 ? history[history.length - 1].price - history[0].price : 0

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex items-center gap-3">
        <div className="w-1 h-7 bg-red-600 rounded-full shrink-0" />
        <h1 className="text-2xl font-black text-white tracking-tight">Price History</h1>
        <span className="text-xs text-gray-600 font-medium">90-day sold comps · eBay Finding API</span>
        <button
          onClick={triggerSync}
          disabled={syncing}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs font-medium transition-colors border border-gray-700/50 disabled:opacity-50"
        >
          <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>
      {syncMsg && <p className="text-xs text-green-400 font-medium">{syncMsg}</p>}

      <div className="flex gap-4">
        {/* Card list */}
        <div className="w-60 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Driver or parallel…"
              className="input-field w-full pl-8 pr-3 py-2 text-xs"
            />
          </div>
          <div className="space-y-0.5 max-h-[calc(100vh-260px)] overflow-y-auto">
            {loading ? (
              Array(8).fill(0).map((_, i) => <div key={i} className="h-12 skeleton rounded-xl" />)
            ) : filtered.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  selected?.id === c.id
                    ? 'bg-gray-800 border border-gray-700/60 text-white'
                    : 'text-gray-400 hover:bg-gray-900/70 border border-transparent'
                }`}
              >
                <div className="font-semibold text-sm truncate">{c.driver_name}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">{c.parallel} · {c.grade}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Chart area */}
        <div className="flex-1 space-y-4">
          {selected && (
            <>
              <div className="panel p-4 flex items-center justify-between">
                <div>
                  <h2 className="font-black text-white text-lg">{selected.driver_name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-gray-800 text-gray-300 border border-gray-700/50">{selected.parallel}</span>
                    {history.length > 0 && (
                      <span className="text-xs text-gray-600">{history.length} sales in last 90 days</span>
                    )}
                  </div>
                </div>
                {history.length > 1 && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-semibold text-sm ${
                    trend >= 0
                      ? 'bg-green-900/20 text-green-400 border border-green-800/30'
                      : 'bg-red-900/20 text-red-400 border border-red-800/30'
                  }`}>
                    {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {trend >= 0 ? '+' : ''}${trend.toFixed(2)} since first sale
                  </div>
                )}
              </div>

              {history.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Sales', value: history.length, color: 'text-white' },
                    { label: 'Low', value: `$${minPrice.toFixed(2)}`, color: 'text-red-400' },
                    { label: 'Avg', value: `$${avgPrice.toFixed(2)}`, color: 'text-yellow-400' },
                    { label: 'High', value: `$${maxPrice.toFixed(2)}`, color: 'text-green-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="panel p-3 text-center">
                      <div className={`text-lg font-black ${color}`}>{value}</div>
                      <div className="text-[10px] text-gray-600 uppercase tracking-wider mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="panel p-5">
                {historyLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : history.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={history} margin={{ right: 16, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={TooltipStyle}
                        formatter={(v, _, props) => [
                          `$${v.toFixed(2)}`,
                          props.payload?.condition || 'Sale Price'
                        ]}
                      />
                      {avgPrice > 0 && (
                        <ReferenceLine y={avgPrice} stroke="#6b7280" strokeDasharray="4 4" label={{ value: 'avg', fill: '#6b7280', fontSize: 10 }} />
                      )}
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#ef4444"
                        strokeWidth={2.5}
                        dot={{ fill: '#ef4444', r: 4, strokeWidth: 0 }}
                        activeDot={{ r: 6, fill: '#ef4444' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-600">
                    <TrendingUp size={36} className="opacity-20 mb-4" />
                    <p className="text-sm font-medium">No sold comps yet for this card</p>
                    <p className="text-xs mt-1 text-gray-700">Hit "Sync Now" to pull 90 days of eBay sold data</p>
                  </div>
                )}
              </div>

              {/* Recent sales table */}
              {rawHistory.length > 0 && (
                <div className="panel p-5">
                  <h3 className="text-sm font-bold text-white mb-3">Recent Sales</h3>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {[...rawHistory].reverse().slice(0, 20).map((h, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-800/60 last:border-0">
                        <span className="text-gray-500">{new Date(h.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                        <span className="text-gray-400 flex-1 px-3 truncate">{h.condition}</span>
                        <span className="font-bold text-white">${h.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
