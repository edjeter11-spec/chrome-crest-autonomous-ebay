import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * setInterval that only fires when the tab is visible.
 * Saves CPU/network when user backgrounds the tab.
 */
export function useVisibilityInterval(cb, ms) {
  const cbRef = useRef(cb)
  useEffect(() => { cbRef.current = cb })
  useEffect(() => {
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        cbRef.current?.()
      }
    }
    const id = setInterval(tick, ms)
    return () => clearInterval(id)
  }, [ms])
}

/**
 * Tracks window width and returns a responsive column count.
 * Breakpoints match Tailwind: <768=2, <1024=3, <1280=4, <1536=5, else 6.
 */
export function useResponsiveColumns() {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  useEffect(() => {
    if (typeof window === 'undefined') return
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [])
  if (width < 768) return 2
  if (width < 1024) return 3
  if (width < 1280) return 4
  if (width < 1536) return 5
  return 6
}

/**
 * Progressive rendering for very large lists.
 * Returns `visibleCount` and a ref to attach to a sentinel at the end of the list —
 * when the sentinel scrolls into view, visibleCount grows by `batch`.
 *
 * @param {number} total      total items in the list
 * @param {number} [initial]  how many to render on first paint (default 60)
 * @param {number} [batch]    how many to add each time the sentinel hits (default 40)
 */
export function useProgressiveRender(total, initial = 60, batch = 40) {
  const [visibleCount, setVisibleCount] = useState(initial)
  const sentinelRef = useRef(null)

  // Reset when total changes (filters applied, new data loaded)
  useEffect(() => { setVisibleCount(initial) }, [total, initial])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setVisibleCount(v => Math.min(total, v + batch))
        }
      }
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [total, batch, visibleCount])

  const loadMore = useCallback(() => {
    setVisibleCount(v => Math.min(total, v + batch))
  }, [total, batch])

  return { visibleCount: Math.min(visibleCount, total), sentinelRef, loadMore }
}

