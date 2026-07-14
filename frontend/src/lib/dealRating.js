/**
 * Map a snipe_score (0-100) to a rating bucket. Higher = further below recent
 * comps with better timing. AuctionCard renders the numeric score + label;
 * ScoreExplain breaks down what drives the number.
 */
export function dealRating(score) {
  const s = Number(score) || 0
  if (s >= 80) return { label: 'Hot deal',  color: 'text-red-400'    }
  if (s >= 60) return { label: 'Good deal', color: 'text-orange-400' }
  if (s >= 40) return { label: 'Fair',      color: 'text-yellow-400' }
  return         { label: 'Watch',     color: 'text-gray-500'   }
}
