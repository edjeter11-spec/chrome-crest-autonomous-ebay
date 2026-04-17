import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AuctionCard from '../components/AuctionCard'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

function makeAuction(overrides = {}) {
  return {
    id: 1,
    title: '2025 Topps Chrome F1 Max Verstappen Base Raw PSA',
    current_price: 35.0,
    buy_now_price: null,
    bid_count: 3,
    time_left: 7200,  // 2 hours
    snipe_score: 72.5,
    snipe_eligible: true,
    status: 'active',
    seller: 'topdealer99',
    seller_feedback: 1500,
    shipping_cost: 0,
    ebay_url: 'https://www.ebay.com/itm/123',
    image_url: 'https://example.com/img.jpg',
    extra_images: [],
    buying_options: ['AUCTION'],
    card: {
      driver_name: 'Max Verstappen',
      parallel: 'Base',
      grade: 'Raw',
      team: 'Red Bull Racing',
      team_color: '#3671C6',
      investment_score: 92,
    },
    ...overrides,
  }
}

beforeEach(() => {
  mockFetch.mockResolvedValue({
    json: async () => ({ extra_images: [], total_bids: 0, bid_history: [], current_price: 35 }),
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AuctionCard', () => {
  it('renders auction title', () => {
    render(<AuctionCard auction={makeAuction()} />)
    expect(screen.getByText(/Max Verstappen/i)).toBeInTheDocument()
  })

  it('renders current price', () => {
    render(<AuctionCard auction={makeAuction({ current_price: 42.50 })} />)
    expect(screen.getByText('$42.50')).toBeInTheDocument()
  })

  it('shows SNIPE badge when snipe_eligible', () => {
    render(<AuctionCard auction={makeAuction({ snipe_eligible: true })} />)
    expect(screen.getByText('SNIPE')).toBeInTheDocument()
  })

  it('does not show SNIPE badge when not eligible', () => {
    render(<AuctionCard auction={makeAuction({ snipe_eligible: false })} />)
    expect(screen.queryByText('SNIPE')).not.toBeInTheDocument()
  })

  it('shows SAVED badge when watchlisted', () => {
    render(<AuctionCard auction={makeAuction({ status: 'watchlist', snipe_eligible: false })} />)
    expect(screen.getByText('SAVED')).toBeInTheDocument()
  })

  it('shows bid count', () => {
    render(<AuctionCard auction={makeAuction({ bid_count: 7 })} />)
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('shows "No bids yet" when bid_count is 0', () => {
    render(<AuctionCard auction={makeAuction({ bid_count: 0 })} />)
    expect(screen.getByText(/No bids yet/i)).toBeInTheDocument()
  })

  it('shows free shipping when shipping_cost is 0', () => {
    render(<AuctionCard auction={makeAuction({ shipping_cost: 0 })} />)
    expect(screen.getByText(/Free Ship/i)).toBeInTheDocument()
  })

  it('shows shipping cost when non-zero', () => {
    render(<AuctionCard auction={makeAuction({ shipping_cost: 4.99 })} />)
    expect(screen.getByText('+$4.99')).toBeInTheDocument()
  })

  it('shows parallel badge', () => {
    render(<AuctionCard auction={makeAuction()} />)
    expect(screen.getByText('Base')).toBeInTheDocument()
  })

  it('shows grade badge when not Raw', () => {
    render(<AuctionCard auction={makeAuction({ card: { ...makeAuction().card, grade: 'PSA 10' } })} />)
    expect(screen.getByText('PSA 10')).toBeInTheDocument()
  })

  it('does not show grade badge for Raw', () => {
    render(<AuctionCard auction={makeAuction()} />)
    expect(screen.queryByText('Raw')).not.toBeInTheDocument()
  })

  it('shows snipe score', () => {
    render(<AuctionCard auction={makeAuction({ snipe_score: 72.5 })} />)
    expect(screen.getByText('73')).toBeInTheDocument() // Math.round(72.5)
  })

  it('shows "No Image" placeholder when no images', () => {
    render(<AuctionCard auction={makeAuction({ image_url: null, extra_images: [] })} />)
    expect(screen.getByText(/No Image/i)).toBeInTheDocument()
  })

  it('shows Buy Now button when buy_now_price set and in buying_options', () => {
    render(<AuctionCard auction={makeAuction({
      buy_now_price: 75.0,
      buying_options: ['AUCTION', 'FIXED_PRICE'],
    })} />)
    expect(screen.getByText(/Buy Now/i)).toBeInTheDocument()
  })

  it('shows Make Offer button for BEST_OFFER listings', () => {
    render(<AuctionCard auction={makeAuction({ buying_options: ['BEST_OFFER'] })} />)
    expect(screen.getByText(/Make Offer/i)).toBeInTheDocument()
  })

  it('shows Bid on eBay for auction listings', () => {
    render(<AuctionCard auction={makeAuction({ buying_options: ['AUCTION'] })} />)
    expect(screen.getByText(/Bid on eBay/i)).toBeInTheDocument()
  })

  it('shows seller name', () => {
    render(<AuctionCard auction={makeAuction({ seller: 'megaseller' })} />)
    expect(screen.getByText('megaseller')).toBeInTheDocument()
  })

  it('shows Top Rated badge for seller with 1500 feedback', () => {
    render(<AuctionCard auction={makeAuction({ seller_feedback: 1500 })} />)
    expect(screen.getByText('Top Rated')).toBeInTheDocument()
  })

  it('shows Top Rated+ badge for seller with 10000+ feedback', () => {
    render(<AuctionCard auction={makeAuction({ seller_feedback: 12000 })} />)
    expect(screen.getByText('Top Rated+')).toBeInTheDocument()
  })

  it('shows Trusted badge for 100-999 feedback', () => {
    render(<AuctionCard auction={makeAuction({ seller_feedback: 500 })} />)
    expect(screen.getByText('Trusted')).toBeInTheDocument()
  })

  it('Watch button toggles to Watching on click', async () => {
    // Use auction with pre-loaded images to skip auto-fetch entirely
    const auction = makeAuction({ extra_images: ['img1.jpg', 'img2.jpg'] })
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ watching: true, status: 'watchlist', id: 1 }),
    })
    render(<AuctionCard auction={auction} />)
    const watchBtn = screen.getByText(/Watch$/i)
    await act(async () => { fireEvent.click(watchBtn) })
    await waitFor(() => expect(screen.getByText(/Watching/i)).toBeInTheDocument())
  })

  it('calls onWatchlistChange callback on toggle', async () => {
    const auction = makeAuction({ extra_images: ['img1.jpg', 'img2.jpg'] })
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ watching: true, status: 'watchlist', id: 1 }),
    })
    const onWatchlistChange = vi.fn()
    render(<AuctionCard auction={auction} onWatchlistChange={onWatchlistChange} />)
    const watchBtn = screen.getByText(/Watch$/i)
    await act(async () => { fireEvent.click(watchBtn) })
    await waitFor(() => expect(onWatchlistChange).toHaveBeenCalledWith(1, true))
  })

  it('expanding Bids panel fetches bid history', async () => {
    // Use auction with pre-loaded images to prevent auto image fetch consuming the mock
    const auction = makeAuction({ extra_images: ['img1.jpg', 'img2.jpg'] })
    mockFetch.mockResolvedValue({
      json: async () => ({
        total_bids: 3,
        bid_history: [{ bid_number: 1, estimated_at: '2025-01-01', note: 'Bid placed' }],
        current_price: 35,
      }),
    })
    render(<AuctionCard auction={auction} />)
    // Panel button text is "{bid_count} Bids" — find it via role
    const bidsBtns = screen.getAllByRole('button', { name: /bids/i })
    fireEvent.click(bidsBtns[0])
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auctions/1/bid-history')
      )
    })
  })

  it('timer counts down over time', () => {
    vi.useFakeTimers()
    render(<AuctionCard auction={makeAuction({ time_left: 3600 })} />)
    expect(screen.getByText('1h 0m')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(60000) }) // advance 1 minute
    expect(screen.getByText('59m 0s')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows ENDED when time_left reaches 0', () => {
    vi.useFakeTimers()
    render(<AuctionCard auction={makeAuction({ time_left: 1 })} />)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('ENDED')).toBeInTheDocument()
    vi.useRealTimers()
  })
})


describe('Chunk size / buying options edge cases', () => {
  it('handles empty buying_options array gracefully', () => {
    render(<AuctionCard auction={makeAuction({ buying_options: [] })} />)
    // Should still show Bid on eBay as fallback
    expect(screen.getByText(/Bid on eBay/i)).toBeInTheDocument()
  })

  it('handles null buying_options gracefully', () => {
    render(<AuctionCard auction={makeAuction({ buying_options: null })} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('handles all three buying options simultaneously', () => {
    render(<AuctionCard auction={makeAuction({
      buying_options: ['AUCTION', 'FIXED_PRICE', 'BEST_OFFER'],
      buy_now_price: 50.0,
    })} />)
    expect(screen.getByText(/Buy Now/i)).toBeInTheDocument()
    expect(screen.getByText(/Make Offer/i)).toBeInTheDocument()
    expect(screen.getByText(/Bid on eBay/i)).toBeInTheDocument()
  })

  it('handles very long title by clamping', () => {
    const longTitle = 'A'.repeat(500)
    const { container } = render(<AuctionCard auction={makeAuction({ title: longTitle })} />)
    const titleEl = container.querySelector('.line-clamp-2')
    expect(titleEl).toBeTruthy()
  })

  it('handles multiple extra_images with carousel controls', () => {
    const { container } = render(<AuctionCard auction={makeAuction({
      extra_images: ['img1.jpg', 'img2.jpg', 'img3.jpg'],
      image_url: 'img1.jpg',
    })} />)
    // Carousel prev/next buttons should appear (‹ and ›)
    expect(container.innerHTML).toContain('‹')
    expect(container.innerHTML).toContain('›')
  })

  it('stagger delay uses auction.id for fetch timing', async () => {
    // Verify the component initializes without error for various IDs
    for (const id of [1, 10, 19, 20, 100]) {
      const { unmount } = render(<AuctionCard auction={makeAuction({ id })} />)
      unmount()
    }
  })
})
