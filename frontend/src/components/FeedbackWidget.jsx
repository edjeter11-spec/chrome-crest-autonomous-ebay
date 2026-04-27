import { useState, useEffect, useRef } from 'react'
import { MessageSquarePlus, X, Check } from 'lucide-react'
import { useAuth } from '../lib/auth'

const API = import.meta.env.VITE_API_URL || ''

// Floating bottom-right widget — small "💬 Suggest" button that expands to a
// quick textarea so visitors can report issues / suggest changes without
// leaving the page. Anonymous-friendly. Eddie reads via /api/feedback/list.
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const taRef = useRef(null)
  const { user } = useAuth() || { user: null }

  useEffect(() => {
    if (open && taRef.current) {
      setTimeout(() => taRef.current?.focus(), 50)
    }
    if (!open) {
      setSent(false)
      setError('')
    }
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const submit = async () => {
    const trimmed = msg.trim()
    if (trimmed.length < 2) {
      setError('Please write a bit more.')
      return
    }
    setSending(true)
    setError('')
    try {
      const r = await fetch(`${API}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          page_url: typeof window !== 'undefined'
            ? window.location.pathname + window.location.search
            : null,
          email: user?.email || null,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setSent(true)
      setMsg('')
      setTimeout(() => setOpen(false), 1500)
    } catch (e) {
      setError('Could not send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60]">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Suggest an improvement or report a problem"
          title="Suggest / report"
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700 shadow-lg backdrop-blur text-xs font-bold transition-colors"
        >
          <MessageSquarePlus size={14} />
          <span className="hidden sm:inline">Suggest</span>
        </button>
      )}

      {open && (
        <div
          className="w-[300px] sm:w-[340px] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-4 animate-in"
          role="dialog"
          aria-label="Send feedback"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-black text-white">Suggestions / Issues</div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
            >
              <X size={14} />
            </button>
          </div>

          {sent ? (
            <div className="flex items-center gap-2 py-3 text-emerald-300 text-sm">
              <Check size={16} /> Thanks — we got it.
            </div>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 mb-2 leading-snug">
                Spot a bug or have an idea? Let us know — Eddie reads every one.
              </p>
              <textarea
                ref={taRef}
                value={msg}
                onChange={e => setMsg(e.target.value)}
                placeholder="What would make this better?"
                rows={4}
                maxLength={2000}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500 resize-none"
              />
              {error && (
                <div className="text-[11px] text-red-400 mt-1.5">{error}</div>
              )}
              <div className="flex items-center justify-between mt-2 gap-2">
                <span className="text-[10px] text-gray-600">
                  {user?.email ? `Sending as ${user.email}` : 'Anonymous'} · {msg.length}/2000
                </span>
                <button
                  onClick={submit}
                  disabled={sending || msg.trim().length < 2}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
