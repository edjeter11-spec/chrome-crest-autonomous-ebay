import { useState, useEffect, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trophy, TrendingUp, Zap, Star, Search, Award, ExternalLink, LineChart as LineChartIcon } from 'lucide-react'
import { swrFetch } from '../lib/cache'
import { usePersistedState } from '../lib/hooks'

const ROOKIES_2025 = new Set([
  'Andrea Kimi Antonelli', 'Gabriel Bortoleto', 'Oliver Bearman',
  'Isack Hadjar', 'Jack Doohan', 'Liam Lawson', 'Franco Colapinto',
])

function MomentumChip({ delta, small }) {
  if (delta == null) {
    return <span className={`text-gray-500 ${small ? 'text-[10px]' : 'text-xs'} font-semibold`}>—</span>
  }
  const up = delta > 0
  const flat = Math.abs(delta) < 1
  const color = flat ? 'text-gray-400' : up ? 'text-emerald-400' : 'text-red-400'
  const arrow = flat ? '→' : up ? '↑' : '↓'
  return (
    <span className={`font-bold ${color} ${small ? 'text-[10px]' : 'text-xs'}`}
          title={`Median last 7d vs prior 14d (${delta.toFixed(1)}%)`}>
      {arrow} {flat ? 'flat' : `${Math.abs(delta).toFixed(0)}% (7d)`}
    </span>
  )
}

const DriverPriceChart = lazy(() => import('../components/DriverPriceChart'))

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
  const [searchParams, setSearchParams] = useSearchParams()
  const [drivers, setDrivers] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [series, setSeries] = useState('F1')
  const [search, setSearch] = useState('')
  const [observed, setObserved] = useState(null)
  const [recentSales, setRecentSales] = useState([])
  const [topGraded, setTopGraded] = useState(null)
  const [momentumMap, setMomentumMap] = useState({})
  const [rookiePremium, setRookiePremium] = useState(null)
  const [recentlyViewed, setRecentlyViewed] = usePersistedState('cc_recent_drivers', [])

  // Load all-driver momentum once
  useEffect(() => {
    fetch(`${API}/api/sales/momentum`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.rows) return
        const map = {}
        for (const row of d.rows) map[row.driver] = row
        setMomentumMap(map)
      })
      .catch(() => {})
    fetch(`${API}/api/sales/rookie-premium`)
      .then(r => r.ok ? r.json() : null)
      .then(setRookiePremium)
      .catch(() => {})
  }, [])

  useEffect(() => {
    swrFetch(
      `${API}/api/cards/drivers-summary`,
      d => { setDrivers(d || []); setLoading(false) },
      () => setLoading(false)
    )
  }, [])

  // Apply ?name= deep-link after drivers load
  useEffect(() => {
    if (!drivers.length) return
    const urlName = searchParams.get('name')
    if (urlName) {
      const match = drivers.find(d => d.driver_name?.toLowerCase() === urlName.toLowerCase())
        || drivers.find(d => d.driver_name?.toLowerCase().includes(urlName.toLowerCase()))
      if (match) {
        const s = match.series || 'F1'
        if (series !== 'All' && s !== series) setSeries(s)
        setSelected(match)
      }
    }
  }, [drivers, searchParams])

  // Sync selected → URL, and record recently viewed
  useEffect(() => {
    if (!selected) return
    const cur = searchParams.get('name')
    if (cur !== selected.driver_name) {
      const next = new URLSearchParams(searchParams)
      next.set('name', selected.driver_name)
      setSearchParams(next, { replace: true })
    }
    setRecentlyViewed(prev => {
      const name = selected.driver_name
      const without = (prev || []).filter(n => n !== name)
      return [name, ...without].slice(0, 5)
    })
  }, [selected])

  // Fetch per-driver detail blocks
  useEffect(() => {
    if (!selected?.driver_name) return
    const drv = selected.driver_name
    setObserved(null); setRecentSales([]); setTopGraded(null)

    fetch(`${API}/api/psa/observed?driver=${encodeURIComponent(drv)}`)
      .then(r => r.ok ? r.json() : null).then(d => setObserved(d)).catch(() => {})

    fetch(`${API}/api/sales?driver=${encodeURIComponent(drv)}&limit=10&year=2025`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = d?.sales || []
        setRecentSales(list)
        const graded = list.filter(s => s.grade)
        // The api-limited list may not surface the all-time top graded; call a second
        // query sorted by price via a bigger pull.
      }).catch(() => {})

    // Top graded sale: pull larger sample filtered to graded-only
    fetch(`${API}/api/sales?driver=${encodeURIComponent(drv)}&grade=graded&limit=100&year=2025`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = d?.sales || []
        if (list.length) {
          const top = list.reduce((best, s) => (s.sale_price > (best?.sale_price || 0) ? s : best), null)
          setTopGraded(top)
        }
      }).catch(() => {})
  }, [selected?.driver_name])

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

      <div className="flex flex-col md:flex-row gap-4">
        {/* Driver list */}
        <div className="w-full md:w-60 md:shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search driver…"
              className="input-field w-full pl-8 pr-3 py-2 text-xs" />
          </div>
          {recentlyViewed?.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              <span className="text-[9px] uppercase font-black text-gray-500 tracking-wider self-center pr-1">Recent</span>
              {recentlyViewed.map(name => (
                <button
                  key={name}
                  onClick={() => {
                    const match = drivers.find(d => d.driver_name === name)
                    if (match) setSelected(match)
                  }}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-800/70 hover:bg-gray-700 text-gray-300 border border-gray-700/50"
                >
                  {name.split(' ').slice(-1)[0]}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-0.5 max-h-[45vh] md:max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
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
                    <div className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                      {d.driver_name}
                      {ROOKIES_2025.has(d.driver_name) && (
                        <span className="text-[9px] font-black px-1 py-0.5 rounded bg-pink-900/40 text-pink-300 border border-pink-700/50">RC</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-500 truncate">{d.team}</span>
                      {dSeries !== 'F1' && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded"
                          style={{ backgroundColor: SERIES_COLOR[dSeries] + '30', color: SERIES_COLOR[dSeries] }}>
                          {dSeries}
                        </span>
                      )}
                      <MomentumChip delta={momentumMap[d.driver_name]?.delta_pct} small />
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
          <div className="flex-1 panel p-4 md:p-6 min-w-0">
            <div className="flex items-start gap-3 md:gap-5 mb-6 flex-wrap">
              <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0 shadow-xl border border-gray-700/50">
                {selected.image_url && !selected.image_url.includes('placehold.co') ? (
                  <img src={selected.image_url.includes('i.ebayimg.com') ? selected.image_url : `${API}/api/proxy/image?url=${encodeURIComponent(selected.image_url)}`}
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
                  {(selected.is_rookie || ROOKIES_2025.has(selected.driver_name)) && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-pink-900/40 text-pink-300 border border-pink-700/60">RC</span>
                  )}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-gray-800/70 border border-gray-700/50">
                    <MomentumChip delta={momentumMap[selected.driver_name]?.delta_pct} />
                  </span>
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

            {/* Rookie premium insight */}
            {ROOKIES_2025.has(selected.driver_name) && rookiePremium?.premium_pct != null && (
              <div className="mb-5 px-4 py-3 rounded-2xl bg-pink-900/15 border border-pink-700/40 text-sm text-gray-200">
                <span className="font-black text-pink-300">Rookie Premium: </span>
                RC median sale <span className="font-black text-white">${rookiePremium.rookie_median_total?.toLocaleString() || '—'}</span>
                {' '}vs non-RC <span className="text-gray-300">${rookiePremium.nonrookie_median_total?.toLocaleString() || '—'}</span>
                {' '}= <span className={`font-black ${rookiePremium.premium_pct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {rookiePremium.premium_pct > 0 ? '+' : ''}{rookiePremium.premium_pct.toFixed(1)}%
                </span>
                <span className="text-[10px] text-gray-500 ml-2">(n={rookiePremium.rookie_sample_count} rookie sales, {rookiePremium.days}d)</span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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

            {/* Observed graded breakdown */}
            {observed?.grades?.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                  <Award size={12} className="text-yellow-400" /> Observed Graded Breakdown
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {observed.grades.slice(0, 8).map(g => (
                    <div key={g.grade} className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/30">
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{g.grade}</div>
                      <div className="text-lg font-black text-white mt-0.5">{g.count}</div>
                      <div className="text-[10px] text-emerald-400 font-semibold">avg ${Math.round(g.avg_price || 0).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top graded sale */}
            {topGraded && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                  <Trophy size={12} className="text-amber-400" /> Top Graded Sale Ever
                </h3>
                <a href={topGraded.ebay_url || '#'} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 bg-gradient-to-r from-amber-900/20 to-transparent border border-amber-800/30 rounded-2xl p-3 hover:from-amber-900/30 transition-colors">
                  {topGraded.image_url && (
                    <img src={topGraded.image_url} alt="" className="w-12 h-16 rounded object-cover shrink-0" onError={e => e.target.style.display='none'} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{topGraded.title}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-amber-400 font-bold">{topGraded.grade}</span>
                      {topGraded.parallel && <span>· {topGraded.parallel}</span>}
                      <span>· {new Date(topGraded.sale_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-black text-amber-400">${(topGraded.sale_price || 0).toLocaleString()}</div>
                    <ExternalLink size={10} className="text-gray-500 ml-auto mt-0.5" />
                  </div>
                </a>
              </div>
            )}

            {/* 90-day price chart */}
            <div className="mb-6">
              <h3 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                <LineChartIcon size={12} className="text-cyan-400" /> Price Trend (90 days)
              </h3>
              <Suspense fallback={<div className="h-56 skeleton rounded-xl" />}>
                <DriverPriceChart driver={selected.driver_name} days={90} />
              </Suspense>
            </div>

            {/* Last 10 sales */}
            {recentSales.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                  <TrendingUp size={12} className="text-emerald-400" /> Last 10 Sales
                </h3>
                <div className="space-y-1 bg-gray-800/30 rounded-xl p-1 border border-gray-800/40">
                  {recentSales.slice(0, 10).map(s => (
                    <a key={s.id} href={s.ebay_url || '#'} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800/60 transition-colors text-xs">
                      <span className="text-gray-300 flex-1 truncate">{s.title}</span>
                      {s.grade && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 font-bold shrink-0">{s.grade}</span>}
                      {s.parallel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 shrink-0">{s.parallel}</span>}
                      <span className="text-emerald-400 font-bold shrink-0">${(s.sale_price || 0).toFixed(0)}</span>
                      <span className="text-gray-600 text-[10px] shrink-0 w-16 text-right">{s.sale_date ? new Date(s.sale_date).toLocaleDateString() : ''}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

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
