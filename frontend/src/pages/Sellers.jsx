import { useEffect, useState } from 'react'
import { ExternalLink, Shield, AlertTriangle } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const FLAG_STYLE = {
  top_rated:    'bg-yellow-900/40 text-yellow-300 border-yellow-800/40',
  power_lister: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
  flooder:      'bg-orange-900/40 text-orange-300 border-orange-800/40',
  low_feedback: 'bg-gray-800 text-gray-400 border-gray-700',
  suspicious:   'bg-red-900/40 text-red-300 border-red-800/40',
  many_unsold:  'bg-purple-900/40 text-purple-300 border-purple-800/40',
}

function FlagBadge({ flag }) {
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${FLAG_STYLE[flag] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {flag.replace(/_/g, ' ')}
    </span>
  )
}

function SellerRow({ s }) {
  return (
    <div className="panel p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <a
          href={s.ebay_seller_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold text-white hover:text-red-400 truncate flex items-center gap-1"
        >
          {s.seller} <ExternalLink size={10} />
        </a>
        <span className="text-[10px] text-gray-500 shrink-0">{s.total_feedback?.toLocaleString() || '0'} feedback</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500">
        <div><div className="text-white font-bold">{s.active_listings}</div>active</div>
        <div><div className="text-white font-bold">{s.recent_listings_24h}</div>24h new</div>
        <div><div className="text-white font-bold">${s.avg_card_price?.toFixed(0) || '0'}</div>avg price</div>
      </div>
      {s.flags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.flags.map(f => <FlagBadge key={f} flag={f} />)}
        </div>
      )}
    </div>
  )
}

export default function Sellers() {
  const [sus, setSus] = useState(null)
  const [top, setTop] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/sellers/suspicious?limit=30`).then(r => r.json()).then(d => setSus(d?.sellers || [])).catch(() => setSus([]))
    fetch(`${API}/api/sellers/top-rated?limit=30`).then(r => r.json()).then(d => setTop(d?.sellers || [])).catch(() => setTop([]))
  }, [])

  return (
    <div className="space-y-5 max-w-6xl">
      <h1 className="page-title">Sellers</h1>
      <p className="text-xs text-gray-500">Derived from seller patterns across live auctions.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" /> Suspicious sellers
            {sus && <span className="text-[10px] text-gray-500 font-normal">· {sus.length}</span>}
          </h2>
          {sus === null ? (
            <div className="panel h-32 animate-pulse" />
          ) : sus.length === 0 ? (
            <div className="panel p-4 text-sm text-gray-500">No suspicious sellers detected.</div>
          ) : (
            <div className="space-y-2">
              {sus.map(s => <SellerRow key={s.seller} s={s} />)}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Shield size={14} className="text-yellow-400" /> Top-rated sellers
            {top && <span className="text-[10px] text-gray-500 font-normal">· {top.length}</span>}
          </h2>
          {top === null ? (
            <div className="panel h-32 animate-pulse" />
          ) : top.length === 0 ? (
            <div className="panel p-4 text-sm text-gray-500">No top-rated sellers yet.</div>
          ) : (
            <div className="space-y-2">
              {top.map(s => <SellerRow key={s.seller} s={s} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
