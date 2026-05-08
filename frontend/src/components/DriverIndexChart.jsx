import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function DriverIndexChart({ driverName, days = 180 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!driverName) return
    setLoading(true)
    fetch(`${API}/api/sales/driver-index/${encodeURIComponent(driverName)}?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [driverName, days])

  if (loading) {
    return <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4 animate-pulse h-72" />
  }
  if (!data || !data.series || data.series.length < 5) {
    return (
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4 text-center text-sm text-gray-500">
        Not enough sale history yet to compute a {driverName} index.
      </div>
    )
  }

  const series = data.series
  const first = series[0]?.value ?? 100
  const last = series[series.length - 1]?.value ?? 100
  const pct = Math.round((last - first) / first * 100)
  const trending = pct > 0

  // Format dates for X-axis
  const formatted = series.map(p => ({
    ...p,
    label: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            {driverName} · Top-{data.top_n} Index
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-black text-white tabular-nums">{last.toFixed(1)}</span>
            <span className={`text-sm font-bold flex items-center gap-1 ${trending ? 'text-emerald-400' : 'text-red-400'}`}>
              {trending ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {pct >= 0 ? '+' : ''}{pct}% in {data.days}d
            </span>
          </div>
        </div>
        <div className="text-[10px] text-gray-500 text-right">
          tracks {data.constituents.length}/<br />{data.top_n} top cards
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formatted}>
          <XAxis
            dataKey="label"
            stroke="#6b7280"
            tick={{ fontSize: 10 }}
            interval={Math.floor(formatted.length / 6)}
          />
          <YAxis
            stroke="#6b7280"
            tick={{ fontSize: 10 }}
            domain={['dataMin - 5', 'dataMax + 5']}
            tickFormatter={v => v.toFixed(0)}
          />
          <Tooltip
            contentStyle={{ background: '#0b0b0e', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af', fontSize: 10 }}
            formatter={(v) => [`${Number(v).toFixed(1)}`, 'Index']}
          />
          <ReferenceLine y={100} stroke="#374151" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="value"
            stroke={trending ? '#10b981' : '#ef4444'}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {data.constituents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800/60">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">
            Index constituents
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.constituents.slice(0, 6).map((c, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700/40">
                {c.parallel}{c.grade && c.grade !== 'Raw' ? ` ${c.grade}` : ''}
                <span className="text-gray-500 ml-1">${Math.round(c.lifetime_avg)}</span>
              </span>
            ))}
            {data.constituents.length > 6 && (
              <span className="text-[10px] px-2 py-0.5 text-gray-500">+{data.constituents.length - 6} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
