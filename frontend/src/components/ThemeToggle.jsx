import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

// Pick initial theme: respect explicit user choice (cc_theme), else use system pref.
// Older users skew light mode, so first-visit defaults follow OS preference.
function getInitialTheme() {
  try {
    const saved = localStorage.getItem('cc_theme')
    if (saved === 'light' || saved === 'dark') return saved
    if (typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light'
    }
  } catch {}
  return 'dark'
}

// Shared theme toggle used in page headers (shortcut for the one in Layout sidebar).
// Writes to the same cc_theme key + body.light class so it stays in sync.
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(getInitialTheme)
  useEffect(() => {
    try { localStorage.setItem('cc_theme', theme) } catch {}
    if (theme === 'light') document.body.classList.add('light')
    else document.body.classList.remove('light')
    // Notify others (Layout) so their state stays current.
    try { window.dispatchEvent(new CustomEvent('cc_theme_change', { detail: theme })) } catch {}
  }, [theme])
  useEffect(() => {
    const handler = (e) => { if (e?.detail && e.detail !== theme) setTheme(e.detail) }
    window.addEventListener('cc_theme_change', handler)
    return () => window.removeEventListener('cc_theme_change', handler)
  }, [theme])
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-700/60 bg-gray-900/60 text-gray-300 hover:text-white hover:bg-gray-800 transition ${className}`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
