// Fair Market Value (FMV) helper — calculates FMV from comp data.
//
// Usage:
//   const fmv = calculateFMV(comps)  // { price: 250, count: 14 }
//   <div>Fair value: ${fmv.price} (n={fmv.count})</div>

export function calculateFMV(compsData) {
  if (!compsData) return null

  // If we already have median_total (from /api/sales/median), use it
  if (typeof compsData === 'object' && 'median_total' in compsData) {
    return {
      price: compsData.median_total,
      count: compsData.n || 0,
    }
  }

  // If it's an array of comps, compute median
  if (Array.isArray(compsData) && compsData.length > 0) {
    const prices = compsData
      .map(c => c.total_cost || c.sale_price || c.price || 0)
      .filter(p => p > 0)
      .sort((a, b) => a - b)

    if (prices.length === 0) return null

    const mid = Math.floor(prices.length / 2)
    const median = prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid]

    return {
      price: median,
      count: compsData.length,
    }
  }

  return null
}

// Format FMV for display
export function formatFMV(fmv) {
  if (!fmv) return null
  return `Fair value: $${fmv.price.toFixed(0)} (n=${fmv.count})`
}
