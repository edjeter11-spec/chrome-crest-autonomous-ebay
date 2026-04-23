import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

export default function InfoTooltip({ content, children }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside tap (mobile) or escape
  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('touchstart', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('touchstart', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center gap-1 align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="More info"
        className="inline-flex items-center justify-center text-gray-400 hover:text-gray-200 focus:outline-none focus:text-gray-200 transition-colors"
      >
        <Info size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-700/70 text-[11px] font-medium text-gray-100 shadow-xl whitespace-normal min-w-[8rem] max-w-[16rem] text-center pointer-events-none"
        >
          {content}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 rotate-45 bg-gray-900 border-r border-b border-gray-700/70" />
        </span>
      )}
    </span>
  )
}
