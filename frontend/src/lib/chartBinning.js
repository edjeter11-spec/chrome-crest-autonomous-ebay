/**
 * Adaptive binning for sparse price data.
 * Switches from weekly to bi-weekly or 14-day rolling averages
 * when data is sparse (< 5 bins worth of comparables).
 */

/**
 * Bin price data by time period.
 * @param {Array} series - Array of {week_start, grade, avg_price}
 * @param {string} binType - 'weekly', 'biweekly', or 'rolling14d'
 * @returns {Array} rows keyed by bin start date
 */
export function binSeriesByPeriod(series, binType = 'weekly') {
  if (!series || !series.length) return []

  const binMap = new Map()

  for (const item of series) {
    const date = new Date(item.week_start)
    let binKey = null

    if (binType === 'weekly') {
      // Week starts on Monday (week_start is already Monday)
      binKey = item.week_start.slice(0, 10)
    } else if (binType === 'biweekly') {
      // Snap to 2-week boundary (every other Monday)
      const dayOfYear = getDayOfYear(date)
      const mondayOfYear = dayOfYear - date.getUTCDay() + (date.getUTCDay() === 0 ? -6 : 1)
      const weekNum = Math.floor(mondayOfYear / 7)
      const biweekNum = Math.floor(weekNum / 2)
      const snapDate = new Date(date)
      snapDate.setUTCDate(date.getUTCDate() - ((weekNum % 2) * 7) - (date.getUTCDay() + 6) % 7)
      binKey = snapDate.toISOString().slice(0, 10)
    } else if (binType === 'rolling14d') {
      // Snap to nearest 14-day boundary from epoch (Jan 1, 1970)
      const ms = date.getTime()
      const day14ms = 14 * 86400 * 1000
      const snappedMs = Math.floor(ms / day14ms) * day14ms
      const snappedDate = new Date(snappedMs)
      binKey = snappedDate.toISOString().slice(0, 10)
    }

    if (!binMap.has(binKey)) {
      binMap.set(binKey, { bin: binKey, grades: new Map() })
    }
    const bin = binMap.get(binKey)
    const gradeData = bin.grades.get(item.grade) || { prices: [], count: 0 }
    gradeData.prices.push(item.avg_price)
    gradeData.count = gradeData.prices.length
    bin.grades.set(item.grade, gradeData)
  }

  // Convert to rows, computing averages per grade per bin
  const rows = [...binMap.values()].sort((a, b) => a.bin.localeCompare(b.bin))
  const result = rows.map(bin => {
    const row = { bin: bin.bin }
    for (const [grade, data] of bin.grades) {
      const avg = data.prices.reduce((a, b) => a + b, 0) / data.prices.length
      row[grade] = avg
    }
    return row
  })

  return result
}

/**
 * Detect sparsity and recommend bin type.
 * @param {Array} series - Array of {week_start, grade, avg_price}
 * @param {number} minBins - Minimum bins to stay in weekly mode (default 5)
 * @returns {string} - 'weekly', 'biweekly', or 'rolling14d'
 */
export function detectBinType(series, minBins = 5) {
  if (!series || !series.length) return 'weekly'

  // Count unique weeks
  const weekSet = new Set(series.map(s => s.week_start.slice(0, 10)))
  const weekCount = weekSet.size

  if (weekCount >= minBins) return 'weekly'
  if (weekCount >= Math.ceil(minBins / 2)) return 'biweekly'
  return 'rolling14d'
}

/**
 * Helper: get day-of-year for a Date
 */
function getDayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const diff = date.getTime() - start.getTime()
  const oneDay = 1000 * 60 * 60 * 24
  return Math.floor(diff / oneDay)
}

/**
 * Format bin label for display
 * @param {string} binKey - ISO date string
 * @param {string} binType - 'weekly', 'biweekly', 'rolling14d'
 * @returns {string} - Formatted label
 */
export function formatBinLabel(binKey, binType) {
  if (!binKey) return ''
  const date = new Date(binKey + 'T00:00:00Z')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')

  if (binType === 'rolling14d') {
    // Show end date of 14-day window
    const endDate = new Date(date.getTime() + 13 * 86400 * 1000)
    const endMonth = (endDate.getUTCMonth() + 1).toString().padStart(2, '0')
    const endDay = endDate.getUTCDate().toString().padStart(2, '0')
    return `${month}/${day}–${endMonth}/${endDay}`
  }

  return `${month}/${day}`
}
