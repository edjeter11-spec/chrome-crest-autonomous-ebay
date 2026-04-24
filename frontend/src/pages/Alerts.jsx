import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Zap, AlertCircle, X, Trash2, Heart, Flame, ExternalLink, Mail } from 'lucide-react'
import { swrFetch } from '../lib/cache'
import { useVisibilityInterval } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { supabase, supabaseReady } from '../lib/supabase'

// Pull an eBay URL out of an alert message if it's embedded
function extractEbayUrl(msg) {
  if (!msg) return null
  const m = msg.match(/https?:\/\/(?:www\.)?ebay\.com\/\S+/i)
  return m ? m[0] : null
}

function alertTarget(alert) {
  // Prefer explicit linkage
  if (alert.auction_id) return { to: `/auctions?alert=${alert.auction_id}` }
  if (alert.card_id) return { to: `/card/${alert.card_id}` }
  const u = extractEbayUrl(alert.message)
  if (u) return { href: u }
  return { to: '/auctions' }
}

const API = import.meta.env.VITE_API_URL || ''

const URGENCY = {
  critical: { border: 'border-red-500/40', bg: 'bg-red-900/10', badge: 'bg-red-600 text-white', icon: 'text-red-400' },
  high:     { border: 'border-orange-500/40', bg: 'bg-orange-900/10', badge: 'bg-orange-600 text-white', icon: 'text-orange-400' },
  normal:   { border: 'border-gray-700/40', bg: 'bg-gray-900', badge: 'bg-gray-700 text-gray-300', icon: 'text-gray-500' },
  low:      { border: 'border-gray-800/40', bg: 'bg-gray-900', badge: 'bg-gray-800 text-gray-600', icon: 'text-gray-600' },
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const { user } = useAuth()
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailAddr, setEmailAddr] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')

  const load = () => swrFetch(`${API}/api/alerts?limit=100`, d => { setAlerts(d.alerts || d || []); setLoading(false) }, () => setLoading(false))

  useEffect(() => { load() }, [])
  useVisibilityInterval(load, 15000)

  // Hydrate email-alert prefs from Supabase user_metadata
  useEffect(() => {
    if (!user) return
    const meta = user.user_metadata || {}
    setEmailEnabled(Boolean(meta.email_alerts))
    setEmailAddr(meta.alert_email || user.email || '')
  }, [user])

  const saveEmailPrefs = async (nextEnabled, nextAddr) => {
    if (!supabaseReady || !user) {
      setEmailMsg('Sign in to enable email alerts')
      return
    }
    setEmailSaving(true)
    setEmailMsg('')
    try {
      const { error } = await supabase.auth.updateUser({
        data: { email_alerts: nextEnabled, alert_email: nextAddr || user.email || '' },
      })
      if (error) throw error
      setEmailMsg(nextEnabled ? 'Email alerts enabled' : 'Email alerts disabled')
      setTimeout(() => setEmailMsg(''), 2500)
    } catch (e) {
      setEmailMsg('Save failed — try again')
    } finally {
      setEmailSaving(false)
    }
  }

  const toggleEmail = () => {
    const next = !emailEnabled
    setEmailEnabled(next)
    saveEmailPrefs(next, emailAddr)
  }

  const saveEmailAddr = () => {
    if (!emailAddr || !emailAddr.includes('@')) {
      setEmailMsg('Enter a valid email')
      return
    }
    saveEmailPrefs(emailEnabled, emailAddr)
  }

  const dismiss = async (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
    await fetch(`${API}/api/alerts/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const clearAll = async () => {
    const q = filter !== 'all' ? `?urgency=${filter}` : ''
    setAlerts(prev => filter === 'all' ? [] : prev.filter(a => a.urgency !== filter))
    await fetch(`${API}/api/alerts${q}`, { method: 'DELETE' }).catch(() => {})
  }

  const critical = alerts.filter(a => a.urgency === 'critical')
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.urgency === filter)

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading
              ? <span className="skeleton inline-block w-20 h-3.5 rounded" />
              : <><span className="text-white font-semibold">{alerts.length}</span> total · auto-refreshes</>
            }
          </p>
        </div>
        <div className="flex gap-1.5 items-center flex-wrap">
          {['all', 'critical', 'high', 'normal'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-xl font-semibold capitalize transition-colors ${
                filter === f ? 'bg-red-600 text-white' : 'bg-gray-800/80 text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
          {filtered.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold bg-gray-800/80 text-red-400 hover:bg-red-900/30 transition-colors ml-1"
            >
              <Trash2 size={10} />
              Clear {filter === 'all' ? 'All' : filter}
            </button>
          )}
        </div>
      </div>

      {/* Email-alert preferences */}
      <div className="panel p-4 border border-gray-800/50">
        <div className="flex items-start gap-3">
          <Mail size={16} className="text-blue-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-100">Send me email alerts</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Get emailed when a watchlist card drops below your alert price.
                </p>
              </div>
              <button
                onClick={toggleEmail}
                disabled={!user || emailSaving}
                className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${
                  emailEnabled ? 'bg-red-600' : 'bg-gray-700'
                } ${!user || emailSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                aria-pressed={emailEnabled}
              >
                <span
                  className={`inline-block h-5 w-5 bg-white rounded-full shadow transform transition-transform ${
                    emailEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {user ? (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <input
                  type="email"
                  value={emailAddr}
                  onChange={(e) => setEmailAddr(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 min-w-[200px] bg-gray-900 border border-gray-700 rounded-xl px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500"
                  disabled={emailSaving}
                />
                <button
                  onClick={saveEmailAddr}
                  disabled={emailSaving}
                  className="text-xs px-3 py-1.5 rounded-xl font-semibold bg-gray-800/80 text-gray-300 hover:bg-gray-700/80 disabled:opacity-50"
                >
                  Save
                </button>
                {emailMsg && (
                  <span className="text-[11px] text-gray-400">{emailMsg}</span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-gray-600">
                <Link to="/login" className="text-red-400 hover:underline">Sign in</Link> to configure email alerts.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Critical banner */}
      {critical.length > 0 && (
        <div className="bg-red-900/15 border border-red-500/40 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={13} className="text-red-400" />
            <span className="font-bold text-red-400 text-sm">Critical Snipe Opportunities</span>
            <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{critical.length}</span>
          </div>
          <div className="space-y-1.5">
            {critical.map(a => (
              <div key={a.id} className="flex items-center gap-3 text-sm bg-red-900/15 rounded-xl px-3 py-2.5 border border-red-800/30">
                <Zap size={12} className="text-red-400 shrink-0" />
                <span className="flex-1 text-red-200 text-xs">{a.message}</span>
                <button onClick={() => dismiss(a.id)} className="text-red-700 hover:text-red-400 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array(8).fill(0).map((_, i) => <div key={i} className="h-16 panel animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-20 text-gray-600">
          <Bell size={36} className="mb-4 opacity-20" />
          <p className="text-sm font-medium">No alerts</p>
          <p className="text-xs mt-1 text-gray-700">Alerts fire automatically for snipe opportunities and wishlist matches</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(alert => {
            // Strong-buy & wishlist-match get distinct green/pink coloring so
            // they don't blend in with snipe alerts.
            const isStrongBuy = alert.alert_type === 'strong_buy'
            const isWishMatch = alert.alert_type === 'wishlist_match'
            let s = URGENCY[alert.urgency] || URGENCY.normal
            if (isStrongBuy) {
              s = { border: 'border-green-500/40', bg: 'bg-green-900/10', badge: 'bg-green-600 text-white', icon: 'text-green-400' }
            } else if (isWishMatch) {
              s = { border: 'border-pink-500/40', bg: 'bg-pink-900/10', badge: 'bg-pink-600 text-white', icon: 'text-pink-400' }
            }
            const Icon = isStrongBuy ? Flame : isWishMatch ? Heart : Zap
            const typeBadge = isStrongBuy ? 'STRONG BUY' : isWishMatch ? 'WISHLIST' : alert.urgency
            const target = alertTarget(alert)
            const Wrapper = target.href
              ? ({ children, className }) => (
                  <a href={target.href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
                )
              : ({ children, className }) => (
                  <Link to={target.to} className={className}>{children}</Link>
                )
            return (
              <div key={alert.id} className={`flex items-center gap-4 px-4 py-3 rounded-2xl border ${s.border} ${s.bg} group hover:bg-opacity-60 transition-colors`}>
                <Icon size={13} className={`shrink-0 ${s.icon}`} />
                <Wrapper className="flex-1 min-w-0 cursor-pointer">
                  <p className="text-sm text-gray-200 truncate font-medium flex items-center gap-1.5">
                    {alert.message}
                    <ExternalLink size={10} className="text-gray-600 shrink-0" />
                  </p>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {alert.alert_type?.replace(/_/g, ' ')} · {new Date(alert.created_at).toLocaleString()}
                  </p>
                </Wrapper>
                <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase shrink-0 ${s.badge}`}>
                  {typeBadge}
                </span>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(alert.id) }}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 transition-all ml-1"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
