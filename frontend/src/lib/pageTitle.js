import { useEffect } from 'react'

// Sets `document.title` to "<title> · F1 Card Vault" while the page is mounted.
// Single source of truth so per-page titles stay consistent.
export function usePageTitle(title) {
  useEffect(() => {
    if (!title) return
    document.title = `${title} · F1 Card Vault`
  }, [title])
}
