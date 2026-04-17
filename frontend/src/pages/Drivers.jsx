import { useState, useEffect } from 'react'
import { Trophy, TrendingUp, Zap, Star, Search } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const getTier = score => score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : 'C'
const TIER_STYLE = {
  S: 'bg-yellow-500 text-black border-yellow-400/30',
  A: 'bg-blue-600 text-white border-blue-500/30',
  B: 'bg-green-700 text-white border-green-600/30',
  C: 'bg-gray-700 text-gray-300 border-gray-600/30',
}

const SERIES_TABS = ['All', 'F1', 'F2', 'F3', 'Legends']
const SERIES_COLOR = { F1: '#EF4444', F2: '#8B5CF6', F3: '#EC4899', Legends: '#F59E0B', All: '#6B7280' }

function ScoreMeter({ score, color }) {
  return (
    <div className="score-bar">
      <div className="score-bar-fill" style={{ width: `${score}%`, backgroundColor: color || '#666' }} />
    </div>
  )
}

export default function Drivers() {
  const [drivers, setDrivers] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [series, setSeries] = useState('F1')
  const [search, setSearch] = useState('')

  useEffect(() => {
    swrFetch(
      `${API}/api/cards/drivers-summary`,
      d => { setDrivers(d || []); setLoading(false) },
      () => setLoading(false)
    )
  }, [])

  const filtered = drivers.filter(d => {
    if (series !== 'All' && (d.series || 'F1') !== series) return false
    if (search) return d.driver_name?.toLowerCase().includes(search.toLowerCase())
    return true
  })

  // Auto-select first in filtered list when series changes
  useEffect(() => {
    if (filtered.length && (!selected || !filtered.find(d => d.driver_name === selected.driver_name))) {
      setSelected(filtered[0])
    }
  }, [series, drivers])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-7 h-7 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Driver Profiles</h1>
        <div className="flex gap-1 flex-wrap">
          {SERIES_TABS.map(s => (
            <button key={s} onClick={() => setSeries(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                series === s ? 'text-white shadow-lg' : 'bg-gray-800/80 text-gray-500 hover:text-gray-300'
              }`}
              style={series === s ? { backgroundColor: SERIES_COLOR[s] } : {}}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        {/* Driver list */}
        <div className="w-60 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search driver…"
              className="input-field w-full pl-8 pr-3 py-2 text-xs" />
          </div>
          <div className="space-y-0.5 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-600 px-2 py-4 text-center">No drivers in this series</p>
            ) : filtered.map(d => {
              const tier = getTier(d.investment_score || 0)
              const isSelected = selected?.driver_name === d.driver_name
              const dSeries = d.series || 'F1'
              return (
                <button key={d.driver_name} onClick={() => setSelected(d)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                    isSelected ? 'bg-gray-800 border border-gray-700/60 shadow-sm' : 'hover:bg-gray-900/70 border border-transparent'
                  }`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black text-white shrink-0 shadow"
                    style={{ backgroundColor: d.team_color || '#444' }}>
                    {d.driver_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{d.driver_name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-500 truncate">{d.team}</span>
                      {dSeries !== 'F1' && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded"
                          style={{ backgroundColor: SERIES_COLOR[dSeries] + '30', color: SERIES_COLOR[dSeries] }}>
                          {dSeries}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg border ${TIER_STYLE[tier]}`}>{tier}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Driver detail */}
        {selected ? (
          <div className="flex-1 panel p-6 min-w-0">
            <div className="flex items-start gap-5 mb-6">
              <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0 shadow-xl border border-gray-700/50">
                {selected.image_url && !selected.image_url.includes('placehold.co') ? (
                  <img src={`${API}/api/proxy/image?url=${encodeURIComponent(selected.image_url)}`}
                    alt={selected.driver_name}
                    className="w-full h-full object-cover object-top"
                    onError={e => { e.target.style.display='none'; e.target.parentNode.style.backgroundColor = selected.team_color||'#333' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl font-black text-white"
                    style={{ backgroundColor: selected.team_color || '#333' }}>
                    {selected.driver_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h2 className="text-2xl font-black text-white tracking-tight">{selected.driver_name}</h2>
                  <span className={`text-xs font-black px-2.5 py-1 rounded-xl border ${TIER_STYLE[getTier(selected.investment_score||0)]}`}>
                    {getTier(selected.investment_score||0)}-Tier
                  </span>
                  {(selected.series || 'F1') !== 'F1' && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
                      style={{ backgroundColor: SERIES_COLOR[selected.series]+'20', color: SERIES_COLOR[selected.series], border: `1px solid ${SERIES_COLOR[selected.series]}40` }}>
                      {selected.series}
                    </span>
                  )}
                  {selected.is_rookie && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-orange-900/30 text-orange-400 border border-orange-800/40">RC</span>
                  )}
                </div>
                <p className="text-gray-400 text-sm font-medium">{selected.team}</p>
                <p className="text-gray-600 text-xs mt-0.5">{selected.nationality} · Card #{selected.card_number}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-4xl font-black text-white tracking-tight">{Math.round(selected.investment_score||0)}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-0.5">Invest Score</div>
              </div>
            </div>

            <div className="mb-5">
              <ScoreMeter score={selected.investment_score||0} color={selected.team_color} />
            </div>

            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { icon: Trophy, val: selected.championships ?? '—', label: 'Championships', color: 'text-yellow-400' },
                { icon: Star, val: selected.career_wins ?? '—', label: 'Career Wins', color: 'text-blue-400' },
                { icon: TrendingUp, val: selected.active_auctions ?? '—', label: 'Auctions', color: 'text-green-400' },
                { icon: Zap, val: selected.snipe_count ?? '—', label: 'Snipe Targets', color: 'text-red-400' },
              ].map(({ icon: Icon, val, label, color }) => (
                <div key={label} className="bg-gray-800/60 rounded-2xl p-4 text-center border border-gray-700/30">
                  <Icon size={18} className={`mx-auto mb-2 ${color}`} />
                  <div className="text-2xl font-black text-white">{val}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {selected.parallels?.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest">Card Values by Parallel</h3>
                <div className="overflow-x-auto">
                  <table className="w-full data-table">
                    <thead><tr>
                      <th>Parallel</th>
                      <th className="text-right">Raw</th>
                      <th className="text-right">PSA 10</th>
                      <th className="text-right">Score</th>
                    </tr></thead>
                    <tbody>
                      {selected.parallels.map(p => (
                        <tr key={p.parallel}>
                          <td className="font-medium text-gray-200">{p.parallel}</td>
                          <td className="text-right text-green-400 font-semibold">${p.raw_value?.toFixed(2)}</td>
                          <td className="text-right text-yellow-400 font-semibold">${p.psa10_value?.toFixed(2)}</td>
                          <td className="text-right">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                              p.investment_score >= 85 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                              p.investment_score >= 70 ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                              'bg-gray-700/60 text-gray-400 border border-gray-600/30'
                            }`}>{Math.round(p.investment_score)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 panel flex items-center justify-center py-24 text-gray-600">
            <p className="text-sm">Select a driver</p>
          </div>
        )}
      </div>
    </div>
  )
}
