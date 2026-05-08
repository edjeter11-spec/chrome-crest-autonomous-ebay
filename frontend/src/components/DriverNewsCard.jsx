import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

export default function DriverNewsCard({ driverName }) {
  const [facts, setFacts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!driverName) return
    setLoading(true)
    fetch(`${API}/api/drivers/${encodeURIComponent(driverName)}/news`)
      .then(r => r.ok ? r.json() : { facts: [] })
      .then(d => setFacts(d.facts || []))
      .catch(() => setFacts([]))
      .finally(() => setLoading(false))
  }, [driverName])

  if (loading) {
    return <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4 animate-pulse h-20" />
  }
  if (!facts.length) return null

  const fmtDate = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      const days = Math.floor((Date.now() - d.getTime()) / 86400000)
      if (days === 0) return 'today'
      if (days === 1) return 'yesterday'
      if (days < 7) return `${days}d ago`
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
        What's moving
      </div>
      {facts.map((f, i) => (
        <div key={i} className="flex items-start gap-2.5 text-sm">
          <span className="text-base shrink-0">{f.icon}</span>
          <div className="flex-1 min-w-0">
            <div className={`font-semibold ${
              f.impact === 'high' ? 'text-emerald-300' :
              f.impact === 'medium' ? 'text-white' : 'text-gray-300'
            }`}>{f.headline}</div>
            <div className="text-[10px] text-gray-500">{fmtDate(f.date)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
