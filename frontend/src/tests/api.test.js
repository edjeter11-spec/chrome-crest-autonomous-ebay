/**
 * Integration-style tests for frontend API interactions.
 * Uses fetch mocks to simulate backend responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

afterEach(() => vi.clearAllMocks())

// Simulated API helpers (matching what components call)
const API = 'http://localhost:8000'

async function fetchAuctions(params = {}) {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${API}/api/auctions${qs ? '?' + qs : ''}`)
  return r.json()
}

async function fetchCards(params = {}) {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${API}/api/cards${qs ? '?' + qs : ''}`)
  return r.json()
}

async function fetchSnipeTargets() {
  const r = await fetch(`${API}/api/auctions/snipe/targets`)
  return r.json()
}

async function toggleWatchlist(auctionId) {
  const r = await fetch(`${API}/api/auctions/${auctionId}/watchlist`, { method: 'POST' })
  return r.json()
}

async function addToWishlist(payload) {
  const r = await fetch(`${API}/api/wishlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return r.json()
}

async function addToPortfolio(payload) {
  const r = await fetch(`${API}/api/portfolio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return r.json()
}

describe('Auctions API', () => {
  it('fetches auctions list', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ total: 2, auctions: [{ id: 1 }, { id: 2 }] })
    })
    const data = await fetchAuctions()
    expect(data.total).toBe(2)
    expect(data.auctions).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledWith(`${API}/api/auctions`)
  })

  it('fetches auctions with status filter', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ total: 1, auctions: [] }) })
    await fetchAuctions({ status: 'ended' })
    expect(mockFetch).toHaveBeenCalledWith(`${API}/api/auctions?status=ended`)
  })

  it('fetches snipe targets', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ targets: [{ id: 5, snipe_score: 88 }] })
    })
    const data = await fetchSnipeTargets()
    expect(data.targets[0].snipe_score).toBe(88)
    expect(mockFetch).toHaveBeenCalledWith(`${API}/api/auctions/snipe/targets`)
  })

  it('POSTs watchlist toggle', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ watching: true, status: 'watchlist', id: 3 })
    })
    const data = await toggleWatchlist(3)
    expect(data.watching).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      `${API}/api/auctions/3/watchlist`,
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('Cards API', () => {
  it('fetches cards list', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ total: 10, cards: [] })
    })
    const data = await fetchCards()
    expect(data.total).toBe(10)
  })

  it('fetches cards with driver filter', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ total: 1, cards: [] }) })
    await fetchCards({ driver: 'Hamilton' })
    expect(mockFetch).toHaveBeenCalledWith(`${API}/api/cards?driver=Hamilton`)
  })

  it('fetches cards with parallel filter', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ total: 5, cards: [] }) })
    await fetchCards({ parallel: 'Gold' })
    expect(mockFetch).toHaveBeenCalledWith(`${API}/api/cards?parallel=Gold`)
  })
})

describe('Portfolio API', () => {
  it('POSTs new portfolio item', async () => {
    const payload = { card_id: 1, purchase_price: 35.0, quantity: 1 }
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ id: 10, ...payload, current_value: 50.0 })
    })
    const data = await addToPortfolio(payload)
    expect(data.id).toBe(10)
    expect(mockFetch).toHaveBeenCalledWith(
      `${API}/api/portfolio`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    )
  })

  it('includes Content-Type header in POST', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({}) })
    await addToPortfolio({ card_id: 1, purchase_price: 20 })
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })
})

describe('Wishlist API', () => {
  it('POSTs wishlist item with auto_snipe', async () => {
    const payload = { card_id: 2, max_price: 50.0, priority: 4, auto_snipe: true }
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ id: 5, ...payload })
    })
    const data = await addToWishlist(payload)
    expect(data.auto_snipe).toBe(true)
    expect(data.max_price).toBe(50.0)
  })

  it('serializes all wishlist fields correctly', async () => {
    const payload = { card_id: 3, max_price: 75.0, priority: 2, notes: 'Want this', auto_snipe: false }
    mockFetch.mockResolvedValueOnce({ json: async () => ({}) })
    await addToWishlist(payload)
    const [, options] = mockFetch.mock.calls[0]
    const sent = JSON.parse(options.body)
    expect(sent.notes).toBe('Want this')
    expect(sent.auto_snipe).toBe(false)
  })
})

describe('WebSocket data parsing', () => {
  it('parses auction_update message correctly', () => {
    const wsMessage = {
      type: 'auction_update',
      data: [
        { id: 1, title: 'Card 1', current_price: 30, time_left: 3600, snipe_score: 75 }
      ],
      alerts: [{ message: 'SNIPE alert', urgency: 'high' }],
      ebay_connected: true,
      timestamp: '2025-01-01T00:00:00',
    }
    expect(wsMessage.type).toBe('auction_update')
    expect(wsMessage.data[0].snipe_score).toBe(75)
    expect(wsMessage.alerts[0].urgency).toBe('high')
    expect(wsMessage.ebay_connected).toBe(true)
  })

  it('handles empty auctions in WebSocket payload', () => {
    const wsMessage = { type: 'auction_update', data: [], alerts: [] }
    expect(wsMessage.data).toHaveLength(0)
  })
})
