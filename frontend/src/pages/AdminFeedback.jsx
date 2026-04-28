import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inbox, Check, RefreshCw, ExternalLink, Lock } from 'lucide-react'
import { usePageTitle } from '../lib/pageTitle'

const API = import.meta.env.VITE_API_URL || ''

// Admin-only feedback inbox. Auth via ?token=<ADMIN_TOKEN> in the URL —
// matches the same pattern Eddie uses for /api/ebay/refresh and friends.
// We persist the token in localStorage after a successful list call so he
// only has to paste it once per browser.
export default function AdminFeedback() {
  usePageTitle('Feedback Inbox · Admin')
  const [params, setParams] = useSearchParams()
  const urlToken = params.get('token') || ''
  const [token, setToken] = useState(() => {
    if (urlToken) return urlToken
    try { return localStorage.getItem('cc_admin_token') || '' } catch { return '' }
  })
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState(new Set())

  const load = useCallback(async (t = token) => {
    if (!t) return
    setLoading(true); setError('')
    try {
      const r = await fetch(
        `${API}/api/feedback/list?only_open=${showResolved ? 'false' : 'true'}&limit=200`,
        { headers: { 'X-Admin-Token': t } }
      )
      if (r.status === 401 || r.status === 403) {
        setError('Unauthorized — token rejected.')
        try { localStorage.removeItem('cc_admin_token') } catch {}
        return
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setItems(d.items || [])
      try { localStorage.setItem('cc_admin_token', t) } catch {}
      // Clean the token out of the URL so it doesn't sit in history
      if (urlToken) setParams({}, { replace: true })
    } catch (e) {
      setError(`Load failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [token, showResolved, urlToken, setParams])

  useEffect(() => { if (token) load() }, [token, showResolved, load])

  const resolve = async (id) => {
    try {
      const r = await fetch(`${API}/api/feedback/${id}/resolve`, {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
      })
      if (r.ok) setItems(prev => prev.filter(it => it.id !== id))
    } catch {}
  }

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const fmtTime = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
      const ago = (Date.now() - d.getTime()) / 1000
      if (ago < 60) return 'just now'
      if (ago < 3600) return `${Math.floor(ago / 60)}m ago`
      if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`
      return `${Math.floor(ago / 86400)}d ago`
    } catch { return iso }
  }

  if (!token) {
    return (
      <div className="max-w-md mx-auto mt-12 px-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} className="text-amber-400" />
            <h1 className="text-lg font-black text-white">Admin Feedback Inbox</h1>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Paste your <code className="bg-gray-800 px-1 rounded">ADMIN_TOKEN</code> to view user submissions.
            Stored in localStorage; clear by signing out (just delete <code className="bg-gray-800 px-1 rounded">cc_admin_token</code>).
          </p>
          <input
            type="password"
            placeholder="ADMIN_TOKEN"
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            onKeyDown={e => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                setToken(e.target.value.trim())
              }
            }}
            autoFocus
          />
          <p className="text-[10px] text-gray-600 mt-2">Press Enter to log in.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Inbox size={18} className="text-red-400" />
          <h1 className="text-xl font-black text-white">Feedback Inbox</h1>
          <span className="text-xs text-gray-500">
            {loading ? '…' : `${items.length} ${showResolved ? 'total' : 'unresolved'}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResolved(s => !s)}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
          >
            {showResolved ? 'Show unresolved' : 'Show all (incl. resolved)'}
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            aria-label="Refresh"
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 text-sm px-4 py-2 rounded-lg">
          {error}
        </div>
      )}

      {items.length === 0 && !loading && !error && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center text-gray-600">
          <Inbox size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No feedback {showResolved ? 'yet' : 'open right now'}.</p>
        </div>
      )}

      <div className="space-y-2">
        {items.map(it => {
          const isOpen = expanded.has(it.id)
          const preview = it.message.length > 180 && !isOpen
            ? it.message.slice(0, 180) + '…'
            : it.message
          return (
            <div
              key={it.id}
              className={`bg-gray-900 border rounded-2xl p-4 ${it.resolved ? 'border-gray-800/50 opacity-60' : 'border-gray-800'}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                  <span className="font-mono text-gray-600">#{it.id}</span>
                  <span>·</span>
                  <span>{fmtTime(it.created_at)}</span>
                  {it.user_email && (
                    <>
                      <span>·</span>
                      <span className="text-gray-400">{it.user_email}</span>
                    </>
                  )}
                  {it.page_url && (
                    <>
                      <span>·</span>
                      <a
                        href={it.page_url}
                        target="_blank"
                        rel="noopener"
                        className="text-blue-400 hover:underline flex items-center gap-0.5"
                      >
                        {it.page_url} <ExternalLink size={9} />
                      </a>
                    </>
                  )}
                  {it.resolved && (
                    <span className="text-emerald-400 ml-1">· resolved</span>
                  )}
                </div>
                {!it.resolved && (
                  <button
                    onClick={() => resolve(it.id)}
                    className="shrink-0 flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-600/50 text-emerald-200"
                  >
                    <Check size={11} /> Resolve
                  </button>
                )}
              </div>
              <pre
                onClick={() => it.message.length > 180 && toggleExpand(it.id)}
                className={`text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed ${it.message.length > 180 ? 'cursor-pointer' : ''}`}
              >
                {preview}
              </pre>
              {it.message.length > 180 && (
                <button
                  onClick={() => toggleExpand(it.id)}
                  className="text-[11px] text-gray-500 hover:text-gray-300 mt-1"
                >
                  {isOpen ? 'show less' : 'show full'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
