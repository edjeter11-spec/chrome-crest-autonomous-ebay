import { useState, useEffect, useCallback } from 'react'

/**
 * First-time visitor onboarding modal.
 * Shows once per user (gated by `localStorage.getItem('cc_welcomed_v1')`).
 * Dismissable via Escape key, "Got it", or "Don't show again" — all set the
 * flag so it never re-appears.
 */
export default function WelcomeModal() {
  const [open, setOpen] = useState(false)

  // Check the localStorage gate after mount (avoids SSR / hydration mismatch).
  useEffect(() => {
    try {
      if (!localStorage.getItem('cc_welcomed_v1')) setOpen(true)
    } catch {
      // localStorage blocked (private mode etc.) — just don't show.
    }
  }, [])

  const dismiss = useCallback(() => {
    try { localStorage.setItem('cc_welcomed_v1', '1') } catch {}
    setOpen(false)
  }, [])

  // Keyboard: Escape closes (and sets the flag).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cc-welcome-title"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="cc-welcome-title"
          className="text-2xl font-black tracking-tight text-gray-900 dark:text-white"
        >
          Welcome to F1 Card Vault
        </h2>

        <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          <li>🏎️ Live tracker for every Topps F1 card on eBay — auctions, sold prices, graded recent sales.</li>
          <li>💎 We default to Premium cards ($100+ on auctions, $150+ on Buy It Now) — toggle off to see everything.</li>
          <li>🔥 Look for the flame rating — more flames = better deal vs. recent sales.</li>
        </ul>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-4 py-3 rounded-xl transition-colors"
            autoFocus
          >
            Got it
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="w-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-1"
          >
            Don't show again
          </button>
        </div>
      </div>
    </div>
  )
}
