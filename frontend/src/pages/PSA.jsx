import { useState, useEffect } from 'react'
import { Search, Shield, ExternalLink, TrendingUp, Award, BarChart2, ChevronRight } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const GRADE_MULT = { 'PSA 10': 3.2, 'PSA 9': 1.9, 'PSA 8': 1.3, 'PSA 7': 0.95, 'PSA 6': 0.75, 'PSA 5': 0.60 }
const RARITY = {
  'Autograph': 100, 'Red /5': 95, 'Orange /25': 85, 'Gold /50': 80,
  'Green /99': 75, 'Blue /150': 70, 'Prism Refractor': 65, 'Refractor': 55, 'Base': 0,
}
const GRADE_ORDER = ['PSA 10', 'PSA 9', 'PSA 8', 'PSA 7', 'PSA 6', 'PSA 5', 'PSA 4', 'PSA 3', 'PSA 2', 'PSA 1']

export default function PSA() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Two-step selection
  const [selectedDriver, setSelectedDriver] = useState(null)  // driver name string
  const [selectedCard, setSelectedCard] = useState(null)      // full card object

  const [psaData, setPsaData] = useState(null)
  const [psaLoading, setPsaLoading] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/cards?limit=500`)
      .then(r => r.json())
      .then(d => {
        const arr = (d.cards || d || [])
        arr.sort((a, b) => (RARITY[b.parallel] ?? 30) - (RARITY[a.parallel] ?? 30))
        setCards(arr)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedCard) return
    setPsaData(null)
    setPsaLoading(true)
    fetch(`${API}/api/cards/${selectedCard.id}/psa-pop`)
      .then(r => r.json())
      .then(d => { setPsaData(d); setPsaLoading(false) })
      .catch(() => setPsaLoading(false))
  }, [selectedCard])

  // Unique drivers, sorted by highest investment score
  const drivers = [...new Map(
    cards.map(c => [c.driver_name, c])
  ).values()].sort((a, b) => (b.investment_score || 0) - (a.investment_score || 0))

  const filteredDrivers = drivers.filter(d =>
    !search || d.driver_name?.toLowerCase().includes(search.toLowerCase())
  )

  // Unique parallels for selected driver (prefer Raw grade entry as the representative card)
  const driverParallels = selectedDriver
    ? Object.values(
        cards
          .filter(c => c.driver_name === selectedDriver)
          .reduce((acc, c) => {
            if (!acc[c.parallel] || c.grade === 'Raw') acc[c.parallel] = c
            return acc
          }, {})
      ).sort((a, b) => (RARITY[b.parallel] ?? 30) - (RARITY[a.parallel] ?? 30))
    : []

  const rawValue = selectedCard?.base_value || 0
  const gradeEstimates = Object.entries(GRADE_MULT).map(([grade, mult]) => ({
    grade, est: rawValue * mult,
  })).sort((a, b) => b.est - a.est)

  const psaSaleRows = psaData?.psa_sales
    ? GRADE_ORDER.flatMap(grade =>
        (psaData.psa_sales[grade] || []).map(s => ({ grade, ...s }))
      )
    : []

  const avgByGrade = psaData?.psa_sales
    ? Object.entries(psaData.psa_sales).map(([grade, sales]) => ({
        grade,
        avg: sales.reduce((s, x) => s + x.price, 0) / sales.length,
        count: sales.length,
      })).sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade))
    : []

  const handleDriverClick = (driverName) => {
    setSelectedDriver(driverName)
    setSelectedCard(null)
    setPsaData(null)
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div>
        <h1 className="page-title">PSA Population</h1>
        <p className="text-sm text-gray-500 mt-1">Grade estimates · eBay graded sales data · Pop report links</p>
      </div>

      <div className="flex gap-4">
        {/* Driver list */}
        <div className="w-52 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search driver…"
              className="input-field w-full pl-8 pr-3 py-2 text-xs" />
          </div>
          <div className="space-y-0.5 max-h-[calc(100vh-220px)] overflow-y-auto">
            {loading ? (
              Array(10).fill(0).map((_, i) => <div key={i} className="h-10 skeleton rounded-xl" />)
            ) : filteredDrivers.map(d => (
              <button
                key={d.driver_name}
                onClick={() => handleDriverClick(d.driver_name)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors flex items-center justify-between gap-2 ${
                  selectedDriver === d.driver_name
                    ? 'bg-gray-800 border border-gray-700/60 text-white'
                    : 'text-gray-400 hover:bg-gray-900/70 border border-transparent'
                }`}
              >
                <span className="font-semibold truncate">{d.driver_name}</span>
                <ChevronRight size={12} className="shrink-0 opacity-40" />
              </button>
            ))}
          </div>
        </div>

        {/* Middle: parallel picker or prompt */}
        <div className="w-48 shrink-0">
          {!selectedDriver && !loading && (
            <div className="panel h-full flex items-center justify-center py-16 text-gray-600">
              <div className="text-center">
                <Shield size={28} className="mx-auto mb-2 opacity-20" />
                <p className="text-xs">Select a driver</p>
              </div>
            </div>
          )}
          {selectedDriver && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold px-1">Select parallel</p>
              <div className="space-y-0.5 max-h-[calc(100vh-220px)] overflow-y-auto">
                {driverParallels.map(card => (
                  <button
                    key={card.id}
                    onClick={() => setSelectedCard(card)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-colors ${
                      selectedCard?.id === card.id
                        ? 'bg-red-600/20 border border-red-600/40 text-red-300'
                        : 'text-gray-400 hover:bg-gray-900/70 border border-transparent hover:text-white'
                    }`}
                  >
                    <div className="font-semibold">{card.parallel}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {!selectedCard && (
          <div className="flex-1 panel flex items-center justify-center py-24 text-gray-600">
            <div className="text-center">
              <Shield size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{selectedDriver ? 'Pick a parallel' : 'Select a driver to get started'}</p>
            </div>
          </div>
        )}

        {selectedCard && (
          <div className="flex-1 space-y-4">
            {/* Card header */}
            <div className="panel p-5">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0 shadow"
                  style={{ backgroundColor: selectedCard.team_color || '#333' }}>
                  {selectedCard.driver_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-black text-white tracking-tight">{selectedCard.driver_name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-gray-800 text-gray-300 border border-gray-700/50">{selectedCard.parallel}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-yellow-900/30 text-yellow-400 border border-yellow-800/40">{selectedCard.grade}</span>
                    {psaData?.total_raw_sales > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-blue-900/30 text-blue-400 border border-blue-800/40">
                        {psaData.total_raw_sales} raw sales in DB
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-black text-white">${rawValue.toFixed(2)}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">Base Value (Raw)</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Grade estimates */}
              <div className="panel p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <Award size={14} className="text-yellow-400" />
                  Grade Value Estimates
                </h3>
                <div className="space-y-2.5">
                  {gradeEstimates.map(({ grade, est }) => (
                    <div key={grade} className="flex items-center gap-3">
                      <span className={`text-xs font-bold w-14 shrink-0 ${
                        grade === 'PSA 10' ? 'text-yellow-400' : grade === 'PSA 9' ? 'text-green-400' : 'text-gray-400'
                      }`}>{grade}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${grade === 'PSA 10' ? 'bg-yellow-500' : grade === 'PSA 9' ? 'bg-green-500' : 'bg-gray-600'}`}
                          style={{ width: `${Math.min(100, (est / (rawValue * 3.2 || 1)) * 100)}%` }} />
                      </div>
                      <span className="text-sm font-bold text-white w-16 text-right">${est.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 mt-4">Estimates based on historical PSA grade multipliers.</p>
              </div>

              {/* PSA links */}
              <div className="panel p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <Shield size={14} className="text-blue-400" />
                  PSA Links
                </h3>
                {psaLoading ? (
                  <div className="space-y-3">{Array(3).fill(0).map((_, i) => <div key={i} className="skeleton h-10 rounded-xl" />)}</div>
                ) : psaData ? (
                  <div className="space-y-3">
                    {psaData.psa_not_indexed && (
                      <div className="px-3 py-2 rounded-xl bg-yellow-900/20 border border-yellow-800/40 text-xs text-yellow-400">
                        PSA hasn't indexed this 2025 set yet — links show eBay graded sold data.
                      </div>
                    )}
                    <a href={psaData.ebay_psa_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 bg-blue-700 hover:bg-blue-600 text-white text-sm font-bold rounded-xl transition-colors">
                      <ExternalLink size={14} />
                      eBay Sold PSA — {selectedCard.driver_name}
                    </a>
                    <a href={psaData.psa_pop_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-xl transition-colors border border-gray-700/50">
                      <ExternalLink size={11} />
                      PSA Pop Report (all sets)
                    </a>
                    {psaData.avg_raw_price && (
                      <div className="px-3 py-2 rounded-xl bg-gray-800/60 border border-gray-700/30 text-xs text-gray-300">
                        Avg raw from {psaData.total_raw_sales} eBay sold: <span className="font-bold text-white">${psaData.avg_raw_price}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600">Failed to load</p>
                )}
              </div>
            </div>

            {/* Real graded sale prices */}
            {psaData && avgByGrade.length > 0 && (
              <div className="panel p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <BarChart2 size={14} className="text-green-400" />
                  Graded Sale Prices — {psaData.total_graded_sales} eBay sold records
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {avgByGrade.map(({ grade, avg, count }) => (
                      <div key={grade} className="flex items-center gap-3">
                        <span className={`text-xs font-bold w-14 shrink-0 ${
                          grade === 'PSA 10' ? 'text-yellow-400' : grade === 'PSA 9' ? 'text-green-400' : 'text-gray-400'
                        }`}>{grade}</span>
                        <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-blue-500"
                            style={{ width: `${Math.min(100, (avg / (avgByGrade[0]?.avg || 1)) * 100)}%` }} />
                        </div>
                        <span className="text-sm font-bold text-white w-20 text-right">${avg.toFixed(2)}</span>
                        <span className="text-[10px] text-gray-600 w-8 text-right">{count}x</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-2">Recent Sales</p>
                    {psaSaleRows.slice(0, 20).map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`font-bold w-14 shrink-0 ${s.grade === 'PSA 10' ? 'text-yellow-400' : s.grade === 'PSA 9' ? 'text-green-400' : 'text-gray-500'}`}>
                          {s.grade}
                        </span>
                        <span className="font-bold text-white">${s.price.toFixed(2)}</span>
                        <span className="text-gray-600 ml-auto">{s.date?.slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {psaData && psaData.total_graded_sales === 0 && (
              <div className="panel p-5 text-center text-gray-600">
                <Shield size={24} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">No graded sale data in DB yet for this card.</p>
              </div>
            )}

            {/* Should you grade? */}
            <div className="panel p-5">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <TrendingUp size={14} className="text-green-400" />
                Should You Grade This Card?
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: 'PSA 10 Upside',
                    value: `${(((rawValue * 3.2) - rawValue) / (rawValue || 1) * 100).toFixed(0)}%`,
                    sub: `+$${(rawValue * 3.2 - rawValue).toFixed(2)} potential`,
                    color: 'text-green-400',
                  },
                  {
                    label: 'Break-Even Grade',
                    value: 'PSA 7+',
                    sub: 'Cover ~$30 grading cost',
                    color: 'text-yellow-400',
                  },
                  {
                    label: 'Investment Score',
                    value: `${Math.round(selectedCard.investment_score || 0)}`,
                    sub: selectedCard.investment_score >= 85 ? 'High value — grade it' : selectedCard.investment_score >= 70 ? 'Worth considering' : 'Lower priority',
                    color: selectedCard.investment_score >= 85 ? 'text-yellow-400' : selectedCard.investment_score >= 70 ? 'text-blue-400' : 'text-gray-500',
                  },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} className="bg-gray-800/60 rounded-2xl p-4 border border-gray-700/30">
                    <div className={`text-2xl font-black ${color}`}>{value}</div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">{label}</div>
                    <div className="text-[10px] text-gray-600 mt-1">{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
