import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { Flame } from 'lucide-react'
import { verdictFor, VERDICT_STYLES } from '../lib/verdict'
import { binSeriesByPeriod, detectBinType, formatBinLabel } from '../lib/chartBinning'

const API = import.meta.env.VITE_API_URL || ''

const GRADE_COLORS = {
  'PSA 10': '#F59E0B',
  'PSA 9': '#3B82F6',
  'PSA 8': '#8B5CF6',
  'BGS': '#10B981',
  'SGC': '#14B8A6',
  'Raw': '#9CA3AF',
}

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
  const [parallelFilter, setParallelFilter] = useState(null)

  useEffect(() => {
    if (!driver) return
    setLoading(true)
    setParallelFilter(null)
    Promise.all([
      fetch(`${API}/api/psa/timeseries?driver=${encodeURIComponent(driver)}&days=${days}`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/sales?driver=${encodeURIComponent(driver)}&limit=400&year=2025&exclude_source=SportsCardsPro`).then(r => r.json()).catch(() => ({ sales: [] })),
    ]).then(([ts, raw]) => {
      setData(ts)
      setSalesRaw(raw?.sales || [])
      setLoading(false)
    })
  }, [driver, days])

  // Count sales by parallel to find the top one
  const parallelCounts = useMemo(() => {
    const counts = new Map()
    for (const s of salesRaw) {
      const p = s.parallel || 'Base'
      counts.set(p, (counts.get(p) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [salesRaw])

  const topParallels = useMemo(() => parallelCounts.slice(0, 5).map(([p]) => p), [parallelCounts])

  // Default to top parallel once data loads
  const activeParallel = parallelFilter ?? topParallels[0] ?? null

  // Filter sales by active parallel
  const filteredSales = useMemo(() => {
    if (!activeParallel) return salesRaw
    return salesRaw.filter(s => (s.parallel || 'Base') === activeParallel)
  }, [salesRaw, activeParallel])

  const { scatter, streak30d } = useMemo(() => {
    if (!filteredSales.length) return { scatter: [], streak30d: 0 }
    const byGrade = new Map()
    for (const s of filteredSales) {
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
    for (const s of filteredSales) {
      if (!s.sale_date) continue
      const total = s.total_cost ?? s.sale_price
      const g = s.grade || 'Raw'
      const med = medByGrade.get(g)
      const n = byGrade.get(g)?.length || 0
      const v = verdictFor(total, med, n, 4)
      if (!v) continue
      const d = new Date(s.sale_date)
      const ts = d.getTime()
      const day = d.getUTCDay()
      const diff = (day + 6) % 7
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
  }, [filteredSales])

  // Build line series directly from filtered sales (median per week per grade)
  const lineSeries = useMemo(() => {
    if (!filteredSales.length) return []
    const byWeekGrade = new Map()
    for (const s of filteredSales) {
      if (!s.sale_date) continue
      const total = s.total_cost ?? s.sale_price
      if (!total) continue
      const g = s.grade || 'Raw'
      const d = new Date(s.sale_date)
      const day = d.getUTCDay()
      const diff = (day + 6) % 7
      const mon = new Date(d)
      mon.setUTCDate(d.getUTCDate() - diff)
      const weekKey = mon.toISOString().slice(0, 10)
      const key = `${weekKey}|${g}`
      if (!byWeekGrade.has(key)) byWeekGrade.set(key, { week_start: weekKey, grade: g, prices: [] })
      byWeekGrade.get(key).prices.push(total)
    }
    return [...byWeekGrade.values()].map(r => ({
      week_start: r.week_start,
      grade: r.grade,
      avg_price: median(r.prices),
    }))
  }, [filteredSales])

  const binType = useMemo(() => detectBinType(lineSeries, 3), [lineSeries])

  if (loading) return <div className="h-56 skeleton rounded-xl" />

  if (!filteredSales.length) {
    return (
      <div className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-3 space-y-2">
        {topParallels.length > 0 && (
          <ParallelToggle
            parallels={topParallels}
            active={activeParallel}
            counts={Object.fromEntries(parallelCounts)}
            onChange={setParallelFilter}
          />
        )}
        <div className="h-40 flex items-center justify-center text-xs text-gray-600 border border-gray-800/40 rounded-xl bg-gray-900/40">
          No sales for this parallel yet
        </div>
      </div>
    )
  }

  const pivot = new Map()
  const grades = new Set()

  if (binType === 'weekly') {
    for (const p of lineSeries) {
      const k = p.week_start.slice(0, 10)
      if (!pivot.has(k)) pivot.set(k, { bin: k, week: k })
      pivot.get(k)[p.grade] = p.avg_price
      grades.add(p.grade)
    }
  } else {
    const binned = binSeriesByPeriod(lineSeries, binType)
    for (const row of binned) {
      pivot.set(row.bin, { bin: row.bin, week: row.bin, ...row })
      for (const [grade, price] of Object.entries(row)) {
        if (grade !== 'bin' && grade !== 'week' && !isNaN(price)) {
          grades.add(grade)
        }
      }
    }
  }

  for (const sp of scatter) {
    if (!pivot.has(sp.week)) {
      pivot.set(sp.week, { bin: sp.week, week: sp.week })
    }
  }
  const rows = [...pivot.values()].sort((a, b) => a.bin.localeCompare(b.bin))

  return (
    <div className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-3 space-y-2">
      {topParallels.length > 0 && (
        <ParallelToggle
          parallels={topParallels}
          active={activeParallel}
          counts={Object.fromEntries(parallelCounts)}
          onChange={setParallelFilter}
        />
      )}
      {streak30d > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/20 border border-green-700/40">
          <Flame size={13} className="text-green-400" />
          <span className="text-xs text-green-300 font-bold">
            {streak30d} STRONG BUY{streak30d !== 1 ? 's' : ''} for {driver} in last 30 days
          </span>
        </div>
      )}
      <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
        {activeParallel || 'All'} · {filteredSales.length} sales · {scatter.length} scored
        {binType !== 'weekly' && (
          <span className="ml-3 text-amber-600 font-semibold">
            {binType === 'biweekly' ? '(bi-weekly)' : '(14-day rolling)'}
          </span>
        )}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fill: '#6B7280', fontSize: 10 }} tickFormatter={v => formatBinLabel(v, binType)} />
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
              name="Sales"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
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

function ParallelToggle({ parallels, active, counts, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[9px] uppercase font-black text-gray-500 tracking-widest">Parallel:</span>
      {parallels.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-colors ${
            active === p
              ? 'bg-red-600/30 border-red-500/60 text-red-200'
              : 'bg-gray-800/60 border-gray-700/40 text-gray-400 hover:text-gray-200'
          }`}
        >
          {p} <span className="text-gray-500 font-normal">({counts[p]})</span>
        </button>
      ))}
    </div>
  )
}
