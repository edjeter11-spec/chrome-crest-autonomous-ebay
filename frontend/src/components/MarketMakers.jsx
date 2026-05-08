import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { upscaleEbayImage } from '../lib/imageUrl'

const API = import.meta.env.VITE_API_URL || ''

export default function MarketMakers({ driverName }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!driverName) return
    setLoading(true)
    fetch(`${API}/api/sales/market-makers/${encodeURIComponent(driverName)}?min_price=200&days=90&limit=10`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [driverName])

  if (loading) {
    return (
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4 animate-pulse">
        <div className="h-3 bg-gray-800 rounded w-40 mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-24 bg-gray-800 rounded" />)}
        </div>
      </div>
    )
  }
  if (!data || !data.sales || data.sales.length === 0) return null

  const fmtDate = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-emerald-400" />
          <h3 className="text-sm font-black text-white">Market Makers</h3>
          <span className="text-[10px] text-gray-500 font-mono">${'>'}=$200 · 90d</span>
        </div>
        <div className="text-[10px] text-gray-400">
          <span className="text-emerald-300 font-bold">{data.stats.count}</span> sales
          {data.stats.peak_price > 0 && <> · peak <span className="text-emerald-300 font-bold">${Math.round(data.stats.peak_price).toLocaleString()}</span></>}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data.sales.map(s => (
          <div key={s.id} className="bg-gray-950/60 border border-gray-800/40 rounded-lg p-2.5 hover:border-emerald-700/40 transition-colors">
            {s.image_url ? (
              <img
                src={upscaleEbayImage(s.image_url, 300)}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-24 object-cover rounded mb-2 bg-gray-800"
              />
            ) : (
              <div className="w-full h-24 bg-gray-800 rounded mb-2" />
            )}
            <div className="text-xs font-bold text-emerald-300 tabular-nums mb-0.5">
              ${Math.round(s.sale_price + (s.shipping_cost || 0)).toLocaleString()}
            </div>
            {s.parallel && (
              <div className="text-[10px] text-gray-300 font-semibold truncate">{s.parallel}</div>
            )}
            {s.grade && s.grade !== 'Raw' && (
              <div className="text-[10px] text-amber-400 font-bold">{s.grade}</div>
            )}
            <div className="text-[10px] text-gray-500 mt-0.5">{fmtDate(s.sale_date)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
