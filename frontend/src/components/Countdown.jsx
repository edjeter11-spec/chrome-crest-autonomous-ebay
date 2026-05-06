import { useCountdown } from '../lib/useCountdown'

/**
 * Countdown — live-ticking time-left display.
 *
 *   <Countdown endTime={a.end_time} />
 *
 * Color rules match the rest of the dashboard:
 *   - past:     gray, "ENDED"
 *   - critical: red + bold + animate-pulse (under 5 min)
 *   - default:  inherits parent text color
 */
export default function Countdown({ endTime, className = '' }) {
  const { label, isCritical, isPast } = useCountdown(endTime)

  if (isPast) {
    return <span className={`text-gray-500 ${className}`}>ENDED</span>
  }
  if (isCritical) {
    return (
      <span className={`text-red-500 font-bold animate-pulse ${className}`}>
        {label}
      </span>
    )
  }
  return <span className={className}>{label}</span>
}
