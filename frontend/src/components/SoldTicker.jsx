import React, { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

// Backend stores sale_date as naive UTC — append 'Z' if missing so JS doesn't
// interpret it as local time and report bogus "23h ago" for midnight rows.
function parseUtc(s) {
  if (!s) return null
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(hasTz ? s : s + 'Z')
  return isNaN(d.getTime()) ? null : d
}

function relTime(iso) {
  const d = parseUtc(iso)
  if (!d) return ''
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmtPrice(p) {
  if (p == null) return ''
  const n = Number(p)
  if (!isFinite(n)) return ''
  return n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(0)}`
}

export default function SoldTicker() {
  const [items, setItems] = useState(null) // null = loading, [] = empty
  const [, setTick] = useState(0)           // re-render every 30s for relTime

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await fetch(`${API}/api/sold/recent?limit=20`)
        if (!r.ok) throw new Error('bad status')
        const data = await r.json()
        if (cancelled) return
        const list = Array.isArray(data?.items) ? data.items : []
        setItems(list)
      } catch {
        if (!cancelled) setItems([])
      }
    }
    load()
    const id = setInterval(load, 60_000)
    const tickId = setInterval(() => setTick(t => t + 1), 30_000)
    return () => { cancelled = true; clearInterval(id); clearInterval(tickId) }
  }, [])

  // Loading
  if (items === null) {
    return (
      <div className="h-8 px-3 flex items-center text-[11px] font-mono text-gray-500 light:text-gray-600 bg-gray-900/50 light:bg-gray-100 border border-gray-800 light:border-gray-300 rounded-lg overflow-hidden">
        Loading recent sales…
      </div>
    )
  }

  // Empty → hide entirely (per spec)
  if (!items.length) return null

  // Duplicate the list so the marquee loops seamlessly
  const loop = [...items, ...items]
  // Animation duration scales with item count — ~3.5s per item feels right.
  const durationSec = Math.max(30, items.length * 3.5)

  return (
    <div
      className="group relative h-8 bg-gray-900/60 light:bg-gray-100 border border-gray-800 light:border-gray-300 rounded-lg overflow-hidden"
      aria-label="Recently sold cards"
    >
      {/* Edge fade masks */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-gray-950 light:from-white to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-gray-950 light:from-white to-transparent z-10" />

      {/* Label pill */}
      <div className="absolute left-0 top-0 bottom-0 z-20 px-2.5 flex items-center gap-1.5 bg-red-600/90 text-white text-[10px] font-black uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        Just Sold
      </div>

      {/* Scoped keyframes — inline so no CSS file is required */}
      <style>{`
        @keyframes sold-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .sold-ticker-track {
          animation: sold-ticker-scroll ${durationSec}s linear infinite;
          will-change: transform;
        }
        .group:hover .sold-ticker-track,
        .sold-ticker-track:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .sold-ticker-track { animation: none; }
        }
      `}</style>

      <div className="h-full flex items-center pl-24 pr-4">
        <div className="sold-ticker-track flex items-center gap-6 whitespace-nowrap">
          {loop.map((it, i) => {
            const gradePrefix = it.grade ? `${it.grade} ` : ''
            const driver = it.driver_name || 'Unknown'
            const parallel = it.parallel || ''
            const price = fmtPrice(it.sale_price)
            const ago = relTime(it.sale_date)
            const label = `${gradePrefix}${driver}${parallel ? ` ${parallel}` : ''} — ${price}${ago ? ` — ${ago}` : ''}`
            const content = (
              <span className="font-mono text-[11px] text-gray-200 light:text-gray-800">
                {gradePrefix && (
                  <span className="text-amber-400 font-bold mr-1">{gradePrefix.trim()}</span>
                )}
                <span className="text-white font-semibold light:text-gray-900">{driver}</span>
                {parallel && <span className="text-gray-400 light:text-gray-600"> {parallel}</span>}
                <span className="text-gray-500 mx-1.5">—</span>
                <span className="text-emerald-400 font-bold">{price}</span>
                {ago && <>
                  <span className="text-gray-500 mx-1.5">—</span>
                  <span className="text-gray-500">{ago}</span>
                </>}
              </span>
            )
            // dedup key works across the doubled loop
            const key = `${it.id ?? i}-${i}`
            return it.ebay_url ? (
              <a
                key={key}
                href={it.ebay_url}
                target="_blank"
                rel="noopener noreferrer"
                title={label}
                className="hover:opacity-80 transition-opacity shrink-0"
              >
                {content}
              </a>
            ) : (
              <span key={key} title={label} className="shrink-0">{content}</span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
