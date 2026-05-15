import { useEffect, useState } from 'react'
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'
import { subscribe, dismiss } from '../lib/toast'

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warn: AlertTriangle,
  info: Info,
}

const STYLES = {
  success: 'bg-emerald-900/90 border-emerald-700/60 text-emerald-100',
  error:   'bg-red-950/90 border-red-800/60 text-red-100',
  warn:    'bg-amber-900/90 border-amber-700/60 text-amber-100',
  info:    'bg-gray-900/90 border-gray-700/60 text-gray-100',
}

const ICON_COLORS = {
  success: 'text-emerald-400',
  error:   'text-red-400',
  warn:    'text-amber-400',
  info:    'text-gray-400',
}

/**
 * Renders the toast stack from `lib/toast.js`. Mount once at the app root.
 *
 * Stack from the bottom: latest toast at the bottom, older slide up.
 * Bottom-right on desktop, bottom-center on mobile so it doesn't fight
 * the mobile bottom-nav bar (z-index 30; toasts z-50).
 */
export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => subscribe(setToasts), [])

  if (!toasts.length) return null

  return (
    <div
      className="fixed z-50 pointer-events-none flex flex-col gap-2 px-3
                 bottom-20 md:bottom-4 left-0 right-0 md:left-auto md:right-4
                 items-center md:items-end
                 max-w-full md:max-w-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {toasts.map(t => {
        const Icon = ICONS[t.kind] || Info
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full md:w-auto min-w-[260px] max-w-md
                        flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-lg
                        backdrop-blur-sm animate-toast-in
                        ${STYLES[t.kind] || STYLES.info}`}
          >
            <Icon size={16} className={`shrink-0 mt-0.5 ${ICON_COLORS[t.kind] || ICON_COLORS.info}`} />
            <div className="flex-1 text-[13px] leading-snug font-medium">{t.message}</div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 -mr-1 -mt-0.5 p-1 rounded hover:bg-white/10 text-current/70 hover:text-current"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
