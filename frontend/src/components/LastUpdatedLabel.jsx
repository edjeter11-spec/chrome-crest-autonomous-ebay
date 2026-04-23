// Tiny "Updated 4m ago" badge. Auto-refreshes every 30s so a user idling on
// a page doesn't see a stale "just now" forever. Uses Intl.RelativeTimeFormat
// for localization-friendly output.
//
// Props:
//   timestamp — Date | ISO string | ms epoch. Missing/invalid → renders null.
//   prefix    — default "Updated", override per surface ("Synced", "Fetched")
//   className — extra classes merged with the default Tailwind styling
//
// Usage:
//   <LastUpdatedLabel timestamp={auction.last_updated} />

import { useEffect, useState } from 'react'

const RTF = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  : null

const DIVISIONS = [
  { amount: 60, unit: 'seconds' },
  { amount: 60, unit: 'minutes' },
  { amount: 24, unit: 'hours' },
  { amount: 7, unit: 'days' },
  { amount: 4.34524, unit: 'weeks' },
  { amount: 12, unit: 'months' },
  { amount: Number.POSITIVE_INFINITY, unit: 'years' },
]

function formatRelative(fromMs) {
  if (!fromMs) return ''
  let duration = (fromMs - Date.now()) / 1000
  for (const d of DIVISIONS) {
    if (Math.abs(duration) < d.amount) {
      if (RTF) return RTF.format(Math.round(duration), d.unit)
      // Fallback if Intl.RelativeTimeFormat is missing
      const n = Math.abs(Math.round(duration))
      return `${n} ${d.unit} ${duration < 0 ? 'ago' : 'from now'}`
    }
    duration /= d.amount
  }
  return ''
}

export default function LastUpdatedLabel({
  timestamp,
  prefix = 'Updated',
  className = '',
}) {
  const ms = (() => {
    if (!timestamp) return null
    if (timestamp instanceof Date) return timestamp.getTime()
    if (typeof timestamp === 'number') return timestamp
    const parsed = new Date(timestamp).getTime()
    return Number.isFinite(parsed) ? parsed : null
  })()

  const [, setTick] = useState(0)

  useEffect(() => {
    if (!ms) return undefined
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [ms])

  if (!ms) return null
  const relative = formatRelative(ms)
  const absolute = new Date(ms).toLocaleString()

  return (
    <span
      title={absolute}
      className={`text-[10px] text-gray-500 ${className}`}
    >
      {prefix} {relative}
    </span>
  )
}
