import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Eye, ExternalLink, Gavel, Tag, Heart } from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'
import CardImage from '../components/CardImage'

const API = import.meta.env.VITE_API_URL || ''

export default function SharedWatchlist() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch(`${API}/api/watchlist/shared/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(() => setErr('Shared watchlist not found'))
  }, [token])

  if (err) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-2xl font-black text-white mb-2">404</div>
          <div className="text-gray-500">{err}</div>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    )
  }

  const auctions = data.items.filter(i => i.kind === 'auction')
  const wishes = data.items.filter(i => i.kind === 'wish')

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-black">F1</span>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">{data.name}</h1>
            <p className="text-xs text-gray-500">
              F1 Card Vault · Shared watchlist · {data.items.length} items · {data.view_count} view{data.view_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Watching live */}
        {auctions.length > 0 && (
          <section>
            <h2 className="text-sm font-black uppercase tracking-wider text-gray-300 mb-3 flex items-center gap-2">
              <Eye size={13} className="text-yellow-400" /> Watching ({auctions.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {auctions.map((a, i) => (
                <a
                  key={i}
                  href={ebayAffiliateUrl(a.ebay_url)}
                  target="_blank"
                  rel="sponsored noopener"
                  className="bg-gray-900/70 border border-gray-800 hover:border-gray-700 rounded-2xl p-3 flex gap-3 transition-colors"
                >
                  <CardImage
                    src={a.image_url}
                    alt=""
                    driverName={a.driver}
                    className="w-14 h-20 rounded-lg bg-gray-800 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400 line-clamp-2">{a.title}</div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {a.driver && <span className="text-xs font-bold text-white">{a.driver}</span>}
                      {a.parallel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/40">{a.parallel}</span>}
                    </div>
                    <div className="text-base font-black text-emerald-400 mt-1">${(a.price || 0).toFixed(2)}</div>
                  </div>
                  <ExternalLink size={12} className="text-gray-600 shrink-0" />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Wishlist */}
        {wishes.length > 0 && (
          <section>
            <h2 className="text-sm font-black uppercase tracking-wider text-gray-300 mb-3 flex items-center gap-2">
              <Heart size={13} className="text-pink-400" /> Wishlist ({wishes.length})
            </h2>
            <div className="space-y-2">
              {wishes.map((w, i) => (
                <div key={i} className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3 flex items-center gap-3">
                  <Heart size={14} className="text-pink-400/60 shrink-0" />
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white">{w.driver || '—'}</span>
                    {w.parallel && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{w.parallel}</span>}
                    {w.grade && w.grade !== 'Raw' && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400">{w.grade}</span>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">Max</div>
                    <div className="text-sm font-black text-emerald-400">${(w.max_price || 0).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="text-center pt-6">
          <a href="/" className="text-xs text-gray-500 hover:text-white">
            Built on F1 Card Vault →
          </a>
        </div>
      </div>
    </div>
  )
}
