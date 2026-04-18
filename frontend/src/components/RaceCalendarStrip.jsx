import { useEffect, useState } from 'react'
import { Flag, TrendingUp } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function RaceCalendarStrip() {
  const [data, setData] = useState(null)

  useEffect(() => {
    swrFetch(`${API}/api/races/upcoming?limit=3`, d => setData(d || null))
  }, [])

  if (!data?.races?.length) return null

  const next = data.races[0]
  const rest = data.races.slice(1)

  return (
    <div className="bg-gradient-to-r from-red-900/30 via-gray-900/60 to-gray-900/60 border border-red-600/30 rounded-2xl px-4 py-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <Flag size={14} className="text-red-400" />
          <span className="text-[10px] font-black uppercase tracking-wider text-red-300">Race Week</span>
        </div>
        {/* Next race big */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">{next.flag}</span>
          <div>
            <div className="text-sm font-black text-white leading-none">{next.name}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {next.circuit} · <span className="text-red-400 font-bold">{next.days_until === 0 ? 'today' : `${next.days_until}d`}</span>
            </div>
          </div>
        </div>
        {/* Upcoming */}
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          {rest.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-400">
              <span>{r.flag}</span>
              <span className="truncate max-w-[140px]">{r.name}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-500 font-mono">{r.days_until}d</span>
            </div>
          ))}
        </div>
      </div>
      {/* Race day signal */}
      {data.next_race_signal?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-red-900/30 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-bold">
            <TrendingUp size={10} className="text-amber-400" /> Race-day movers
          </div>
          {data.next_race_signal.map((s, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-900/20 border border-amber-800/30 text-amber-200">
              <span className="font-bold">{s.driver}</span>
              <span className="text-amber-400/60 ml-1">· {s.reason}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
