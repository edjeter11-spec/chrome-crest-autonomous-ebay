import { lazy, Suspense, useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { BarChart3, Target, TrendingUp } from 'lucide-react'
import { swrFetch } from '../lib/cache'

// Lazy-load the snapshot chart — pulls extra recharts imports on demand
const SnapshotTrend = lazy(() => import('../components/SnapshotTrend'))

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f43f5e','#06b6d4']

const TooltipStyle = { background: '#111827', border: '1px solid #1f2937', color: '#f9fafb', borderRadius: '12px', fontSize: 12 }

function VerdictAccuracySection() {
  const [acc, setAcc] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/admin/verdict-accuracy?days=60`)
      .then(r => r.json())
      .then(setAcc)
      .catch(() => setAcc({ error: 'Failed to load' }))
  }, [])

  if (!acc) return <div className="panel h-48 animate-pulse" />
  if (acc.error) return <div className="panel p-4 text-sm text-red-400">{acc.error}</div>

  const rate = acc.hit_rate_pct ?? 0
  const rateColor = rate >= 70 ? 'text-green-400' : rate >= 50 ? 'text-yellow-300' : 'text-red-400'
  const evaluable = (acc.hits || 0) + (acc.misses || 0)

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Target size={14} className="text-gray-500" />
        <h3 className="font-bold text-white text-sm">Verdict Accuracy (last 60 days)</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="text-center">
          <div className={`text-3xl font-black ${rateColor}`}>{rate.toFixed(1)}%</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Hit rate</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-black text-white">{acc.total_strong_buys || 0}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Alerts evaluated</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-black text-green-400">{acc.hits || 0}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Hits</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-black text-red-400">{acc.misses || 0}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Misses</div>
        </div>
      </div>

      {evaluable === 0 && (
        <p className="text-xs text-gray-500 italic">
          Not enough resolved STRONG BUY alerts yet — need alerts older than 14 days with matching sold comps.
        </p>
      )}

      {acc.by_driver?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">By driver</h4>
            <div className="space-y-1">
              {acc.by_driver.slice(0, 8).map(d => (
                <div key={d.driver} className="flex items-center justify-between text-xs">
                  <span className="text-white font-semibold truncate">{d.driver}</span>
                  <span className="text-gray-500 shrink-0">
                    <span className="text-green-400 font-bold">{d.hits}</span>
                    /<span className="text-red-400 font-bold">{d.misses}</span>
                    <span className="ml-1">({d.hit_rate_pct}%)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">By parallel</h4>
            <div className="space-y-1">
              {acc.by_parallel.slice(0, 8).map(p => (
                <div key={p.parallel} className="flex items-center justify-between text-xs">
                  <span className="text-white font-semibold truncate">{p.parallel}</span>
                  <span className="text-gray-500 shrink-0">
                    <span className="text-green-400 font-bold">{p.hits}</span>
                    /<span className="text-red-400 font-bold">{p.misses}</span>
                    <span className="ml-1">({p.hit_rate_pct}%)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {acc.recent_misses?.length > 0 && (
        <div className="pt-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Recent misses (learn from these)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-1 font-medium">Card</th>
                  <th className="pb-1 font-medium text-right">Predicted</th>
                  <th className="pb-1 font-medium text-right">Actual</th>
                  <th className="pb-1 font-medium text-right">Overshoot</th>
                </tr>
              </thead>
              <tbody>
                {acc.recent_misses.map(m => (
                  <tr key={m.alert_id} className="border-t border-gray-800/50">
                    <td className="py-1.5 text-white">{m.driver} · <span className="text-gray-500">{m.parallel}</span></td>
                    <td className="py-1.5 text-right text-gray-400">${m.predicted_median?.toFixed(0)}</td>
                    <td className="py-1.5 text-right text-red-400 font-bold">${m.actual_median?.toFixed(0)}</td>
                    <td className="py-1.5 text-right text-red-400">+{m.overshoot_pct?.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Analytics() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    swrFetch(`${API}/api/analytics/full`, d => setData(d), () => setLoading(false))
  }, [])

  const driverData = (data.by_driver || []).slice(0, 10)
  const parallelData = data.by_parallel || []

  const summaryStats = [
    { label: 'Total Cards', value: data.total_cards },
    { label: 'Active Auctions', value: data.active_auctions },
    { label: 'Snipe Targets', value: data.snipe_targets },
    { label: 'Avg Auction Price', value: data.avg_price ? `$${data.avg_price.toFixed(2)}` : null },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-7 h-7 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="page-title">Analytics</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryStats.map(({ label, value }) => (
          <div key={label} className="panel p-4 text-center">
            <div className="text-2xl font-black text-white">
              {value != null ? value : <span className="skeleton inline-block w-10 h-7 rounded" />}
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1.5 font-medium">{label}</div>
          </div>
        ))}
      </div>

      <VerdictAccuracySection />

      {/* 90-day market trend — lazy-loaded */}
      <Suspense fallback={<div className="panel h-64 animate-pulse" />}>
        <SnapshotTrend days={90} />
      </Suspense>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* By driver */}
        <div className="panel p-5">
          <h3 className="font-bold text-white mb-4 text-sm flex items-center gap-2">
            <BarChart3 size={14} className="text-gray-500" />
            Active Auctions by Driver
          </h3>
          {driverData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={driverData} layout="vertical" margin={{ right: 16 }}>
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="driver" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={90} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" fill="#ef4444" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-700">
              <BarChart3 size={32} className="opacity-20 mb-3" />
              <p className="text-xs">No data yet — sync eBay listings to populate</p>
            </div>
          )}
        </div>

        {/* By parallel */}
        <div className="panel p-5">
          <h3 className="font-bold text-white mb-4 text-sm flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-red-400 to-orange-400" />
            Auctions by Parallel Type
          </h3>
          {parallelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={parallelData}
                  dataKey="count"
                  nameKey="parallel"
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  innerRadius={40}
                  label={({ parallel, percent }) => `${parallel} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {parallelData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-700">
              <div className="w-16 h-16 rounded-full border-4 border-gray-800 opacity-20 mb-3" />
              <p className="text-xs">No parallel data yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
