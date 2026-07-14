import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { useAuth } from '../lib/auth'

const STORAGE_KEY = 'cc_signedout_banner_dismissed_v1'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export default function SignedOutBanner() {
  const { user } = useAuth()
  const location = useLocation()
  const [dismissed, setDismissed] = useState(true) // default hidden until we read localStorage

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) { setDismissed(false); return }
      const parsed = JSON.parse(raw)
      const ts = typeof parsed?.dismissedAt === 'number' ? parsed.dismissedAt : 0
      if (!ts || Date.now() - ts > SEVEN_DAYS_MS) {
        setDismissed(false)
      } else {
        setDismissed(true)
      }
    } catch {
      setDismissed(false)
    }
  }, [])

  if (user) return null
  if (location.pathname === '/login') return null
  if (dismissed) return null

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissedAt: Date.now() }))
    } catch {}
    setDismissed(true)
  }

  return (
    <div className="bg-gradient-to-r from-red-900 to-red-700 border border-red-600/40 rounded-xl shadow-lg shadow-red-900/30 px-3 md:px-4 py-2.5 mb-4 flex items-center gap-2 md:gap-3">
      <span className="text-xs md:text-sm font-bold text-white flex-1 leading-snug">
        Sign in to set snipe alerts, save your watchlist, and build your portfolio
      </span>
      <Link
        to="/login"
        className="shrink-0 inline-flex items-center justify-center px-3 py-2 min-h-[40px] sm:min-h-0 sm:py-1.5 rounded-lg bg-white text-red-800 hover:bg-red-50 text-xs md:text-sm font-black tracking-tight transition-colors shadow"
      >
        Sign in
      </Link>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 inline-flex items-center justify-center w-10 h-10 sm:w-auto sm:h-auto sm:p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  )
}
