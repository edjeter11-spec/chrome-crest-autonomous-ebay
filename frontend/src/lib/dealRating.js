/**
 * Map a snipe_score (0-100) to a non-technical visual rating.
 * Used by AuctionCard to communicate deal quality to non-power users.
 */
export function dealRating(score) {
  const s = Number(score) || 0
  if (s >= 80) return { flames: '🔥🔥🔥', label: 'Hot deal',  color: 'text-red-400'    }
  if (s >= 60) return { flames: '🔥🔥',   label: 'Good deal', color: 'text-orange-400' }
  if (s >= 40) return { flames: '🔥',     label: 'Fair',      color: 'text-yellow-400' }
  return         { flames: '',       label: 'Watch',     color: 'text-gray-500'   }
}
