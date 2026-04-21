import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { Flame } from 'lucide-react'
import { verdictFor, VERDICT_STYLES } from '../lib/verdict'

const API = import.meta.env.VITE_API_URL || ''

const GRADE_COLORS = {
  'PSA 10': '#F59E0B',
  'PSA 9': '#3B82F6',
  'PSA 8': '#8B5CF6',
  'BGS': '#10B981',
  'SGC': '#14B8A6',
  'Raw': '#9CA3AF',
}

// Median helper
function median(arr) {
  if (!arr.length) return null
  const v = [...arr].sort((a, b) => a - b)
  const n = v.length
  return n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2
}

export default function DriverPriceChart({ driver, days = 90 }) {
  const [data, setData] = useState(null)
  const [salesRaw, setSalesRaw] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!driver) return
    setLoading(true)
    Promise.all([
      fetch(`${API}/api/psa/timeseries?driver=${encodeURIComponent(driver)}&days=${days}`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/sales?driver=${encodeURIComponent(driver)}&limit=400&year=2025&exclude_source=SportsCardsPro`).then(r => r.json()).catch(() => ({ sales: [] })),
    ]).then(([ts, raw]) => {
      setData(ts)
      setSalesRaw(raw?.sales || [])
      setLoading(false)
    })
  }, [driver, days])

  // Scatter points colored by verdict (computed against per-grade-band median)
  const { scatter, streak30d } = useMemo(() => {
    if (!salesRaw.length) return { scatter: [], streak30d: 0 }
    // Group medians by grade label so verdict comparisons stay apples-to-apples.
    const byGrade = new Map()
    for (const s of salesRaw) {
      const g = s.grade || 'Raw'
      const total = s.total_cost ?? s.sale_price
      if (!total) continue
      ;(byGrade.get(g) || byGrade.set(g, []).get(g)).push(total)
    }
    const medByGrade = new Map()
    for (const [g, vals] of byGrade) medByGrade.set(g, median(vals))

    const points = []
    let strongRecent = 0
    const cutoff30d = Date.now() - 30 * 86400 * 1000
    for (const s of salesRaw) {
      if (!s.sale_date) continue
      const total = s.total_cost ?? s.sale_price
      const g = s.grade || 'Raw'
      const med = medByGrade.get(g)
      const n = byGrade.get(g)?.length || 0
      const v = verdictFor(total, med, n, 4)  // need >=4 in bucket
      if (!v) continue
      const d = new Date(s.sale_date)
      const ts = d.getTime()
      // Snap to Monday-of-week so scatter shares x-axis ticks with the line series
      const day = d.getUTCDay() // 0=Sun
      const diff = (day + 6) % 7 // days since Monday
      const mon = new Date(d)
      mon.setUTCDate(d.getUTCDate() - diff)
      const weekKey = mon.toISOString().slice(0, 10)
      points.push({
        ts,
        week: weekKey,
        price: total,
        verdict: v.key,
        fill: v.dotColor,
        grade: g,
      })
      if (v.key === 'STRONG_BUY' && ts >= cutoff30d) strongRecent++
    }
    points.sort((a, b) => a.ts - b.ts)
    return { scatter: points, streak30d: strongRecent }
  }, [salesRaw])

  if (loading) return <div className="h-56 skeleton rounded-xl" />

  if (!data || (data.total_points || 0) < 5) {
    // Even when grade timeseries is sparse, show the scatter when we have raw sales.
    if (!scatter.length) {
      return (
        <div className="h-40 flex items-center justify-center text-xs text-gray-600 border border-gray-800/40 rounded-xl bg-gray-900/40">
          Not enough graded data yet
        </div>
      )
    }
  }

  // Pivot grade-line series
  const pivot = new Map()
  const grades = new Set()
  for (const p of data?.series || []) {
    const k = p.week_start.slice(0, 10)
    if (!pivot.has(k)) pivot.set(k, { week: k })
    pivot.get(k)[p.grade] = p.avg_price
    grades.add(p.grade)
  }
  // Merge scatter points into the same row-set keyed by week so XAxis is consistent.
  for (const sp of scatter) {
    if (!pivot.has(sp.week)) pivot.set(sp.week, { week: sp.week })
  }
  const rows = [...pivot.values()].sort((a, b) => a.week.localeCompare(b.week))

  return (
    <div className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-3 space-y-2">
      {/* Verdict streak banner */}
      {streak30d > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/20 border border-green-700/40">
          <Flame size={13} className="text-green-400" />
          <span className="text-xs text-green-300 font-bold">
            {streak30d} STRONG BUY{streak30d !== 1 ? 's' : ''} for {driver} in last 30 days
          </span>
        </div>
      )}
      <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
        90-day price + verdict overlay · {data?.total_points || 0} graded sales · {scatter.length} scored
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => v?.slice(5)} />
            <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
              formatter={(v, name) => [`$${Number(v).toFixed(0)}`, name]}
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
            <Scatter
              data={scatter.map(p => ({ week: p.week, price: p.price, fill: p.fill }))}
              dataKey="price"
              shape={(props) => {
                const { cx, cy, payload } = props
                if (cx == null || cy == null) return null
                return <circle cx={cx} cy={cy} r={3.5} fill={payload.fill} stroke="#0b0b0b" strokeWidth={0.5} />
              }}
              name="Sales (verdict)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Verdict color legend */}
      <div className="flex flex-wrap gap-3 pt-1 text-[10px] text-gray-400">
        {[
          { k: 'STRONG_BUY', label: 'Strong Buy' },
          { k: 'GOOD_BUY',   label: 'Good Buy' },
          { k: 'FAIR',       label: 'Fair' },
          { k: 'OVERPRICED', label: 'Overpriced' },
          { k: 'PASS',       label: 'Pass' },
        ].map(({ k, label }) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: VERDICT_STYLES[k].dot }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
