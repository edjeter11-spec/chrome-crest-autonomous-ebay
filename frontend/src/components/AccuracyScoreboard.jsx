import { useEffect, useState } from 'react'
import { Trophy, Info, ShieldCheck } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || ''
const REFETCH_MS = 5 * 60 * 1000  // 5 min

function fmtPct(rate) {
  if (rate === null || rate === undefined) return '—'
  return `${Math.round(rate * 100)}%`
}

function Tile({ label, color, data }) {
  const pct = data?.win_rate
  const samples = data?.sample_size ?? 0
  const avgProfit = data?.avg_profit_pct
  const colorMap = {
    emerald: { ring: 'ring-emerald-500/30', text: 'text-emerald-300', bar: 'from-emerald-500/20 to-emerald-500/5' },
    cyan:    { ring: 'ring-cyan-500/30',    text: 'text-cyan-300',    bar: 'from-cyan-500/20 to-cyan-500/5'    },
  }
  const c = colorMap[color] || colorMap.emerald
  return (
    <div className={`relative rounded-xl border border-gray-800 bg-gradient-to-br ${c.bar} p-4 ring-1 ${c.ring}`}>
      <div className="flex items-baseline gap-2">
        <div className={`text-4xl md:text-5xl font-black ${c.text} tabular-nums`}>
          {fmtPct(pct)}
        </div>
        <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">
          {label} accuracy
        </div>
      </div>
      <div className="mt-2 text-[11px] text-gray-400">
        based on <span className="text-gray-200 font-semibold">{samples.toLocaleString()}</span> tracked picks (last 90d)
        {avgProfit != null && (
          <span className="ml-1 text-gray-500">· avg upside {avgProfit}%</span>
        )}
      </div>
    </div>
  )
}

function MethodologyTooltip({ open, onClose, methodology }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-w-md rounded-xl border border-gray-700 bg-gray-900 p-5 text-sm text-gray-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h3 className="font-bold text-base">How we measure verdict accuracy</h3>
        </div>
        <p className="text-gray-300 leading-relaxed">
          {methodology || (
            <>
              For each sold card we anchor on its sale price, then look at the
              median sold price for the same driver / parallel / grade over the
              following 90 days. If that forward median is higher, the verdict
              was profitable. We bucket anchors into STRONG_BUY (≥25% below the
              forward median) and GOOD_BUY (10–25% below).
            </>
          )}
        </p>
        <p className="mt-3 text-[11px] text-gray-500">
          This is a proxy until we backfill a full historical-verdict log. We
          publish it openly so you can audit our calls.
        </p>
        <button
          onClick={onClose}
          className="mt-4 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gray-200"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 animate-pulse">
            <div className="h-10 w-24 bg-gray-800 rounded mb-3" />
            <div className="h-3 w-48 bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AccuracyScoreboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    function load() {
      setErrored(false)
      // Use a fresh fetch wrapped in try/catch — swrFetch swallows errors,
      // so detect via timeout on first load.
      fetch(`${API}/api/verdict/scoreboard`)
        .then((r) => {
          if (!r.ok) throw new Error(r.status)
          return r.json()
        })
        .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
        .catch(() => { if (!cancelled) { setErrored(true); setLoading(false) } })
    }
    load()
    const id = setInterval(load, REFETCH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (loading) return <Skeleton />
  // Error state — hide entirely so we never break the dashboard.
  if (errored || !data) return null

  const sb = data.strong_buy || {}
  const gb = data.good_buy || {}
  // Hide if there's truly no data to show.
  if ((sb.sample_size || 0) === 0 && (gb.sample_size || 0) === 0) return null

  return (
    <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/80 to-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          <h2 className="text-base md:text-lg font-bold text-gray-100">Verdict Accuracy</h2>
          <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-emerald-400/80 font-semibold px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10">
            Public
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMethodOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 font-medium"
          title="How we measure this"
        >
          <Info className="w-3 h-3" />
          How we measure this
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Tile label="STRONG_BUY" color="emerald" data={sb} />
        <Tile label="GOOD_BUY" color="cyan" data={gb} />
      </div>

      <div className="mt-3 text-[10px] text-gray-500 flex items-center justify-between">
        <span>{(data.total_tracked || 0).toLocaleString()} tracked picks · {data.window_days || 90}d window</span>
        {data.last_updated && (
          <span title={data.last_updated}>updated {new Date(data.last_updated).toLocaleDateString()}</span>
        )}
      </div>

      <MethodologyTooltip
        open={methodOpen}
        onClose={() => setMethodOpen(false)}
        methodology={data.methodology}
      />
    </div>
  )
}
