import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Flame, DollarSign, BarChart3, Eye, Check, Bell, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react'
import { applySeasonFilter } from '../lib/season'
import { ebayAffiliateUrl } from '../lib/ebay'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const LS_KEY = 'cc_last_today_visit'

function formatRelative(iso) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  const d = Date.now() - t
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

export default function Today() {
  const since = useMemo(() => {
    try {
      return localStorage.getItem(LS_KEY) || new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    } catch {
      return new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    }
  }, [])

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'What changed today · F1 Card Hub'
    fetch(`${API}/api/today?since=${encodeURIComponent(since)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          if (Array.isArray(d.new_sales)) d.new_sales = applySeasonFilter(d.new_sales)
          if (Array.isArray(d.new_alerts)) d.new_alerts = applySeasonFilter(d.new_alerts)
          if (Array.isArray(d.biggest_movers_24h)) d.biggest_movers_24h = applySeasonFilter(d.biggest_movers_24h)
        }
        setData(d); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [since])

  const markRead = () => {
    try { localStorage.setItem(LS_KEY, new Date().toISOString()) } catch {}
    // Let other tabs / Layout pick up the new count
    window.dispatchEvent(new Event('cc-today-read'))
    alert('Marked as read. Badge will clear on next refresh.')
  }

  if (loading) {
    return <div className="panel h-96 animate-pulse max-w-5xl" />
  }
  if (!data) {
    return <div className="panel p-8 text-gray-500 text-sm max-w-5xl">Could not load today's changes.</div>
  }

  const { new_sales, new_alerts, watchlist_changes, biggest_movers_24h, new_strong_buys_count, total_changes } = data

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><Bell size={20} className="text-red-400" /> What changed today</h1>
          <p className="text-xs text-gray-500 mt-1">Since {new Date(since).toLocaleString()} · {total_changes} updates</p>
        </div>
        <button onClick={markRead} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg flex items-center gap-1.5">
          <Check size={12} /> Mark as read
        </button>
      </div>

      {/* New Strong Buys */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><Flame size={14} className="text-orange-400" /> New Strong Buys</h2>
          <span className="text-[11px] text-gray-500">{new_strong_buys_count} listings ≤60% of median</span>
        </div>
        {new_strong_buys_count > 0 ? (
          <Link to="/auctions" className="block bg-orange-900/20 hover:bg-orange-900/30 border border-orange-800/40 rounded-lg p-3 text-center transition-colors">
            <div className="text-2xl font-black text-orange-400">{new_strong_buys_count}</div>
            <div className="text-xs text-gray-300 mt-0.5">View in Live Auctions →</div>
          </Link>
        ) : (
          <p className="text-xs text-gray-600 italic py-2">No new strong buys since your last visit.</p>
        )}
      </div>

      {/* New Sales */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><DollarSign size={14} className="text-green-400" /> New Sales</h2>
          <span className="text-[11px] text-gray-500">{data.new_sales_total} total · showing {new_sales.length}</span>
        </div>
        {new_sales.length === 0 ? (
          <p className="text-xs text-gray-600 italic py-2">No new sold listings since your last visit.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr><th>Driver</th><th>Parallel</th><th>Grade</th><th className="text-right">Price</th><th>When</th><th></th></tr>
              </thead>
              <tbody>
                {new_sales.slice(0, 10).map(s => (
                  <tr key={s.id}>
                    <td className="font-semibold text-white text-xs">{s.driver || '—'}</td>
                    <td className="text-gray-400 text-xs">{s.parallel || '—'}</td>
                    <td className="text-xs">{s.grade || <span className="text-gray-600">Raw</span>}</td>
                    <td className="text-right font-bold text-green-400">${(s.sale_price || 0).toFixed(0)}</td>
                    <td className="text-[10px] text-gray-500">{formatRelative(s.sale_date)}</td>
                    <td>
                      {s.ebay_url && <a href={ebayAffiliateUrl(s.ebay_url)} target="_blank" rel="sponsored noopener" className="text-gray-500 hover:text-white"><ExternalLink size={11} /></a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Biggest Movers */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><BarChart3 size={14} className="text-blue-400" /> Biggest Movers (24h)</h2>
        </div>
        {biggest_movers_24h.length === 0 ? (
          <p className="text-xs text-gray-600 italic py-2">Not enough data for 24h price moves yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {biggest_movers_24h.map((m, i) => {
              const up = m.delta_pct > 0
              return (
                <div key={i} className={`rounded-lg p-3 flex items-center gap-3 border ${up ? 'bg-green-900/10 border-green-800/30' : 'bg-red-900/10 border-red-800/30'}`}>
                  {up ? <TrendingUp size={16} className="text-green-400 shrink-0" /> : <TrendingDown size={16} className="text-red-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white font-bold truncate">{m.driver} · {m.parallel}</div>
                    <div className="text-[10px] text-gray-500">
                      ${m.prior_median?.toFixed(0)} → ${m.recent_median?.toFixed(0)} ({m.recent_n}/{m.prior_n} sales)
                    </div>
                  </div>
                  <div className={`font-black text-sm ${up ? 'text-green-400' : 'text-red-400'}`}>
                    {up ? '+' : ''}{m.delta_pct.toFixed(0)}%
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Watchlist updates */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><Eye size={14} className="text-purple-400" /> Watchlist Updates</h2>
          <span className="text-[11px] text-gray-500">{watchlist_changes.length} items</span>
        </div>
        {watchlist_changes.length === 0 ? (
          <p className="text-xs text-gray-600 italic py-2">No watchlist price moves since your last visit.</p>
        ) : (
          <div className="space-y-2">
            {watchlist_changes.slice(0, 10).map(w => (
              <a key={w.id} href={w.ebay_url ? ebayAffiliateUrl(w.ebay_url) : '#'} target="_blank" rel="sponsored noopener"
                className="flex items-center gap-3 bg-gray-800/60 hover:bg-gray-800 rounded-lg p-2.5 transition-colors">
                {w.image_url && <img src={w.image_url} alt="" className="w-10 h-12 rounded object-cover bg-gray-900" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white font-semibold truncate">{w.title}</div>
                  <div className="text-[10px] text-gray-500">{w.driver} · {w.parallel} · {formatRelative(w.last_updated)}</div>
                </div>
                <div className="text-green-400 font-black text-sm">${(w.current_price || 0).toFixed(0)}</div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* New alerts */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><Bell size={14} className="text-red-400" /> New Alerts</h2>
          <span className="text-[11px] text-gray-500">{new_alerts.reduce((s, a) => s + a.count, 0)} total</span>
        </div>
        {new_alerts.length === 0 ? (
          <p className="text-xs text-gray-600 italic py-2">No new alerts fired since your last visit.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {new_alerts.map(a => (
              <div key={a.alert_type} className="bg-gray-800/60 rounded-lg p-2.5 border border-gray-700/40">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white uppercase tracking-wide">{a.alert_type.replace(/_/g, ' ')}</div>
                  <div className="text-sm font-black text-red-400">{a.count}</div>
                </div>
                {a.samples?.[0] && (
                  <div className="text-[10px] text-gray-500 mt-1 truncate">{a.samples[0].message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
