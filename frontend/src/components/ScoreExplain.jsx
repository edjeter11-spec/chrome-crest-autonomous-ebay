import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'

/**
 * Wraps a score number with a hover-tooltip explaining what drives it.
 * Usage:
 *   <ScoreExplain score={87} type="snipe" auction={auction}>
 *     <span>87</span>
 *   </ScoreExplain>
 */
export default function ScoreExplain({ score, type = 'snipe', auction = {}, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const reasons = explainScore(type, score, auction)

  return (
    <span ref={ref} className="inline-flex items-center gap-1 relative">
      {children}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="inline-flex items-center justify-center w-8 h-8 -m-2 text-gray-500 hover:text-gray-300 active:text-white touch-manipulation"
        aria-label="What does this score mean?"
        aria-expanded={open}
      >
        <Info size={14} />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-64 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-2xl z-50 text-xs">
          <div className="font-black text-white mb-1 text-sm">
            {type === 'snipe' ? 'Deal Score' : 'Invest Score'}: {score}/100
          </div>
          {type === 'snipe' && (
            <p className="text-gray-300 mb-2 leading-snug">
              Higher = better value. We compare the current price to recent sales of similar cards.
              <span className="block mt-1 text-gray-400">🔥🔥🔥 means it's well below typical price.</span>
            </p>
          )}
          <ul className="space-y-1.5 text-gray-300">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className={typeof r.weight === 'string' || r.weight >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {typeof r.weight === 'number' && r.weight >= 0 ? '+' : ''}{r.weight}
                </span>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-gray-500 mt-2 pt-2 border-t border-gray-800">
            Heuristic. Final formula: weighted avg of price-vs-median, time-left, bid count, rarity, seller trust.
          </div>
        </div>
      )}
    </span>
  )
}

function explainScore(type, score, a) {
  const reasons = []
  if (type === 'snipe') {
    const price = Number(a.current_price ?? 0)
    const bids = Number(a.bid_count ?? 0)
    const tl = Number(a.time_left ?? 0)
    if (a.snipe_eligible) reasons.push({ weight: '+20', label: 'Flagged snipe-eligible by backend' })
    if (price < 50) reasons.push({ weight: '+15', label: `Low entry price ($${price.toFixed(0)})` })
    if (bids === 0) reasons.push({ weight: '+10', label: 'No bids yet — under the radar' })
    else if (bids < 3) reasons.push({ weight: '+5', label: `Light bid activity (${bids})` })
    if (tl > 0 && tl < 3600) reasons.push({ weight: '+15', label: 'Ending in under 1h' })
    else if (tl > 0 && tl < 21600) reasons.push({ weight: '+10', label: 'Ending in under 6h' })
    if (a.is_rookie || a.card?.is_rookie) reasons.push({ weight: '+10', label: 'Rookie card — premium category' })
    if (a.scarcity_tier && ['S', 'A+', 'A', 'A-'].includes(a.scarcity_tier))
      reasons.push({ weight: '+10', label: `Rare parallel (tier ${a.scarcity_tier})` })
  } else {
    // invest score
    if (score >= 90) reasons.push({ weight: 'S', label: 'S-tier investment — top driver + parallel combo' })
    else if (score >= 80) reasons.push({ weight: 'A', label: 'A-tier — strong long-term hold candidate' })
    else if (score >= 65) reasons.push({ weight: 'B', label: 'B-tier — solid mid-tier card' })
    else reasons.push({ weight: 'C', label: 'C-tier — speculative' })
    if (a.is_rookie || a.card?.is_rookie) reasons.push({ weight: '+10', label: 'Rookie card boost' })
    if (a.scarcity_tier) reasons.push({ weight: 'rare', label: `Scarcity: ${a.scarcity_tier}` })
  }
  if (reasons.length === 0) reasons.push({ weight: '—', label: 'Default scoring — no notable factors' })
  return reasons
}
