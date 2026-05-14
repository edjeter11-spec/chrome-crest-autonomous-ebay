import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Flag } from 'lucide-react'
import { ebayAffiliateUrl } from '../lib/ebay'
import CardImage from './CardImage'

const API = import.meta.env.VITE_API_URL || ''

const EXCLUDED_PARALLELS = new Set([
  'Base', 'B&W Ray Wave', 'B&W Lazer', 'Floor It', 'Four & More', 'Refractor',
])

// Rarity weights — higher = rarer/better
const RARITY_WEIGHTS = {
  'SuperFractor': 100,
  'Red': 90,
  'Black': 85,
  'Orange': 75,
  'Gold': 65,
  'Vegas at Night': 60,
  'Neon Nations': 55,
  'Helix': 50,
  'Ultrasonic': 50,
  'The Grail': 95,
  'Futuro': 60,
}

function rarityScore(card) {
  const p = card.parallel || ''
  const t = (card.title || '').toLowerCase()
  let score = 0
  for (const [key, val] of Object.entries(RARITY_WEIGHTS)) {
    if (p.includes(key) || t.includes(key.toLowerCase())) {
      score = Math.max(score, val)
    }
  }
  // Autographs
  if (/auto|autograph|signature/i.test(`${p} ${card.title || ''}`)) {
    score = Math.max(score, 70)
  }
  // 1/1 bonus
  if (/1\/1|one of one/i.test(card.title || '')) score += 30
  return score
}

function verdictScore(v) {
  if (v === 'STRONG_BUY') return 50
  if (v === 'GOOD_BUY') return 30
  return 0
}

function isAutograph(card) {
  return /auto|autograph|signature/i.test(`${card.parallel || ''} ${card.title || ''}`)
}

export default function TopPicks() {
  const [auctions, setAuctions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/api/auctions/with-verdicts?limit=500&status=active&buying=auction`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return
        const list = d?.auctions || d || []
        setAuctions(Array.isArray(list) ? list : [])
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const picks = useMemo(() => {
    const filtered = auctions.filter(a => {
      const price = Number(a.current_price || 0)
      const value = Number(a.median_price || a.base_value || 0)
      if (price < 20) return false
      if (value < 20) return false
      const parallel = a.parallel || ''
      if (EXCLUDED_PARALLELS.has(parallel)) return false
      if (/^\s*base\s*$/i.test(parallel)) return false
      // Prefer autos / top hits or strong verdict
      const auto = isAutograph(a)
      const r = rarityScore(a)
      const v = a.verdict
      if (!auto && r < 50 && v !== 'STRONG_BUY' && v !== 'GOOD_BUY') return false
      // If verdict present, must be strong/good
      if (v && v !== 'STRONG_BUY' && v !== 'GOOD_BUY') return false
      return true
    })
    const scored = filtered.map(a => ({
      a,
      score: verdictScore(a.verdict) * 2 + rarityScore(a) + (isAutograph(a) ? 20 : 0),
    }))
    scored.sort((x, y) => y.score - x.score)
    return scored.slice(0, 6).map(x => x.a)
  }, [auctions])

  if (loading) {
    return (
      <div className="mb-6">
        <Heading />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="h-72 bg-gray-900/60 border border-gray-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!picks.length) {
    return (
      <div className="mb-6">
        <Heading />
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 text-center text-sm text-gray-400">
          No premium picks live right now — check back after next scrape.
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <Heading />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {picks.map(a => <PickCard key={a.id || a.ebay_item_id} auction={a} />)}
      </div>
    </div>
  )
}

function Heading() {
  return (
    <div className="mb-3">
      <h2 className="text-lg md:text-xl font-black text-white flex items-center gap-2">
        <Flag size={16} className="text-red-500" /> Top Picks For You
      </h2>
      <p className="text-[11px] text-gray-500 mt-0.5">Premium auto + case hits ≥ $20, curated daily</p>
    </div>
  )
}

function PickCard({ auction: a }) {
  const price = Number(a.current_price || 0)
  // Compare TOTAL cost (price + shipping) to median so a $1 + $5 ship listing
  // isn't falsely flagged "90% below median". See Bug 1 (Hot Snipes audit).
  const total = price + Number(a.shipping_cost || 0)
  const median = Number(a.median_price || a.base_value || 0)
  const pctBelow = median > 0 && total < median ? Math.round(((median - total) / median) * 100) : null
  const img = a.image_url || a.primary_image_url
  const url = a.ebay_url || a.item_web_url || (a.ebay_item_id ? `https://www.ebay.com/itm/${a.ebay_item_id}` : '#')
  const verdict = a.verdict

  return (
    <div className="bg-gray-900/70 border border-gray-800/60 rounded-2xl overflow-hidden hover:border-red-600/50 transition-colors flex flex-col">
      <div className="aspect-[3/4] bg-black/30">
        <CardImage
          src={img}
          alt={a.title || ''}
          driverName={a.driver_name || a.card?.driver_name}
          className="h-full w-full"
          fit="contain"
          imgClassName="p-2"
        />
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {verdict && (
            <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded ${
              verdict === 'STRONG_BUY'
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-600/40'
                : 'bg-cyan-600/30 text-cyan-300 border border-cyan-600/40'
            }`}>
              {verdict.replace('_', ' ')}
            </span>
          )}
          {a.parallel && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 font-semibold">
              {a.parallel}
            </span>
          )}
        </div>
        <div className="text-sm font-black text-white truncate">{a.driver_name || 'Unknown'}</div>
        <div className="flex items-end justify-between mt-auto pt-1">
          <div>
            <div className="text-lg font-black text-emerald-400 tabular-nums">${price.toFixed(0)}</div>
            {median > 0 && (
              <div className="text-[10px] text-gray-500">
                median ${median.toFixed(0)}
                {pctBelow ? <span className="text-emerald-400 font-bold"> · {pctBelow}% below</span> : null}
              </div>
            )}
          </div>
        </div>
        <a
          href={ebayAffiliateUrl(url)}
          target="_blank"
          rel="noopener sponsored"
          className="mt-2 bg-red-600 hover:bg-red-500 text-white text-xs font-black px-3 py-2 rounded-lg flex items-center justify-center gap-1.5"
        >
          View on eBay <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}
