// Single source of truth for buy/pass verdicts based on (total_cost / median_total).
// Mirrors backend ratio thresholds in scraper.run_enhanced_snipe_alerts.
//
// Usage:
//   const v = verdictFor(totalCost, median, n)
//   if (v) <span className={v.cls}>{v.label}</span>

export const VERDICT_THRESHOLDS = {
  STRONG_BUY: 0.6,   // ratio <=
  GOOD_BUY:   0.8,
  FAIR:       1.05,
  OVERPRICED: 1.25,
  // PASS: anything > OVERPRICED
}

// Solid TW classes used across cards, badges, and chart dots
export const VERDICT_STYLES = {
  STRONG_BUY: { cls: 'bg-green-600 text-white',          dot: '#22c55e', text: 'text-green-400'   },
  GOOD_BUY:   { cls: 'bg-emerald-600 text-white',        dot: '#10b981', text: 'text-emerald-400' },
  FAIR:       { cls: 'bg-gray-700 text-gray-300',        dot: '#9ca3af', text: 'text-gray-400'    },
  OVERPRICED: { cls: 'bg-orange-700/80 text-orange-100', dot: '#f97316', text: 'text-orange-400'  },
  PASS:       { cls: 'bg-red-800/80 text-red-200',       dot: '#ef4444', text: 'text-red-400'     },
}

export const VERDICT_LABEL = {
  STRONG_BUY: 'STRONG BUY',
  GOOD_BUY:   'GOOD BUY',
  FAIR:       'FAIR',
  OVERPRICED: 'OVERPRICED',
  PASS:       'PASS',
}

// Returns null only when we truly have no data. With n>=2 we still return a
// verdict but flag lowConfidence=true so UI can de-emphasize it.
//   minN: minimum comps for a confident verdict (default 3)
//   minNLow: show a low-confidence verdict down to this count (default 2)
export function verdictFor(totalCost, median, n, minN = 3, minNLow = 2) {
  if (!totalCost || !median || median <= 0) return null
  if (n != null && n < minNLow) return null
  const lowConfidence = n != null && n < minN
  const ratio = totalCost / median
  let key
  if (ratio <= VERDICT_THRESHOLDS.STRONG_BUY) key = 'STRONG_BUY'
  else if (ratio <= VERDICT_THRESHOLDS.GOOD_BUY) key = 'GOOD_BUY'
  else if (ratio <= VERDICT_THRESHOLDS.FAIR) key = 'FAIR'
  else if (ratio <= VERDICT_THRESHOLDS.OVERPRICED) key = 'OVERPRICED'
  else key = 'PASS'
  // Never promote a low-confidence read to STRONG_BUY — downgrade to GOOD_BUY.
  if (lowConfidence && key === 'STRONG_BUY') key = 'GOOD_BUY'
  return {
    key,
    label: VERDICT_LABEL[key] + (lowConfidence ? '*' : ''),
    cls: VERDICT_STYLES[key].cls,
    dotColor: VERDICT_STYLES[key].dot,
    text: VERDICT_STYLES[key].text,
    ratio,
    lowConfidence,
    pctVsMedian: Math.round((1 - ratio) * 100),
  }
}

// Helpful predicates for "STRONG BUY only" filtering.
export function isStrongBuyOrBetter(verdict) {
  return verdict && (verdict.key === 'STRONG_BUY' || verdict.key === 'GOOD_BUY')
}
