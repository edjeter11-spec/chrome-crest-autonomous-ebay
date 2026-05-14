import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, BarChart3, Info } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || ''

function fmtValue(v) {
  if (v === null || v === undefined) return '—'
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function ChangeBadge({ pct, label }) {
  const missing = pct === null || pct === undefined
  const up = !missing && pct > 0
  const flat = !missing && pct === 0
  const cls = missing
    ? 'bg-gray-800/60 text-gray-400 border-gray-700'
    : flat
      ? 'bg-gray-800/60 text-gray-300 border-gray-700'
      : up
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  const Icon = missing || flat ? Minus : up ? TrendingUp : TrendingDown
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      <span>{missing ? 'n/a' : `${up ? '+' : ''}${pct}%`}</span>
      <span className="text-[10px] uppercase tracking-wide opacity-70">{label}</span>
    </div>
  )
}

function IndexChart({ slug, series }) {
  // Backward-compat: if a `series` prop is provided (Indices page batches all
  // histories in a single request), use it directly. Otherwise fall back to
  // the per-slug fetch so other callers keep working.
  const [points, setPoints] = useState(series ?? null)
  const [loading, setLoading] = useState(series == null)

  useEffect(() => {
    if (series != null) {
      setPoints(series)
      setLoading(false)
      return
    }
    if (!slug) return
    setLoading(true)
    swrFetch(
      `${API}/api/indices/${slug}/history?days=90`,
      (data) => { if (data?.points) setPoints(data.points) },
      () => setLoading(false),
    )
  }, [slug, series])

  const cleanPoints = (points || []).filter(p => p.value !== null && p.value !== undefined)

  if (loading && !points) {
    return <div className="h-48 flex items-center justify-center text-xs text-gray-500">Loading chart…</div>
  }
  if (cleanPoints.length < 2) {
    return <div className="h-48 flex items-center justify-center text-xs text-gray-500">Not enough data for a 90-day chart yet.</div>
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={cleanPoints} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id={`grad-${slug}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v}`} />
          <Tooltip
            contentStyle={{ background: '#0b0f1a', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v) => [fmtValue(v), 'Median']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#f59e0b"
            strokeWidth={2}
            fill={`url(#grad-${slug})`}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Indices() {
  const [indices, setIndices] = useState(null)
  const [asOf, setAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  // { [slug]: [{date, value}, ...] } — single batched fetch instead of one per chart.
  const [historyBySlug, setHistoryBySlug] = useState({})

  useEffect(() => {
    setLoading(true)
    swrFetch(
      `${API}/api/indices`,
      (data) => {
        if (data?.indices) setIndices(data.indices)
        if (data?.as_of) setAsOf(data.as_of)
      },
      () => setLoading(false),
    )
  }, [])

  // Once we know which slugs to render, batch-fetch all histories in one call.
  useEffect(() => {
    if (!indices || indices.length === 0) return
    const slugs = indices.map(i => i.slug).join(',')
    swrFetch(
      `${API}/api/indices/history?days=90&slugs=${encodeURIComponent(slugs)}`,
      (data) => {
        if (data && typeof data === 'object') setHistoryBySlug(data)
      },
    )
  }, [indices])

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl md:text-3xl font-bold text-gray-100">F1CV25 Card Indices</h1>
            <span className="text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10">
              Beta
            </span>
          </div>
          {asOf && (
            <div className="text-xs text-gray-500 mt-1">
              As of {new Date(asOf).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* Educational callout */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-gray-300 leading-relaxed">
            <p className="font-semibold text-gray-100 mb-1">What is a card index?</p>
            <p>
              A card index is an equal-weighted basket of related cards — think S&amp;P 500, but for F1 cardboard.
              Each index tracks the <span className="text-amber-300 font-medium">median sale price</span> of its basket over a rolling 14-day window,
              sampled every 3 days for the last 90 days. Use them to see whether a segment (rookies, autos, gold /50s)
              is trending up or down without getting lost in the noise of a single card.
            </p>
          </div>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && !indices && (
        <div className="text-sm text-gray-400">Loading indices…</div>
      )}

      {/* Index list */}
      <div className="space-y-6">
        {(indices || []).map((idx) => (
          <div
            key={idx.slug}
            className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 md:p-5"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
              <div className="min-w-0">
                <h2 className="text-lg md:text-xl font-bold text-gray-100">{idx.name}</h2>
                <p className="text-sm text-gray-400 mt-0.5">{idx.description}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl md:text-3xl font-bold text-gray-100 tabular-nums">
                  {fmtValue(idx.value)}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap justify-end">
                  <ChangeBadge pct={idx.week_change_pct} label="7d" />
                  <ChangeBadge pct={idx.month_change_pct} label="30d" />
                </div>
              </div>
            </div>

            <IndexChart slug={idx.slug} series={historyBySlug[idx.slug]} />
          </div>
        ))}
      </div>

      {/* Footer disclaimer */}
      <div className="text-xs text-gray-500 leading-relaxed pt-4 border-t border-gray-800">
        Indices are calculated from raw sold-card data and reflect median prices within a rolling 14-day window.
        Missing data points may appear in early or illiquid baskets. Not financial advice — for entertainment and
        research purposes only.
      </div>
    </div>
  )
}
