import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const GRADE_COLORS = {
  'PSA 10': '#F59E0B',
  'PSA 9': '#3B82F6',
  'PSA 8': '#8B5CF6',
  'BGS': '#10B981',
  'SGC': '#14B8A6',
  'Raw': '#9CA3AF',
}

export default function DriverPriceChart({ driver, days = 90 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!driver) return
    setLoading(true)
    fetch(`${API}/api/psa/timeseries?driver=${encodeURIComponent(driver)}&days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [driver, days])

  if (loading) return <div className="h-56 skeleton rounded-xl" />

  if (!data || (data.total_points || 0) < 5) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-gray-600 border border-gray-800/40 rounded-xl bg-gray-900/40">
        Not enough graded data yet
      </div>
    )
  }

  // Pivot series: { week_start: 'YYYY-MM-DD', 'PSA 10': n, 'PSA 9': n, ... }
  const pivot = new Map()
  const grades = new Set()
  for (const p of data.series || []) {
    const k = p.week_start.slice(0, 10)
    if (!pivot.has(k)) pivot.set(k, { week: k })
    pivot.get(k)[p.grade] = p.avg_price
    grades.add(p.grade)
  }
  const rows = [...pivot.values()].sort((a, b) => a.week.localeCompare(b.week))

  return (
    <div className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 font-bold">
        90-day avg price by grade · {data.total_points} sales
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => v.slice(5)} />
            <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
              formatter={(v) => `$${Number(v).toFixed(0)}`}
            />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} />
            {[...grades].map(g => (
              <Line
                key={g}
                type="monotone"
                dataKey={g}
                stroke={GRADE_COLORS[g] || GRADE_COLORS[g?.split(' ')[0]] || '#EF4444'}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
