import { useEffect, useRef, useState } from 'react'
import { X, ExternalLink, BookmarkPlus, BookmarkCheck, Clock, Gavel, Store, ShieldCheck } from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'
import { verdictFor } from '../lib/verdict'
import VerdictBadge from './VerdictBadge'
import CardImage from './CardImage'

const API = import.meta.env.VITE_API_URL || ''

// Same time-formatter the AuctionCard uses, scaled for modal text.
function formatTimeLeft(seconds) {
  if (seconds == null || seconds <= 0) return { text: 'ENDED', cls: 'text-gray-500' }
  if (seconds < 300) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return { text: `${m}:${s.toString().padStart(2, '0')}`, cls: 'text-red-400' }
  }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    return { text: `${m}m`, cls: 'text-orange-400' }
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return { text: `${h}h ${m}m`, cls: 'text-yellow-400' }
  }
  const d = Math.floor(seconds / 86400)
  return { text: `${d}d`, cls: 'text-gray-400' }
}

function computeSecsLeft(auction) {
  if (!auction) return 0
  if (auction.end_time) {
    const s = String(auction.end_time)
    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    const dt = new Date(hasTz ? s : s + 'Z')
    const secs = Math.floor((dt.getTime() - Date.now()) / 1000)
    if (!Number.isNaN(secs)) return Math.max(0, secs)
  }
  return auction.time_left || 0
}

export default function CardDetailModal({ auction, onClose, onWatchlistChange }) {
  const overlayRef = useRef(null)
  const [watching, setWatching] = useState(auction?.status === 'watchlist')
  const [watchLoading, setWatchLoading] = useState(false)
  const [secs, setSecs] = useState(() => computeSecsLeft(auction))

  // ESC to close
  useEffect(() => {
    if (!auction) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [auction, onClose])

  // Sync watching state when the underlying auction changes
  useEffect(() => {
    if (!auction) return
    setWatching(auction.status === 'watchlist')
    setSecs(computeSecsLeft(auction))
  }, [auction?.id, auction?.status, auction?.end_time])

  // Live countdown
  useEffect(() => {
    if (!auction) return
    const id = setInterval(() => setSecs(computeSecsLeft(auction)), 1000)
    return () => clearInterval(id)
  }, [auction?.id, auction?.end_time])

  // Lock body scroll while open
  useEffect(() => {
    if (!auction) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [auction])

  if (!auction) return null

  const handleBackdrop = (e) => {
    if (e.target === overlayRef.current) onClose?.()
  }

  const toggleWatchlist = async () => {
    if (watchLoading) return
    setWatchLoading(true)
    try {
      const res = await fetch(`${API}/api/auctions/${auction.id}/watchlist`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const next = data.watching ?? !watching
        setWatching(next)
        onWatchlistChange?.(auction.id, next)
      } else {
        // Fallback to local-only toggle
        setWatching(w => !w)
      }
    } catch {
      setWatching(w => !w)
    } finally {
      setWatchLoading(false)
    }
  }

  const driverName = auction.card?.driver_name || auction.driver_name
  const parallel = auction.card?.parallel || auction.parallel
  const grade = auction.card?.grade
  const teamColor = auction.card?.team_color
  // Pull serial number / print run from the title — sellers commonly write
  // "22/150" or "/150". Reused logic mirrors BiggestSnipes.parsePrintRun.
  const printRun = (() => {
    const t = auction.title || ''
    const m = t.match(/(?:^|\s|#)(\d{1,3})\/(\d{1,4})\b/)
    if (m) {
      const total = parseInt(m[2], 10)
      const num = parseInt(m[1], 10)
      // Suppress "00/00 Error" ghosts: zero on either side is never a real
      // serial number. (Bug 2 from user audit.)
      if (num <= 0 || total <= 0) return ''
      if (total >= 5 && num <= total) return `#${num}/${total}`
    }
    const m2 = t.match(/(?:^|\s)\/(\d{1,4})\b/)
    if (m2) {
      const total = parseInt(m2[1], 10)
      if (total <= 0) return ''
      if (total >= 5 && total <= 9999) return `/${total}`
    }
    return ''
  })()
  const seller = auction.seller || auction.seller_username || null
  const sellerFb = auction.seller_feedback ?? null
  const totalCost = (auction.current_price || 0) + (auction.shipping_cost || 0)
  const median = auction.verdict_comp?.median_total
  const n = auction.verdict_comp?.n
  const verdictObj = median ? verdictFor(totalCost, median, n) : null
  const isStrongVerdict = auction.verdict === 'STRONG_BUY' || auction.verdict === 'GOOD_BUY' || verdictObj?.key === 'STRONG_BUY' || verdictObj?.key === 'GOOD_BUY'
  const pctBelow = median && totalCost ? Math.round((1 - totalCost / median) * 100) : null
  const { text: timeText, cls: timeCls } = formatTimeLeft(secs)
  const ebayHref = auction.ebay_url ? ebayAffiliateUrl(auction.ebay_url) : null
  const imageSrc = auction.image_url || auction.extra_images?.[0] || auction.card?.image_url

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={auction.title || 'Auction details'}
    >
      <div className="bg-gray-950 border border-gray-800/80 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60 sticky top-0 bg-gray-950 z-10">
          <span className={`text-sm font-mono font-bold ${timeCls} flex items-center gap-1.5`}>
            <Clock size={12} /> {timeText}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-1 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Image */}
          <CardImage
            src={imageSrc}
            alt={auction.title || driverName || 'Card image'}
            className="w-full rounded-xl bg-gray-900"
            aspect="4/3"
            size={800}
            fit="contain"
            driverName={driverName}
            teamColor={teamColor}
            loading="lazy"
          />

          {/* Title */}
          <h2 className="text-lg md:text-xl font-black text-white leading-snug">
            {auction.title || driverName || 'Card details'}
          </h2>

          {/* Driver | Parallel | Grade pills */}
          {(driverName || parallel || grade) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {driverName && (
                <span
                  className="text-xs font-bold px-2 py-1 rounded-full bg-gray-800 border border-gray-700/60"
                  style={teamColor ? { color: teamColor } : { color: '#e5e7eb' }}
                >
                  {driverName}
                </span>
              )}
              {parallel && (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700/60">
                  {parallel}
                </span>
              )}
              {grade && grade !== 'Raw' && (
                <span className="text-xs font-black px-2 py-1 rounded-full bg-yellow-900/40 text-yellow-300 border border-yellow-700/60">
                  {grade}
                </span>
              )}
              {printRun && (
                <span className="text-xs font-black px-2 py-1 rounded-full bg-amber-900/30 text-amber-300 border border-amber-700/50 tabular-nums">
                  {printRun}
                </span>
              )}
            </div>
          )}

          {/* Current price + bid count */}
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/60">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Current Price</div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-black text-white tabular-nums">
                ${auction.current_price?.toFixed(2) ?? '—'}
              </span>
              {auction.shipping_cost === 0 ? (
                <span className="text-xs text-green-400 font-semibold uppercase tracking-wide">Free Ship</span>
              ) : auction.shipping_cost > 0 ? (
                <span className="text-xs text-gray-500">+${auction.shipping_cost.toFixed(2)} shipping</span>
              ) : null}
              <span className={`text-xs font-bold flex items-center gap-1 ml-auto ${
                (auction.bid_count || 0) > 0 ? 'text-blue-400' : 'text-gray-500'
              }`}>
                <Gavel size={11} />
                {auction.bid_count > 0 ? `${auction.bid_count} bid${auction.bid_count === 1 ? '' : 's'}` : 'No bids yet'}
              </span>
            </div>
          </div>

          {/* Verdict block */}
          {isStrongVerdict && (verdictObj || auction.verdict) && (
            <div className={`rounded-xl p-4 border ${
              (auction.verdict === 'STRONG_BUY' || verdictObj?.key === 'STRONG_BUY')
                ? 'bg-green-900/30 border-green-700/60'
                : 'bg-emerald-900/25 border-emerald-700/50'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {verdictObj
                  ? <VerdictBadge verdict={verdictObj} nComps={n} />
                  : (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded bg-green-600 text-white tracking-wider">
                      {auction.verdict === 'STRONG_BUY' ? 'STRONG BUY' : 'GOOD BUY'}
                    </span>
                  )
                }
                {pctBelow != null && pctBelow > 0 && (
                  <span className="text-xs text-emerald-300 font-bold">{pctBelow}% under median</span>
                )}
              </div>
              {median && (
                <p className="text-xs text-gray-300 leading-snug">
                  Median <span className="font-bold text-white">${median.toFixed(0)}</span>
                  {n != null && <> over <span className="font-bold text-white">{n}</span> comp{n === 1 ? '' : 's'}</>}
                  {' '}in last 30d
                  {pctBelow != null && pctBelow > 0 && <>, <span className="text-emerald-400 font-bold">{pctBelow}% under</span></>}
                </p>
              )}
              {!median && (
                <p className="text-xs text-gray-300">
                  Flagged as a {auction.verdict === 'STRONG_BUY' ? 'strong' : 'good'} buy by our pricing model.
                </p>
              )}
            </div>
          )}

          {/* Seller block — eBay seller username + feedback score */}
          {(seller || sellerFb != null) && (
            <div className="bg-gray-900/60 rounded-xl p-3 border border-gray-800/60">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <Store size={10} /> Seller
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {seller && seller !== 'unknown_seller' ? (
                  <a
                    href={`https://www.ebay.com/usr/${encodeURIComponent(seller)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-bold text-white hover:text-blue-400 hover:underline transition-colors"
                  >
                    {seller}
                  </a>
                ) : (
                  <span className="text-sm text-gray-500">Unknown seller</span>
                )}
                {sellerFb != null && sellerFb > 0 && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      sellerFb >= 1000
                        ? 'bg-green-900/40 text-green-300'
                        : sellerFb >= 100
                        ? 'bg-blue-900/40 text-blue-300'
                        : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    {sellerFb >= 1000 && <ShieldCheck size={10} className="inline -mt-0.5 mr-1" />}
                    {sellerFb.toLocaleString()} feedback
                  </span>
                )}
                {sellerFb != null && sellerFb < 10 && (
                  <span className="text-[10px] text-amber-400 font-semibold">
                    ⚠️ New / low-feedback seller
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Time-left detail row */}
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Clock size={11} className="text-gray-600" />
            {auction.end_time ? (
              <>
                <span>Ends</span>
                <span className="text-gray-300 font-medium">
                  {(() => {
                    const s = String(auction.end_time)
                    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
                    const end = new Date(hasTz ? s : s + 'Z')
                    return end.toLocaleString([], {
                      month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })
                  })()}
                </span>
                <span className={`ml-auto font-mono font-bold ${timeCls}`}>{timeText}</span>
              </>
            ) : (
              <span>End time unavailable</span>
            )}
          </div>

          {/* Action row */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={toggleWatchlist}
              disabled={watchLoading}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-50 ${
                watching
                  ? 'bg-yellow-700/30 text-yellow-300 border border-yellow-700/40 hover:bg-yellow-700/50'
                  : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 border border-gray-700/60'
              }`}
            >
              {watching ? <><BookmarkCheck size={14} /> Watching</> : <><BookmarkPlus size={14} /> Add to watchlist</>}
            </button>
            {ebayHref ? (
              <a
                href={ebayHref}
                target="_blank"
                rel="sponsored noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3 bg-blue-700 hover:bg-blue-600 text-white font-bold rounded-xl text-sm transition-colors"
              >
                View on eBay <ExternalLink size={14} />
              </a>
            ) : (
              <button
                disabled
                className="flex items-center justify-center gap-2 py-3 bg-gray-800 text-gray-600 rounded-xl text-sm font-bold cursor-not-allowed"
              >
                eBay link unavailable
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
