import { useState, useEffect } from 'react'
import {
  ExternalLink, Zap, Clock, Tag, BookmarkPlus, BookmarkCheck,
  ChevronDown, ChevronUp, TrendingUp, Shield, User, Gavel, MessageSquare, Share2,
  BadgeCheck, Award, RotateCw, X
} from 'lucide-react'
import { scarcityBadgeStyle } from '../lib/hooks'
import { verdictFor } from '../lib/verdict'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const proxyImg = (url) => {
  if (!url) return ''
  // eBay CDN is CORS-friendly — skip the proxy for 1 less network hop
  if (url.includes('i.ebayimg.com')) return url
  return `${API}/api/proxy/image?url=${encodeURIComponent(url)}`
}

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

function BidIntentModal({ auction, onClose, onSaved }) {
  const [maxBid, setMaxBid] = useState(String((auction.current_price || 0) + 5))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const itemId = auction.ebay_listing_id?.includes('|')
    ? auction.ebay_listing_id.split('|')[1]
    : auction.ebay_listing_id
  const bidUrl = itemId ? `https://www.ebay.com/itm/${itemId}?intent=BID` : auction.ebay_url

  const save = async (goToEbay) => {
    if (!maxBid || Number(maxBid) <= 0) return
    setSaving(true)
    try {
      const r = await fetch(`${API}/api/auctions/${auction.id}/bid-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_bid: Number(maxBid), notes }),
      })
      const data = await r.json()
      onSaved?.(data)
      if (goToEbay && bidUrl) window.open(bidUrl, '_blank', 'noopener')
      onClose()
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl p-5 max-w-md w-full"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-white font-black text-lg">Plan Your Bid</h3>
            <p className="text-xs text-gray-500 mt-0.5">{auction.card?.driver_name} · {auction.card?.parallel || ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Max Bid ($)</label>
            <input
              type="number"
              step="0.5"
              value={maxBid}
              onChange={e => setMaxBid(e.target.value)}
              className="input-field w-full px-3 py-2 text-sm mt-1"
              autoFocus
            />
            <p className="text-[10px] text-gray-500 mt-1">
              Current: ${auction.current_price?.toFixed(2) || '—'}
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Why this one?"
              className="input-field w-full px-3 py-2 text-sm mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              disabled={saving}
              onClick={() => save(false)}
              className="py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold disabled:opacity-50"
            >
              Save Intent
            </button>
            <button
              disabled={saving}
              onClick={() => save(true)}
              className="py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-black disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Zap size={11} fill="white" /> Save + Bid on eBay
            </button>
          </div>
          <p className="text-[10px] text-gray-600 leading-snug pt-1">
            Intents are saved to your account. When an eBay user token is configured,
            we'll auto-execute matching snipes. Until then, "Bid on eBay" deep-links
            to the bid confirmation page.
          </p>
        </div>
      </div>
    </div>
  )
}

function ScarcityBadge({ tier, count }) {
  const style = scarcityBadgeStyle(tier)
  if (!style) return null
  return (
    <span
      className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${style.color} tabular-nums`}
      title={`Scarcity tier ${tier}${count ? ` · /${count}` : ''}`}
    >
      {style.label}
    </span>
  )
}

function SellerBadge({ feedback }) {
  if (feedback == null) return <span className="skeleton w-14 h-3 rounded" />
  if (feedback >= 10000) return <span className="text-xs font-semibold text-yellow-400">Top Rated+</span>
  if (feedback >= 1000) return <span className="text-xs font-semibold text-green-400">Top Rated</span>
  if (feedback >= 100) return <span className="text-xs font-semibold text-blue-400">Trusted</span>
  return <span className="text-xs text-gray-500">{feedback} fb</span>
}

function CardImageFallback({ teamColor, driverName }) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center"
      style={{ background: `linear-gradient(145deg, #0d0d0d 0%, ${teamColor || '#1a1a2e'}55 100%)` }}
    >
      <div className="text-3xl mb-2 opacity-30 select-none">🏎</div>
      <div className="text-[10px] text-gray-600 font-semibold tracking-widest uppercase">
        {driverName?.split(' ').pop() || 'F1'}
      </div>
    </div>
  )
}

function ImageCarousel({ images, title, driverName, teamColor }) {
  const [idx, setIdx] = useState(0)
  const [failed, setFailed] = useState(new Set())
  const valid = images?.filter(u => u && !u.includes('placehold.co')).map(proxyImg) || []
  const displayable = valid.filter((_, i) => !failed.has(i))

  useEffect(() => { setFailed(new Set()); setIdx(0) }, [images?.join(',')])

  if (!displayable.length) return (
    <CardImageFallback teamColor={teamColor} driverName={driverName} />
  )

  // Clamp idx to displayable range
  const safeIdx = Math.min(idx, displayable.length - 1)

  return (
    <div className="relative w-full h-full group bg-gray-900">
      <img
        src={displayable[safeIdx]}
        alt={title}
        className="w-full h-full object-cover"
        onError={e => {
          // Find the original index of this URL and mark it failed
          const failedUrl = e.target.src
          const origIdx = valid.indexOf(failedUrl)
          if (origIdx !== -1) setFailed(prev => new Set([...prev, origIdx]))
        }}
      />
      {displayable.length > 1 && (
        <>
          <button
            onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + displayable.length) % displayable.length) }}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none shadow-lg"
          >‹</button>
          <button
            onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % displayable.length) }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none shadow-lg"
          >›</button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {displayable.map((_, i) => (
              <button
                key={i}
                onClick={e => { e.stopPropagation(); setIdx(i) }}
                className={`rounded-full transition-all duration-200 ${i === safeIdx ? 'w-3.5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/40 hover:bg-white/70'}`}
              />
            ))}
          </div>
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
            {safeIdx + 1}/{displayable.length}
          </div>
        </>
      )}
    </div>
  )
}

function PricingOptions({ auction, comp }) {
  const opts = auction.buying_options || []
  const hasAuction = opts.includes('AUCTION') || (opts.length === 0 && !auction.buy_now_price)
  const hasBIN = opts.includes('FIXED_PRICE') || auction.buy_now_price > 0
  const hasBestOffer = opts.includes('BEST_OFFER')
  const totalCost = (auction.current_price || 0) + (auction.shipping_cost || 0)

  // Build "vs median" pill + verdict badge ("STRONG BUY" / "GOOD BUY" / "FAIR" / "PASS").
  let medianPill = null
  let verdict = null
  if (comp) {
    if (comp.low_confidence || (comp.n ?? 0) < 3) {
      medianPill = (
        <span className="text-[10px] text-gray-500 uppercase tracking-wide" title={`Only ${comp.n} comps in 90d`}>
          thin comps
        </span>
      )
    } else if (comp.median_total) {
      const v = verdictFor(totalCost, comp.median_total, comp.n)
      if (v) {
        const pct = v.pctVsMedian
        medianPill = (
          <span className={`text-[10px] ${v.text} font-semibold`} title={`Median total over last 90d (n=${comp.n})`}>
            {pct > 0 ? `${pct}% below` : `${-pct}% above`} median ${Math.round(comp.median_total)} · n={comp.n}
          </span>
        )
        verdict = (
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${v.cls} tracking-wider`}
                title={`Total $${totalCost.toFixed(2)} vs $${Math.round(comp.median_total)} median (n=${comp.n})`}>
            {v.label}
          </span>
        )
      }
    }
  }

  return (
    <div className="space-y-2">
      {/* Price + score row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-black text-white tracking-tight">
              ${auction.current_price?.toFixed(2) ?? '—'}
            </span>
            {auction.shipping_cost === 0 ? (
              <span className="text-[10px] text-green-500 font-semibold uppercase tracking-wide">Free Ship</span>
            ) : auction.shipping_cost > 0 ? (
              <span className="text-xs text-gray-500" title={`Total $${totalCost.toFixed(2)}`}>+${auction.shipping_cost?.toFixed(2)} ship</span>
            ) : null}
          </div>
          {(medianPill || verdict) && (
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              {verdict}
              {medianPill}
            </div>
          )}
          {hasAuction && (
            <div className="text-xs mt-0.5">
              {auction.bid_count > 0
                ? <span className="text-gray-400"><span className="text-white font-semibold">{auction.bid_count}</span> bids</span>
                : <span className="text-gray-600 italic">No bids yet</span>
              }
            </div>
          )}
        </div>
        {auction.snipe_score > 0 && (
          <div className="text-right shrink-0">
            <div className={`text-base font-black tabular-nums leading-none ${
              auction.snipe_score >= 80 ? 'text-red-400' :
              auction.snipe_score >= 60 ? 'text-orange-400' :
              auction.snipe_score >= 40 ? 'text-yellow-400' : 'text-gray-600'
            }`}>{Math.round(auction.snipe_score)}</div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">snipe</div>
          </div>
        )}
      </div>

      {/* Pricing option buttons */}
      <div className="flex flex-col gap-1">
        {hasBIN && auction.buy_now_price && (
          <a
            href={auction.ebay_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-2 bg-green-700 hover:bg-green-600 active:bg-green-800 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Tag size={10} />
            Buy Now · ${auction.buy_now_price?.toFixed(2)}
          </a>
        )}
        {hasBestOffer && (
          <a
            href={auction.ebay_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-2 bg-blue-800/80 hover:bg-blue-700 active:bg-blue-900 text-blue-200 text-xs font-bold rounded-lg transition-colors border border-blue-700/50"
          >
            <MessageSquare size={10} />
            Make Offer
          </a>
        )}
        {auction.ebay_url && (
          <a
            href={auction.ebay_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-900 text-gray-400 hover:text-gray-200 text-xs font-medium rounded-lg transition-colors"
          >
            {hasAuction ? <><Gavel size={10} /> Bid on eBay</> : <><ExternalLink size={10} /> View on eBay</>}
          </a>
        )}
      </div>
    </div>
  )
}

function BidHistoryPanel({ auctionId }) {
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/auctions/${auctionId}/bid-history`)
      .then(r => r.json())
      .then(d => { setHistory(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [auctionId])

  if (loading) return (
    <div className="space-y-2 py-1">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-4 rounded w-full" />)}
    </div>
  )
  if (!history) return <p className="text-xs text-gray-600 py-2">No data available</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 font-medium">{history.total_bids} total bids</span>
        <span className="text-white font-bold">${history.current_price?.toFixed(2)}</span>
      </div>
      {history.bid_history?.length > 0 ? (
        <div className="space-y-1 max-h-28 overflow-y-auto">
          {[...history.bid_history].reverse().map((b, i) => (
            <div key={i} className="flex justify-between text-xs text-gray-500 py-0.5 border-b border-gray-800/50 last:border-0">
              <span className="text-gray-600">#{b.bid_number}</span>
              <span className="text-gray-400">{b.note}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600 italic">No bids yet — first mover advantage</p>
      )}
      {history.ebay_bid_url && (
        <a href={history.ebay_bid_url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ExternalLink size={10} /> Full history on eBay
        </a>
      )}
    </div>
  )
}

function DetailsPanel({ auctionId, onImages }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/auctions/${auctionId}/details`)
      .then(r => r.json())
      .then(d => {
        setDetails(d)
        setLoading(false)
        if (d.extra_images?.length > 0) onImages?.(d.extra_images)
      })
      .catch(() => setLoading(false))
  }, [auctionId])

  if (loading) return (
    <div className="space-y-2 py-1">
      {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-3.5 rounded" style={{ width: `${60 + Math.random() * 30}%` }} />)}
    </div>
  )

  const entries = Object.entries(details?.item_specifics || {}).slice(0, 8)

  return (
    <div className="space-y-2.5">
      {details?.condition_description && (
        <p className="text-xs text-gray-400 leading-relaxed">{details.condition_description}</p>
      )}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[10px] text-gray-600 uppercase tracking-wide">{k}</div>
              <div className="text-xs text-gray-300 font-medium truncate">{v}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
        {details?.returns_accepted && <span className="text-green-500 font-medium">✓ Returns</span>}
        {details?.item_location && <span>📍 {details.item_location}</span>}
        {details?.quantity_sold > 0 && <span className="text-orange-400">🔥 {details.quantity_sold} sold</span>}
        {!details?.condition_description && !entries.length && (
          <span className="text-gray-700 italic">Syncing details from eBay…</span>
        )}
      </div>
    </div>
  )
}

function SellerPanel({ auctionId }) {
  const [seller, setSeller] = useState(null)
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/auctions/${auctionId}/seller`)
      .then(r => r.json())
      .then(d => {
        setSeller(d); setLoading(false)
        // Fire insights lookup after we know the seller handle
        if (d?.seller) {
          fetch(`${API}/api/sellers/insights?seller=${encodeURIComponent(d.seller)}`)
            .then(r => r.ok ? r.json() : null)
            .then(setInsights)
            .catch(() => {})
        }
      })
      .catch(() => setLoading(false))
  }, [auctionId])

  if (loading) return (
    <div className="space-y-2 py-1">
      <div className="skeleton h-4 rounded w-3/4" />
      <div className="skeleton h-3.5 rounded w-1/2" />
    </div>
  )
  if (!seller) return null

  const tierColors = {
    gold: 'text-yellow-400 bg-yellow-900/20',
    green: 'text-green-400 bg-green-900/20',
    blue: 'text-blue-400 bg-blue-900/20',
    gray: 'text-gray-400 bg-gray-800',
  }
  const tc = tierColors[seller.tier_color] || tierColors.gray

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center">
          <User size={12} className="text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-200 font-semibold truncate">{seller.seller || <span className="skeleton w-20 h-3 rounded" />}</div>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tc}`}>{seller.tier}</span>
        </div>
      </div>
      <div className="flex gap-4 text-xs text-gray-500">
        <span><span className="text-white font-bold">{seller.feedback_score?.toLocaleString() ?? '—'}</span> feedback</span>
        {seller.auctions_from_seller > 1 && (
          <span><span className="text-white font-bold">{seller.auctions_from_seller}</span> listings</span>
        )}
        {insights?.recent_listings_24h > 0 && (
          <span><span className="text-white font-bold">{insights.recent_listings_24h}</span> listed 24h</span>
        )}
      </div>
      {insights?.flags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {insights.flags.map(f => {
            const style = {
              top_rated:    'bg-yellow-900/40 text-yellow-300 border-yellow-800/40',
              power_lister: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
              flooder:      'bg-orange-900/40 text-orange-300 border-orange-800/40',
              low_feedback: 'bg-gray-800 text-gray-400 border-gray-700',
              suspicious:   'bg-red-900/40 text-red-300 border-red-800/40',
              many_unsold:  'bg-purple-900/40 text-purple-300 border-purple-800/40',
            }[f] || 'bg-gray-800 text-gray-400 border-gray-700'
            const label = f.replace(/_/g, ' ').toUpperCase()
            return (
              <span key={f} className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style}`}>
                {label}
              </span>
            )
          })}
        </div>
      )}
      {seller.ebay_seller_url && (
        <a href={seller.ebay_seller_url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ExternalLink size={10} /> View seller on eBay
        </a>
      )}
    </div>
  )
}

export default function AuctionCard({ auction, onWatchlistChange, onClick }) {
  const [timeLeft, setTimeLeft] = useState(auction.time_left || 0)
  const [watching, setWatching] = useState(auction.status === 'watchlist')
  const [watchLoading, setWatchLoading] = useState(false)
  const [shareToast, setShareToast] = useState(false)
  const [expandedPanel, setExpandedPanel] = useState(null)
  const [comp, setComp] = useState(null)
  const [bidIntentOpen, setBidIntentOpen] = useState(false)
  const [savedIntent, setSavedIntent] = useState(null)

  // Fetch latest bid intent for this auction (passive — non-blocking)
  useEffect(() => {
    if (!auction.id) return
    fetch(`${API}/api/auctions/${auction.id}/bid-intents`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const latest = d?.intents?.[0]
        if (latest) setSavedIntent(latest)
      })
      .catch(() => {})
  }, [auction.id])

  // Pull median comp for this driver+parallel (+grade if present in title).
  // Server-side prefetch: when the parent already supplied verdict_comp on the
  // auction row (Feature 2 — /api/auctions/with-verdicts), skip the per-card
  // network round-trip entirely.
  useEffect(() => {
    if (auction.verdict_comp) { setComp(auction.verdict_comp); return }
    const driver = auction.card?.driver_name
    const parallel = auction.card?.parallel
    if (!driver) return
    const title = (auction.title || '').toUpperCase()
    let grade = null
    const gm = title.match(/\b(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7)\b/)
    if (gm) grade = `${gm[1]} ${gm[2]}`
    const qs = new URLSearchParams({ driver, ...(parallel ? { parallel } : {}), ...(grade ? { grade } : {}) })
    fetch(`${API}/api/sales/median?${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(setComp)
      .catch(() => {})
  }, [auction.id, auction.card?.driver_name, auction.card?.parallel, auction.title, auction.verdict_comp])

  // Priority: extra_images → listing image_url → card catalog image
  const [images, setImages] = useState(() => {
    if (auction.extra_images?.length) return auction.extra_images
    if (auction.image_url) return [auction.image_url]
    if (auction.card?.image_url) return [auction.card.image_url]
    return []
  })
  // Sync time
  useEffect(() => {
    setTimeLeft(auction.time_left || 0)
    const timer = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
    return () => clearInterval(timer)
  }, [auction.time_left])

  useEffect(() => { setWatching(auction.status === 'watchlist') }, [auction.status])

  const { text: timeText, cls: timeCls } = formatTimeLeft(timeLeft)
  const isHot = auction.snipe_eligible
  const isEnded = timeLeft <= 0

  const toggleWatchlist = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    setWatchLoading(true)
    try {
      const res = await fetch(`${API}/api/auctions/${auction.id}/watch`, { method: 'POST' })
      const data = await res.json()
      setWatching(data.watching)
      onWatchlistChange?.(auction.id, data.watching)
    } catch {}
    setWatchLoading(false)
  }

  const togglePanel = (panel, e) => { e?.stopPropagation(); setExpandedPanel(p => p === panel ? null : panel) }

  const shareListing = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    const url = `${window.location.origin}/auctions?id=${auction.id}`
    const shareData = {
      title: auction.title || 'F1 Card Hub',
      text: `${auction.card?.driver_name || 'F1 card'} — $${auction.current_price?.toFixed(2) ?? ''} on F1 Card Hub`,
      url,
    }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
    } catch { /* user cancelled */ return }
    try {
      await navigator.clipboard.writeText(url)
      setShareToast(true)
      setTimeout(() => setShareToast(false), 2000)
    } catch {}
  }

  // Parallel/grade badge from card data
  const parallel = auction.card?.parallel
  const grade = auction.card?.grade
  const teamColor = auction.card?.team_color

  return (
    <div
      onClick={onClick}
      className={`relative bg-gray-900 rounded-2xl border overflow-hidden card-hover flex flex-col group cursor-pointer
        ${isHot ? 'border-red-500/50 snipe-pulse' : watching ? 'border-yellow-600/40' : 'border-gray-800/80'}
      `}>

      {/* Image area */}
      <div className="relative h-44 bg-gray-800 overflow-hidden shrink-0">
        <ImageCarousel
          images={images}
          title={auction.title}
          driverName={auction.card?.driver_name}
          teamColor={auction.card?.team_color}
        />

        {/* Team color accent bar */}
        {teamColor && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-70" style={{ backgroundColor: teamColor }} />
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
          {isHot && (
            <div className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-black px-2 py-1 rounded-lg shadow-lg">
              <Zap size={9} fill="white" /> SNIPE
            </div>
          )}
          {watching && !isHot && (
            <div className="flex items-center gap-1 bg-yellow-700/90 text-white text-[10px] font-bold px-2 py-1 rounded-lg">
              <BookmarkCheck size={9} /> SAVED
            </div>
          )}
        </div>

        {/* Top-right: trust icons + LIVE badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          {(auction.seller_feedback || 0) >= 1000 && (
            <span
              className="bg-green-900/70 backdrop-blur-sm border border-green-500/50 rounded-lg px-1.5 py-1 text-green-300"
              title={`Verified seller · ${auction.seller_feedback?.toLocaleString()} feedback`}
            >
              <BadgeCheck size={10} />
            </span>
          )}
          {auction.returns_accepted && (
            <span
              className="bg-blue-900/70 backdrop-blur-sm border border-blue-500/50 rounded-lg px-1.5 py-1 text-blue-300"
              title="Returns accepted"
            >
              <RotateCw size={10} />
            </span>
          )}
          {!isEnded && (
            <div className="bg-gray-900/80 backdrop-blur-sm text-blue-400 text-[10px] font-bold px-2 py-1 rounded-lg border border-blue-900/50">
              LIVE
            </div>
          )}
        </div>

        {/* Timer — only on auction listings */}
        {((auction.buying_options || []).includes('AUCTION') || !(auction.buying_options?.length)) && (
          <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 text-xs font-mono font-bold ${timeCls}
            bg-gray-950/80 backdrop-blur-sm px-2.5 py-1 rounded-lg flex items-center gap-1.5 z-10 shadow`}>
            <Clock size={9} />
            {timeText}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col flex-1 gap-2">

        {/* Title */}
        <p className="text-xs text-gray-400 leading-snug line-clamp-2 min-h-[2.5rem]">
          {auction.title || <><span className="skeleton h-3 rounded w-full mb-1 block" /><span className="skeleton h-3 rounded w-3/4 block" /></>}
        </p>

        {/* End time + bid count row */}
        <div className="flex items-center justify-between gap-2">
          {/* End date/time */}
          <div className="flex items-center gap-1 min-w-0">
            <Clock size={9} className="text-gray-600 shrink-0" />
            <span className="text-[10px] text-gray-500 truncate">
              {auction.end_time
                ? (() => {
                    const end = new Date(auction.end_time)
                    const now = new Date()
                    const isToday = end.toDateString() === now.toDateString()
                    const isTomorrow = end.toDateString() === new Date(now.getTime() + 86400000).toDateString()
                    const time = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                    return isEnded ? 'Ended'
                      : isToday ? `Today ${time}`
                      : isTomorrow ? `Tomorrow ${time}`
                      : `${end.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
                  })()
                : '—'
              }
            </span>
          </div>
          {/* Bid count badge */}
          <div className={`flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded-lg text-[10px] font-bold ${
            auction.bid_count > 0
              ? 'bg-blue-900/30 text-blue-400 border border-blue-800/40'
              : 'bg-gray-800/60 text-gray-600 border border-gray-700/30'
          }`}>
            <Gavel size={8} />
            {auction.bid_count > 0 ? `${auction.bid_count} bid${auction.bid_count !== 1 ? 's' : ''}` : 'No bids'}
          </div>
        </div>

        {/* Parallel + grade + scarcity + rookie tags */}
        {(parallel || grade || auction.scarcity_tier || auction.is_rookie) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <ScarcityBadge tier={auction.scarcity_tier} count={auction.scarcity_count} />
            {auction.is_rookie && (
              <span
                className="text-[10px] font-black px-1.5 py-0.5 rounded bg-pink-900/40 text-pink-300 border border-pink-700/50 flex items-center gap-1"
                title="2025 Rookie Card"
              >
                <Award size={9} /> RC
              </span>
            )}
            {parallel && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700/50">
                {parallel}
              </span>
            )}
            {grade && grade !== 'Raw' && (
              <span className="text-xs font-black px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-300 border border-yellow-700/60 shadow-sm">
                {grade}
              </span>
            )}
          </div>
        )}

        {/* Seller row */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 truncate max-w-[90px]">
            {auction.seller || <span className="skeleton w-16 h-2.5 rounded" />}
          </span>
          <SellerBadge feedback={auction.seller_feedback} />
        </div>

        {/* Pricing options */}
        <PricingOptions auction={auction} comp={comp} />

        {/* Saved intent chip */}
        {savedIntent && (
          <div className="text-[10px] text-amber-300 bg-amber-900/25 border border-amber-700/40 rounded-lg px-2 py-1 flex items-center gap-1.5">
            <Zap size={9} fill="currentColor" />
            <span className="font-bold">Your max bid: ${savedIntent.max_bid?.toFixed(2)}</span>
            {savedIntent.notes && <span className="text-amber-400/70 truncate">· {savedIntent.notes}</span>}
          </div>
        )}

        {/* Place Bid (snipe executor) */}
        {auction.snipe_eligible && (
          <button
            onClick={(e) => { e.stopPropagation(); setBidIntentOpen(true) }}
            className="w-full py-1.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            <Zap size={11} fill="white" /> Place Snipe Bid
          </button>
        )}

        {bidIntentOpen && (
          <BidIntentModal
            auction={auction}
            onClose={() => setBidIntentOpen(false)}
            onSaved={(data) => {
              setSavedIntent({
                max_bid: data.max_bid,
                notes: '',
                id: data.intent_id,
                created_at: new Date().toISOString(),
              })
            }}
          />
        )}

        {/* Watchlist + share buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={toggleWatchlist}
            disabled={watchLoading}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
              watching
                ? 'bg-yellow-700/25 text-yellow-400 hover:bg-yellow-700/40 border border-yellow-700/30'
                : 'bg-gray-800/60 hover:bg-gray-800 text-gray-500 hover:text-gray-300 border border-gray-700/30'
            }`}
          >
            {watching ? <><BookmarkCheck size={11} /> Watching</> : <><BookmarkPlus size={11} /> Watch</>}
          </button>
          <button
            onClick={shareListing}
            title="Share listing"
            aria-label="Share listing"
            className="relative shrink-0 py-1.5 px-2.5 rounded-lg bg-gray-800/60 hover:bg-gray-800 text-gray-500 hover:text-gray-200 border border-gray-700/30 transition-colors"
          >
            <Share2 size={11} />
            {shareToast && (
              <span className="absolute -top-8 right-0 text-[10px] bg-emerald-600 text-white font-bold px-2 py-1 rounded whitespace-nowrap shadow-lg">
                Link copied!
              </span>
            )}
          </button>
        </div>

        {/* Expandable panel toggles */}
        <div className="flex gap-1 border-t border-gray-800/60 pt-2 mt-auto">
          {[
            { key: 'bids', icon: TrendingUp, label: `${auction.bid_count ?? '—'} Bids` },
            { key: 'seller', icon: Shield, label: 'Seller' },
            { key: 'details', icon: ExternalLink, label: 'Details' },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={(e) => togglePanel(key, e)}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                expandedPanel === key
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800/40'
              }`}
            >
              <Icon size={9} />
              {label}
              {expandedPanel === key ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
            </button>
          ))}
        </div>

        {/* Expanded content */}
        {expandedPanel && (
          <div className="pt-2 border-t border-gray-800/60 text-xs">
            {expandedPanel === 'bids' && <BidHistoryPanel auctionId={auction.id} />}
            {expandedPanel === 'seller' && <SellerPanel auctionId={auction.id} />}
            {expandedPanel === 'details' && (
              <DetailsPanel
                auctionId={auction.id}
                onImages={imgs => setImages(imgs)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
