import { useEffect, useState } from 'react'
import { X, Keyboard } from 'lucide-react'

const SHORTCUTS = [
  { keys: ['/'], label: 'Focus search' },
  { keys: ['?'], label: 'Show this help' },
  { keys: ['Esc'], label: 'Close modal / blur input' },
  { keys: ['g', 'h'], label: 'Go to dashboard' },
  { keys: ['g', 'a'], label: 'Go to auctions' },
  { keys: ['g', 's'], label: 'Go to sniper' },
  { keys: ['g', 'w'], label: 'Go to wishlist' },
]

/**
 * Modal dialog listing keyboard shortcuts. Triggered by the global
 * 'app:show-shortcuts' custom event from useKeyboardShortcuts.
 */
export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onShow = () => setOpen(true)
    const onClose = () => setOpen(false)
    window.addEventListener('app:show-shortcuts', onShow)
    window.addEventListener('app:close', onClose)
    return () => {
      window.removeEventListener('app:show-shortcuts', onShow)
      window.removeEventListener('app:close', onClose)
    }
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-red-400" />
            <h3 className="text-base font-bold text-white">Keyboard Shortcuts</h3>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2.5">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">{s.label}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="px-2 py-1 text-xs font-mono font-semibold text-gray-200 bg-gray-800 border border-gray-700 rounded shadow-inner"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-gray-800 text-xs text-gray-500 text-center">
          Press <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded font-mono">?</kbd> any time to see this
        </div>
      </div>
    </div>
  )
}
