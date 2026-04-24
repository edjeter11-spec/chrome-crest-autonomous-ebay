import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus, BarChart3, ArrowRight } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || ''

function ChangeBadge({ pct }) {
  if (pct === null || pct === undefined) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800/60 text-gray-400 border border-gray-700">
        <Minus className="w-3 h-3" /> n/a
      </span>
    )
  }
  const up = pct > 0
  const flat = pct === 0
  const cls = flat
    ? 'bg-gray-800/60 text-gray-300 border-gray-700'
    : up
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls}`}>
      <Icon className="w-3 h-3" />
      {up ? '+' : ''}{pct}%
    </span>
  )
}

function fmtValue(v) {
  if (v === null || v === undefined) return '—'
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function IndexTile() {
  const [indices, setIndices] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    swrFetch(
      `${API}/api/indices`,
      (data) => { if (data?.indices) setIndices(data.indices) },
      () => setLoading(false),
    )
  }, [])

  if (loading && !indices) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <div className="text-sm text-gray-400">Loading F1CV25 indices…</div>
      </div>
    )
  }

  if (!indices || indices.length === 0) {
    return null
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/80 to-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-amber-400" />
          <h2 className="text-base md:text-lg font-bold text-gray-100">F1CV25 Indices</h2>
          <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10">
            Beta
          </span>
        </div>
        <Link
          to="/indices"
          className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 font-medium"
        >
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-3 lg:grid-cols-5 md:gap-3 md:overflow-visible md:pb-0 -mx-1 px-1 snap-x">
        {indices.map((idx) => (
          <Link
            key={idx.slug}
            to="/indices"
            className="snap-start shrink-0 w-[220px] md:w-auto rounded-lg border border-gray-800 bg-gray-950/60 hover:bg-gray-900/80 hover:border-gray-700 p-3 transition"
          >
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold truncate">
              {idx.name.replace(/^F1CV25\s*/, '')}
            </div>
            <div className="mt-1 text-xl font-bold text-gray-100 tabular-nums">
              {fmtValue(idx.value)}
            </div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <ChangeBadge pct={idx.week_change_pct} />
              <span className="text-[10px] text-gray-500">7d</span>
              <ChangeBadge pct={idx.month_change_pct} />
              <span className="text-[10px] text-gray-500">30d</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
