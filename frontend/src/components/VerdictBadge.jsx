// Shared verdict badge — renders the STRONG BUY / GOOD BUY / FAIR / … pill
// plus a confidence-tinted ring + tooltip driven by n_comps. Lets every
// surface (Dashboard, Auctions, Sales, CardPage) show the same trust signal
// instead of rolling its own inline verdict chip.
//
// Props:
//   verdict   — shape returned by verdictFor() in lib/verdict.js
//               { key, label, cls, ... } — optional, renders nothing if null
//   nComps    — sample size backing the verdict (int)
//   showN     — if true, appends "· n=X" to the tooltip (default true)
//   className — extra classes merged on the pill
//
// Usage:
//   import VerdictBadge from '../components/VerdictBadge'
//   <VerdictBadge verdict={v} nComps={sample.length} />

const CONFIDENCE = {
  veryHigh: {
    ring: 'ring-1 ring-green-500/60',
    dot: 'bg-green-400',
    label: 'Very high confidence',
  },
  high: {
    ring: 'ring-1 ring-green-500/40',
    dot: 'bg-green-400',
    label: 'High confidence',
  },
  medium: {
    ring: 'ring-1 ring-yellow-500/50',
    dot: 'bg-yellow-400',
    label: 'Medium confidence',
  },
  low: {
    ring: 'ring-1 ring-gray-500/40',
    dot: 'bg-gray-400',
    label: 'Low sample — use caution',
  },
}

export function confidenceFromN(n) {
  if (n == null) return CONFIDENCE.low
  if (n >= 20) return CONFIDENCE.veryHigh
  if (n >= 10) return CONFIDENCE.high
  if (n >= 5) return CONFIDENCE.medium
  return CONFIDENCE.low
}

export default function VerdictBadge({
  verdict,
  nComps,
  showN = true,
  className = '',
}) {
  if (!verdict) return null
  const conf = confidenceFromN(nComps)
  const tooltip = showN && nComps != null
    ? `${conf.label} · n=${nComps}`
    : conf.label

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider ${verdict.cls} ${conf.ring} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} aria-hidden="true" />
      {verdict.label}
    </span>
  )
}
