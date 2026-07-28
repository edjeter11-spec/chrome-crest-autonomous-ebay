import { useState } from 'react'
import { X, Share2, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

const API = import.meta.env.VITE_API_URL || ''

export default function ShareWatchlistModal({ onClose }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  const share = async () => {
    setBusy(true); setErr('')
    try {
      // Share now requires a signed-in user server-side (it snapshots YOUR
      // wishlist rows only — the old anonymous path leaked everyone's).
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) throw new Error('Sign in to share your watchlist')
      const res = await fetch(`${API}/api/watchlist/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name || null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResult(await res.json())
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  const shareUrl = result ? `${window.location.origin}/share/watchlist/${result.token}` : ''

  const copy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-blue-400" />
            <h3 className="text-lg font-black text-white">Share Watchlist</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400">
            <X size={16} />
          </button>
        </div>
        {!result ? (
          <>
            <p className="text-xs text-gray-400 mb-3">
              Creates a public snapshot link of everything on your watchlist + wishlist. Anyone with the link can view.
            </p>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">
              Name (optional)
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. My F1 Chase Cards"
              className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 mb-4"
            />
            {err && <div className="text-xs text-red-400 mb-3">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button
                onClick={share}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold"
              >
                {busy ? 'Creating…' : 'Create Share Link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs text-emerald-400 mb-3 font-bold">
              Snapshot created · {result.count} item{result.count !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-2 mb-4">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 font-mono"
                onFocus={e => e.target.select()}
              />
              <button
                onClick={copy}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white border border-gray-700"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">
              Done
            </button>
          </>
        )}
      </div>
    </div>
  )
}
