import { useEffect, useRef, useState } from 'react'

/**
 * useCountdown — live-ticking countdown to a target time.
 *
 * @param {string|Date|number} endTime — ISO string, Date, or epoch ms
 * @returns {{ secsLeft: number, label: string, isCritical: boolean, isPast: boolean }}
 *
 *   label   — formatted "2d 4h", "5h 12m", "23m 14s", "45s", or "ENDED"
 *   isCritical — true when secsLeft < 300 (under 5 min) and not past
 *   isPast  — true when secsLeft <= 0
 *
 * Uses a single setInterval(1000) cleared on unmount. Re-derives from endTime
 * each tick (no drift). endTime is captured in a ref so the interval always
 * sees the latest value without restarting.
 */
export function useCountdown(endTime) {
  const endRef = useRef(toMs(endTime))
  const [secsLeft, setSecsLeft] = useState(() => computeSecsLeft(endRef.current))

  // Keep the latest endTime in a ref (avoids stale closures and avoids
  // tearing down/recreating the interval if the parent re-renders).
  useEffect(() => {
    endRef.current = toMs(endTime)
    setSecsLeft(computeSecsLeft(endRef.current))
  }, [endTime])

  useEffect(() => {
    const id = setInterval(() => {
      setSecsLeft(computeSecsLeft(endRef.current))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const isPast = secsLeft <= 0
  const isCritical = !isPast && secsLeft < 300
  const label = formatLabel(secsLeft)

  return { secsLeft, label, isCritical, isPast }
}

function toMs(endTime) {
  if (endTime == null) return 0
  if (endTime instanceof Date) return endTime.getTime()
  if (typeof endTime === 'number') return endTime
  // String — accept ISO with or without trailing Z. eBay timestamps from the
  // backend often arrive without a TZ suffix even though they're UTC.
  const s = String(endTime)
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
  const t = new Date(hasTz ? s : s + 'Z').getTime()
  return Number.isNaN(t) ? 0 : t
}

function computeSecsLeft(endMs) {
  if (!endMs) return 0
  return Math.max(0, Math.floor((endMs - Date.now()) / 1000))
}

function formatLabel(secs) {
  if (secs <= 0) return 'ENDED'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m ${s}s`
  }
  if (secs < 86400) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return `${h}h ${m}m`
  }
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  return `${d}d ${h}h`
}

export default useCountdown
