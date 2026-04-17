/**
 * Tests for the formatTimeLeft utility inside AuctionCard.
 * We extract the logic here to test it in isolation.
 */
import { describe, it, expect } from 'vitest'

// Copy of the pure function from AuctionCard.jsx
function formatTimeLeft(seconds) {
  if (seconds <= 0) return { text: 'ENDED', cls: 'text-gray-500' }
  if (seconds < 300) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return { text: `${m}:${s.toString().padStart(2, '0')}`, cls: 'countdown-critical' }
  }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return { text: `${m}m ${s}s`, cls: 'countdown-urgent' }
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return { text: `${h}h ${m}m`, cls: 'countdown-normal' }
  }
  const d = Math.floor(seconds / 86400)
  return { text: `${d}d`, cls: 'text-gray-500' }
}

describe('formatTimeLeft', () => {
  it('returns ENDED for 0 seconds', () => {
    expect(formatTimeLeft(0).text).toBe('ENDED')
  })

  it('returns ENDED for negative seconds', () => {
    expect(formatTimeLeft(-100).text).toBe('ENDED')
    expect(formatTimeLeft(-100).cls).toBe('text-gray-500')
  })

  it('formats critical countdown under 5 minutes', () => {
    const result = formatTimeLeft(90) // 1m 30s
    expect(result.text).toBe('1:30')
    expect(result.cls).toBe('countdown-critical')
  })

  it('formats seconds with leading zero in critical range', () => {
    const result = formatTimeLeft(65) // 1m 05s
    expect(result.text).toBe('1:05')
  })

  it('formats urgent countdown between 5-60 minutes', () => {
    const result = formatTimeLeft(900) // 15m 0s
    expect(result.text).toBe('15m 0s')
    expect(result.cls).toBe('countdown-urgent')
  })

  it('formats normal countdown between 1-24 hours', () => {
    const result = formatTimeLeft(7200) // 2h 0m
    expect(result.text).toBe('2h 0m')
    expect(result.cls).toBe('countdown-normal')
  })

  it('formats hours with minutes correctly', () => {
    const result = formatTimeLeft(3690) // 1h 1m 30s
    expect(result.text).toBe('1h 1m')
  })

  it('formats days for auctions over 24 hours', () => {
    const result = formatTimeLeft(172800) // 2 days
    expect(result.text).toBe('2d')
    expect(result.cls).toBe('text-gray-500')
  })

  it('handles exactly 5 minutes boundary (300s) as urgent not critical', () => {
    const result = formatTimeLeft(300)
    expect(result.cls).toBe('countdown-urgent')
  })

  it('handles exactly 1 hour boundary (3600s) as normal not urgent', () => {
    const result = formatTimeLeft(3600)
    expect(result.cls).toBe('countdown-normal')
  })

  it('handles exactly 24 hours boundary (86400s) as days not normal', () => {
    const result = formatTimeLeft(86400)
    expect(result.text).toBe('1d')
    expect(result.cls).toBe('text-gray-500')
  })

  it('handles 1 second remaining', () => {
    const result = formatTimeLeft(1)
    expect(result.text).toBe('0:01')
    expect(result.cls).toBe('countdown-critical')
  })
})
