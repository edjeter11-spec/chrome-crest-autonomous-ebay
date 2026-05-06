import { useEffect } from 'react'

/**
 * Global keyboard shortcuts. Mounted once at the app root.
 *
 * Bindings:
 *   /          → focus first <input> on page (Search etc)
 *   g h        → go home (chord)
 *   g a        → go auctions
 *   g s        → go sniper
 *   g w        → go watchlist
 *   ?          → open shortcuts help dialog (sets a global event)
 *   Esc        → close anything via custom 'app:close' event
 *
 * Skips when an input/textarea/contenteditable has focus so users
 * can still type 'h' in search boxes.
 */
export default function useKeyboardShortcuts(navigate) {
  useEffect(() => {
    let chord = null
    let chordTimer = null

    function onKey(e) {
      // Don't intercept while typing in fields.
      const target = e.target
      const tag = (target?.tagName || '').toLowerCase()
      const editable = target?.isContentEditable
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
        // Allow Escape to blur fields
        if (e.key === 'Escape') target.blur?.()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // Slash → focus first text input
      if (e.key === '/') {
        const search =
          document.querySelector('input[type="search"], input[placeholder*="earch" i]') ||
          document.querySelector('input[type="text"]')
        if (search) {
          e.preventDefault()
          search.focus()
        }
        return
      }

      // Help
      if (e.key === '?') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('app:show-shortcuts'))
        return
      }

      // Esc bubbles up via a custom event so any open modal/menu can close.
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('app:close'))
        return
      }

      // Chord nav (g + letter)
      if (e.key === 'g' && !chord) {
        chord = 'g'
        clearTimeout(chordTimer)
        chordTimer = setTimeout(() => { chord = null }, 1200)
        return
      }
      if (chord === 'g') {
        chord = null
        clearTimeout(chordTimer)
        const map = { h: '/', a: '/auctions', s: '/sniper', w: '/wishlist', d: '/' }
        const dest = map[e.key]
        if (dest) {
          e.preventDefault()
          navigate(dest)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(chordTimer)
    }
  }, [navigate])
}
