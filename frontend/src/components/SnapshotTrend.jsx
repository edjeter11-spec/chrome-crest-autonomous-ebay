import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TooltipStyle = { background: '#111827', border: '1px solid #1f2937', color: '#f9fafb', borderRadius: '12px', fontSize: 12 }

export default function SnapshotTrend({ days = 90 }) {
  const [snapshots, setSnapshots] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/snapshots?days=${days}`)
      .then(r => r.json())
      .then(d => setSnapshots(d?.snapshots || []))
      .catch(() => setSnapshots([]))
  }, [days])

  if (!snapshots) return <div className="panel h-64 animate-pulse" />

  return (
    <div className="panel p-5">
      <h3 className="font-bold text-white mb-4 text-sm flex items-center gap-2">
        <TrendingUp size={14} className="text-gray-500" />
        {days}-day market value trend
      </h3>
      {snapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 text-gray-600">
          <TrendingUp size={28} className="opacity-20 mb-2" />
          <p className="text-xs">Snapshots build daily — check back tomorrow.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={snapshots} margin={{ right: 12, top: 6 }}>
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="total"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis
              yAxisId="median"
              orientation="right"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `$${v.toFixed(0)}`}
            />
            <Tooltip contentStyle={TooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="total"  type="monotone" dataKey="total_market_value"  name="Total market value"   stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line yAxisId="median" type="monotone" dataKey="median_card_value"   name="Median card value"    stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
