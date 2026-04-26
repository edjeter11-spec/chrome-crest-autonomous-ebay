import { useState, useEffect, useRef } from 'react'
import {
  X, ExternalLink, Zap, Clock, Tag, Shield, TrendingUp,
  ChevronLeft, ChevronRight, BookmarkPlus, BookmarkCheck,
  DollarSign, BarChart2, User, Package, Heart, Check, Plus
} from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'
import { upscaleEbayImage } from '../lib/imageUrl'
import CardImagePlaceholder from './CardImagePlaceholder'

const API = import.meta.env.VITE_API_URL || ''
const proxyImg = url => {
  if (!url) return ''
  // Modal renders larger — bump to 800px for crisper detail.
  const sized = upscaleEbayImage(url, 800)
  if (sized.includes('i.ebayimg.com')) return sized
  return `${API}/api/proxy/image?url=${encodeURIComponent(sized)}`
}

const EBAY_BUYER_PROTECTION = 0.0345 // 3.45%

function formatTimeLeft(s) {
  if (s <= 0) return { text: 'ENDED', cls: 'text-gray-500' }
  if (s < 300) return { text: `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`, cls: 'text-red-400 font-mono' }
  if (s < 3600) return { text: `${Math.floor(s/60)}m ${s%60}s`, cls: 'text-orange-400' }
  if (s < 86400) return { text: `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`, cls: 'text-yellow-400' }
  return { text: `${Math.floor(s/86400)}d`, cls: 'text-gray-400' }
}

function ImageGallery({ images, title, driverName, teamColor }) {
  const [idx, setIdx] = useState(0)
  const [failed, setFailed] = useState(new Set())
  const [loaded, setLoaded] = useState(new Set())
  const valid = images?.filter(Boolean) || []
  const displayable = valid.filter((_, i) => !failed.has(i))
  const safe = Math.min(idx, Math.max(0, displayable.length - 1))
  const isLoaded = loaded.has(safe)

  if (!displayable.length) return (
    <div className="w-full h-64 rounded-xl overflow-hidden">
      <CardImagePlaceholder driverName={driverName} teamColor={teamColor} labelClassName="text-base font-black tracking-widest" />
    </div>
  )

  return (
    <div className="relative rounded-xl overflow-hidden bg-gray-900 select-none">
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse" aria-hidden="true" />
      )}
      <img
        src={proxyImg(displayable[safe])}
        alt={title}
        loading="lazy"
        decoding="async"
        className={`w-full h-64 object-contain bg-gray-950 transition-opacity duration-200 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(p => new Set([...p, safe]))}
        onError={() => setFailed(p => new Set([...p, valid.indexOf(displayable[safe])]))}
      />
      {displayable.length > 1 && (
        <>
          <button onClick={() => setIdx(i => (i - 1 + displayable.length) % displayable.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur-sm w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-black/90 transition">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setIdx(i => (i + 1) % displayable.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur-sm w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-black/90 transition">
            <ChevronRight size={16} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {displayable.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)}
                className={`rounded-full transition-all ${i === safe ? 'w-4 h-2 bg-white' : 'w-2 h-2 bg-white/40 hover:bg-white/70'}`} />
            ))}
          </div>
          <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
            {safe + 1}/{displayable.length}
          </div>
        </>
      )}
    </div>
  )
}

function FeeBreakdown({ price, shipping, buyNow }) {
  const base = buyNow || price
  const ebayFee = base * EBAY_BUYER_PROTECTION
  const total = base + (shipping || 0) + ebayFee
  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-2 border border-gray-800/60">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">True Cost</div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-500">Item price</span>
        <span className="text-white font-semibold">${base.toFixed(2)}</span>
      </div>
      {shipping > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Shipping</span>
          <span className="text-gray-300">+${shipping.toFixed(2)}</span>
        </div>
      )}
      {shipping === 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Shipping</span>
          <span className="text-green-400">FREE</span>
        </div>
      )}
      <div className="flex justify-between text-sm">
        <span className="text-gray-500">eBay buyer protection (3.45%)</span>
        <span className="text-gray-400">+${ebayFee.toFixed(2)}</span>
      </div>
      <div className="border-t border-gray-700/60 pt-2 flex justify-between">
        <span className="text-white font-bold text-sm">Total out of pocket</span>
        <span className="text-green-400 font-black text-lg">${total.toFixed(2)}</span>
      </div>
    </div>
  )
}

function PsaPopPanel({ cardId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/cards/${cardId}/psa-pop`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [cardId])

  if (loading) return <div className="h-8 w-full bg-gray-800 animate-pulse rounded" />
  // Hide panel entirely if API returned error or no PSA key — avoids "No PSA key configured" noise.
  if (!data || data.error || data.has_psa_key === false) return null

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/60">
      <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">PSA Population</div>
      <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Shield size={11} className="text-blue-400" />
        {data?.has_psa_key ? (
          <span>PSA key active — population report available on PSA site</span>
        ) : (
          <span className="text-gray-600">No PSA key configured</span>
        )}
      </div>
      {data?.driver && (
        <div className="text-xs text-gray-500">
          {data.driver} · {data.parallel} {data.grade && data.grade !== 'Raw' ? `· ${data.grade}` : ''}
        </div>
      )}
      {data?.psa_search_url && (
        <a href={data.psa_search_url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors">
          <BarChart2 size={11} /> View PSA Population Report <ExternalLink size={9} />
        </a>
      )}
      </div>
    </div>
  )
}

export default function AuctionModal({ auction, onClose, onWatchlistChange }) {
  const [timeLeft, setTimeLeft] = useState(auction.time_left || 0)
  const [images, setImages] = useState(
    auction.extra_images?.length ? auction.extra_images
    : auction.image_url ? [auction.image_url]
    : auction.card?.image_url ? [auction.card.image_url]
    : []
  )
  const [details, setDetails] = useState(null)
  const [watching, setWatching] = useState(auction.status === 'watchlist')
  const [portfolioPanel, setPortfolioPanel] = useState(false)
  const [wishlistPanel, setWishlistPanel] = useState(false)
  const [portfolioPrice, setPortfolioPrice] = useState(auction.current_price?.toFixed(2) || '')
  const [portfolioQty, setPortfolioQty] = useState(1)
  const [wishlistMax, setWishlistMax] = useState(auction.current_price?.toFixed(2) || '')
  const [wishlistPriority, setWishlistPriority] = useState(3)
  const [portfolioDone, setPortfolioDone] = useState(false)
  const [wishlistDone, setWishlistDone] = useState(false)
  const overlayRef = useRef(null)

  // Countdown
  useEffect(() => {
    setTimeLeft(auction.time_left || 0)
    const t = setInterval(() => setTimeLeft(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [auction.time_left])

  // Load full details
  useEffect(() => {
    fetch(`${API}/api/auctions/${auction.id}/details`)
      .then(r => r.json())
      .then(d => {
        setDetails(d)
        if (d.extra_images?.length) setImages(d.extra_images)
        else if (d.image_url) setImages([d.image_url])
      })
      .catch(() => {})
  }, [auction.id])

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === overlayRef.current) onClose()
  }

  // Close on Escape
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const toggleWatch = async () => {
    const res = await fetch(`${API}/api/auctions/${auction.id}/watchlist`, { method: 'POST' })
    const data = await res.json()
    setWatching(data.watching)
    onWatchlistChange?.(auction.id, data.watching)
  }

  const addToPortfolio = async () => {
    if (!auction.card_id) return
    await fetch(`${API}/api/portfolio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: auction.card_id, purchase_price: Number(portfolioPrice), quantity: Number(portfolioQty) }),
    })
    setPortfolioDone(true)
    setPortfolioPanel(false)
  }

  const addToWishlist = async () => {
    if (!auction.card_id) return
    await fetch(`${API}/api/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: auction.card_id, max_price: Number(wishlistMax), priority: Number(wishlistPriority) }),
    })
    setWishlistDone(true)
    setWishlistPanel(false)
  }

  const openEbay = () => {
    if (auction.ebay_url) window.open(ebayAffiliateUrl(auction.ebay_url), '_blank', 'noopener,noreferrer')
  }

  const { text: timeText, cls: timeCls } = formatTimeLeft(timeLeft)
  const opts = auction.buying_options || []
  const hasAuction = opts.includes('AUCTION') || (!auction.buy_now_price && opts.length === 0)
  const hasBIN = opts.includes('FIXED_PRICE') || auction.buy_now_price > 0
  const specs = details?.item_specifics || {}

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-gray-950 border border-gray-800/80 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60 sticky top-0 bg-gray-950 z-10">
          <div className="flex items-center gap-2">
            {auction.snipe_eligible && (
              <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-black px-2 py-1 rounded-lg">
                <Zap size={9} fill="white" /> SNIPE
              </span>
            )}
            <span className={`text-sm font-mono font-bold ${timeCls}`}>
              <Clock size={11} className="inline mr-1" />{timeText}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Image gallery */}
          <ImageGallery
            images={images}
            title={auction.title}
            driverName={auction.card?.driver_name || auction.driver_name}
            teamColor={auction.card?.team_color}
          />

          {/* Title + card info */}
          <div>
            <p className="text-sm text-gray-300 leading-relaxed">{auction.title}</p>
            {(auction.card?.parallel || auction.card?.grade) && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {auction.card.parallel && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700/50">
                    {auction.card.parallel}
                  </span>
                )}
                {auction.card.grade && auction.card.grade !== 'Raw' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-900/30 text-yellow-400 border border-yellow-800/40">
                    {auction.card.grade}
                  </span>
                )}
                {auction.condition && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-500">{auction.condition}</span>
                )}
              </div>
            )}
          </div>

          {/* Price row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/60">
              <div className="text-xs text-gray-500 mb-1">{hasAuction ? 'Current Bid' : 'Buy It Now'}</div>
              <div className="text-2xl font-black text-white">${auction.current_price?.toFixed(2)}</div>
              {hasAuction && (
                <div className="text-xs text-gray-500 mt-1">
                  {auction.bid_count > 0
                    ? <><span className="text-white font-bold">{auction.bid_count}</span> bids</>
                    : 'No bids yet'}
                </div>
              )}
            </div>
            {auction.snipe_score > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/60 flex flex-col justify-center items-center">
                <div className={`text-3xl font-black ${
                  auction.snipe_score >= 80 ? 'text-red-400' :
                  auction.snipe_score >= 60 ? 'text-orange-400' :
                  auction.snipe_score >= 40 ? 'text-yellow-400' : 'text-gray-500'
                }`}>{Math.round(auction.snipe_score)}</div>
                <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1">Snipe Score</div>
              </div>
            )}
          </div>

          {/* Fee calculator */}
          <FeeBreakdown
            price={auction.current_price}
            shipping={auction.shipping_cost}
            buyNow={hasBIN ? auction.buy_now_price : null}
          />

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={openEbay}
              className="flex items-center justify-center gap-2 py-3 bg-blue-700 hover:bg-blue-600 text-white font-bold rounded-xl transition-colors"
            >
              {hasBIN ? <><Tag size={14} /> Buy on eBay</> : <><ExternalLink size={14} /> Bid on eBay</>}
            </button>
            <button
              onClick={toggleWatch}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-colors ${
                watching
                  ? 'bg-yellow-700/30 text-yellow-400 border border-yellow-700/40 hover:bg-yellow-700/50'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {watching ? <><BookmarkCheck size={14} /> Watching</> : <><BookmarkPlus size={14} /> Watch</>}
            </button>
          </div>

          {/* Add to Portfolio / Wishlist */}
          {auction.card_id && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <button
                  onClick={() => { setPortfolioPanel(p => !p); setWishlistPanel(false) }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    portfolioDone ? 'bg-green-800/30 text-green-400 border border-green-700/30' :
                    portfolioPanel ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}>
                  {portfolioDone ? <><Check size={12} /> In Portfolio</> : <><Package size={12} /> Add to Portfolio</>}
                </button>
                {portfolioPanel && (
                  <div className="mt-2 p-3 bg-gray-900 rounded-xl border border-gray-700/60 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="text-[10px] text-gray-500 mb-1">Buy price</div>
                        <input type="number" value={portfolioPrice} onChange={e => setPortfolioPrice(e.target.value)}
                          className="w-full bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 border border-gray-700" />
                      </div>
                      <div className="w-16">
                        <div className="text-[10px] text-gray-500 mb-1">Qty</div>
                        <input type="number" min="1" value={portfolioQty} onChange={e => setPortfolioQty(e.target.value)}
                          className="w-full bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 border border-gray-700" />
                      </div>
                    </div>
                    <button onClick={addToPortfolio} className="w-full py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg transition-colors">
                      <Plus size={10} className="inline mr-1" /> Add
                    </button>
                  </div>
                )}
              </div>
              <div>
                <button
                  onClick={() => { setWishlistPanel(p => !p); setPortfolioPanel(false) }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    wishlistDone ? 'bg-pink-900/30 text-pink-400 border border-pink-800/30' :
                    wishlistPanel ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}>
                  {wishlistDone ? <><Check size={12} /> On Wishlist</> : <><Heart size={12} /> Add to Wishlist</>}
                </button>
                {wishlistPanel && (
                  <div className="mt-2 p-3 bg-gray-900 rounded-xl border border-gray-700/60 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="text-[10px] text-gray-500 mb-1">Max price</div>
                        <input type="number" value={wishlistMax} onChange={e => setWishlistMax(e.target.value)}
                          className="w-full bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 border border-gray-700" />
                      </div>
                      <div className="w-20">
                        <div className="text-[10px] text-gray-500 mb-1">Priority</div>
                        <select value={wishlistPriority} onChange={e => setWishlistPriority(e.target.value)}
                          className="w-full bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
                          <option value={1}>Low</option>
                          <option value={2}>Med</option>
                          <option value={3}>High</option>
                          <option value={4}>V.High</option>
                          <option value={5}>Must</option>
                        </select>
                      </div>
                    </div>
                    <button onClick={addToWishlist} className="w-full py-1.5 bg-pink-700 hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-colors">
                      <Plus size={10} className="inline mr-1" /> Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Seller info */}
          <div className="flex items-center gap-3 text-sm bg-gray-900 rounded-xl p-4 border border-gray-800/60">
            <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center">
              <User size={14} className="text-gray-500" />
            </div>
            <div>
              <div className="text-white font-semibold">{auction.seller || '—'}</div>
              <div className="text-xs text-gray-500">
                {auction.seller_feedback?.toLocaleString()} feedback
                {details?.returns_accepted && <span className="text-green-500 ml-2">✓ Returns</span>}
                {details?.item_location && <span className="ml-2">📍 {details.item_location}</span>}
              </div>
            </div>
            {auction.ebay_url && (
              <a href={ebayAffiliateUrl(`https://www.ebay.com/sch/${auction.seller}`)} target="_blank" rel="sponsored noopener"
                className="ml-auto text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                <ExternalLink size={10} /> Seller
              </a>
            )}
          </div>

          {/* Item specifics */}
          {Object.keys(specs).length > 0 && (
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/60">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Card Details</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(specs).slice(0, 10).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10px] text-gray-600 uppercase tracking-wide">{k}</div>
                    <div className="text-xs text-gray-300 font-medium">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PSA Pop — PsaPopPanel returns null when no PSA key / error, so we wrap in a frag */}
          {auction.card_id && (
            <PsaPopPanel cardId={auction.card_id} />
          )}

          {/* Market value comparison */}
          {auction.card?.investment_score && (
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/60">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Market Context</div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Catalog base value</span>
                <span className="text-white font-bold">
                  {auction.card?.base_value ? `$${auction.card.base_value.toFixed(2)}` : '—'}
                </span>
              </div>
              {auction.card?.base_value && (
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-500">Current vs base</span>
                  <span className={auction.current_price <= auction.card.base_value ? 'text-green-400 font-bold' : 'text-red-400'}>
                    {auction.current_price <= auction.card.base_value ? '✓ Below base' : `+${((auction.current_price / auction.card.base_value - 1) * 100).toFixed(0)}% above`}
                  </span>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
