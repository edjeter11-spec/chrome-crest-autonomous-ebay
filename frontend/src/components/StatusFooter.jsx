import { useEffect, useState } from 'react'
import { Activity, Keyboard } from 'lucide-react'
import { Link } from 'react-router-dom'

// Fix: every other module uses VITE_API_URL; using VITE_API_BASE made
// /api/health silently hit a relative URL on prod where only VITE_API_URL
// is defined — the health dot would read 'Offline' for everyone.
const API = import.meta.env.VITE_API_URL || ''

/**
 * Always-visible site status footer. Two jobs:
 *  1. Show "Live · synced Xm ago" so users know data is fresh
 *  2. Reachable shortcut to How We Score, FAQ, and the keyboard help dialog
 *
 * Polls /api/health lightly (every 5 min) and reads last-sync from a
 * shared timestamp in localStorage that the Dashboard writes to. Falls
 * back to "Live" when no timestamp is available.
 */
export default function StatusFooter() {
  const [healthy, setHealthy] = useState(true)
  const [agoMin, setAgoMin] = useState(null)

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const r = await fetch(`${API}/api/health`, { cache: 'no-store' })
        if (!alive) return
        setHealthy(r.ok)
      } catch {
        if (alive) setHealthy(false)
      }
    }
    check()
    const t = setInterval(check, 5 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  // Tick the "Xm ago" label once a minute; read shared timestamp from
  // localStorage so Dashboard's lastSync state propagates here.
  useEffect(() => {
    const tick = () => {
      try {
        const ts = parseInt(localStorage.getItem('lastSyncAt') || '0', 10)
        if (!ts) { setAgoMin(null); return }
        const m = Math.max(0, Math.floor((Date.now() - ts) / 60000))
        setAgoMin(m)
      } catch { setAgoMin(null) }
    }
    tick()
    const t = setInterval(tick, 30 * 1000)
    return () => clearInterval(t)
  }, [])

  const dotClass = healthy ? 'bg-emerald-400' : 'bg-red-500'
  const statusLabel = !healthy ? 'Offline' : agoMin == null ? 'Live' : `Synced ${agoMin}m ago`

  return (
    <footer className="mt-12 border-t border-gray-800/60 bg-gray-950/60 backdrop-blur-sm">
      <div className="max-w-[1800px] mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-gray-500">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass} ${healthy ? 'animate-pulse' : ''}`} />
          <Activity size={11} />
          <span>{statusLabel}</span>
          <span className="hidden sm:inline mx-1.5 text-gray-700">·</span>
          <span className="hidden sm:inline">F1 Card Vault</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/how-we-score" className="hover:text-gray-300 transition-colors">How we score</Link>
          <span className="text-gray-700">·</span>
          <Link to="/faq" className="hover:text-gray-300 transition-colors">FAQ</Link>
          <span className="text-gray-700">·</span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('app:show-shortcuts'))}
            className="inline-flex items-center gap-1 hover:text-gray-300 transition-colors"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={11} />
            <span>Shortcuts</span>
          </button>
        </div>
      </div>
    </footer>
  )
}
