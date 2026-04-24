import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, ExternalLink, Tag, Award, Users, ArrowLeft, Share2, BarChart2 } from 'lucide-react'
import { DRIVERS_F1, DRIVERS_F2, DRIVERS_F3, DRIVERS_LEGENDS } from '../lib/drivers'
import { ebayAffiliateUrl } from '../lib/ebay'
import { ShareMenu } from '../components/AuctionCard'
import Breadcrumbs from '../components/Breadcrumbs'
import RawToGradedROI from '../components/RawToGradedROI'

const API = import.meta.env.VITE_API_URL || ''
const SITE = 'https://www.f1cardvault.com'

const ALL_DRIVERS = [...DRIVERS_F1, ...DRIVERS_F2, ...DRIVERS_F3, ...DRIVERS_LEGENDS]

// Top parallels that power slug resolution and sitemap generation.
export const TOP_PARALLELS = [
  'Refractor', 'Prism Refractor', 'Aqua /199', 'Blue /150',
  'Green /99', 'Gold /50', 'Orange /25', 'Autograph',
]

function kebab(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseSlug(slug) {
  const clean = kebab(slug)
  // Longest-match driver first so two-word names like 'max-verstappen' beat 'max'
  const sorted = [...ALL_DRIVERS].sort((a, b) => b.length - a.length)
  for (const d of sorted) {
    const dk = kebab(d)
    if (clean === dk || clean.startsWith(dk + '-')) {
      const rest = clean.slice(dk.length).replace(/^-+/, '')
      // Match parallel by trying longest first too
      const sortedP = [...TOP_PARALLELS].sort((a, b) => b.length - a.length)
      for (const p of sortedP) {
        const pk = kebab(p)
        if (rest === pk || rest.startsWith(pk)) {
          return { driver: d, parallel: p }
        }
      }
      return { driver: d, parallel: rest.split('-').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ') }
    }
  }
  return { driver: null, parallel: null }
}

function getPsaPopUrl(driver, parallel, grade) {
  // PSA population report URL format: https://www.psacard.com/pop
  // Query params: card_name, parallel (optional), grade (optional)
  const params = new URLSearchParams()
  params.set('card_name', `${driver} 2025 Topps Chrome`)
  if (parallel && parallel !== 'Base') params.set('parallel', parallel)
  if (grade && grade !== 'Raw') params.set('grade', grade)
  return `https://www.psacard.com/pop?${params.toString()}`
}

function upsertMeta(selector, attr, name, content) {
  let m = document.querySelector(selector)
  if (!m) {
    m = document.createElement('meta')
    m.setAttribute(attr, name)
    document.head.appendChild(m)
  }
  m.setAttribute('content', content)
}

function useProductJsonLd({ driver, parallel, image, medianPrice, slug }) {
  useEffect(() => {
    if (!driver || !parallel) return
    const id = 'ld-product-card'
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${driver} ${parallel} — 2025 Topps Chrome Formula 1`,
      image: image || `${SITE}/og/card/${slug || ''}`,
      description: `${driver} ${parallel} card`,
      brand: { '@type': 'Brand', name: 'Topps Chrome Formula 1' },
      offers: {
        '@type': 'Offer',
        price: medianPrice != null ? Number(medianPrice).toFixed(2) : '0.00',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
    }
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('script')
      el.type = 'application/ld+json'
      el.id = id
      document.head.appendChild(el)
    }
    el.textContent = JSON.stringify(data)
    return () => {
      const existing = document.getElementById(id)
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
    }
  }, [driver, parallel, image, medianPrice, slug])
}

function useSeo({ title, description, ogTitle, ogDescription, ogImage }) {
  useEffect(() => {
    if (title) document.title = title
    if (description) {
      upsertMeta('meta[name="description"]', 'name', 'description', description)
    }
    // Canonical
    let c = document.querySelector('link[rel="canonical"]')
    if (!c) {
      c = document.createElement('link')
      c.setAttribute('rel', 'canonical')
      document.head.appendChild(c)
    }
    c.setAttribute('href', window.location.href)

    // Per-card OG / Twitter tags
    if (ogTitle) {
      upsertMeta('meta[property="og:title"]', 'property', 'og:title', ogTitle)
      upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', ogTitle)
    }
    if (ogDescription) {
      upsertMeta('meta[property="og:description"]', 'property', 'og:description', ogDescription)
      upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', ogDescription)
    }
    if (ogImage) {
      upsertMeta('meta[property="og:image"]', 'property', 'og:image', ogImage)
      upsertMeta('meta[name="twitter:image"]', 'name', 'twitter:image', ogImage)
      upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
    }
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', window.location.href)
  }, [title, description, ogTitle, ogDescription, ogImage])
}

function ScarcityBadge({ tier }) {
  if (!tier || tier === '-') return null
  const color = tier === 'S' ? 'bg-yellow-500 text-black' :
                tier === 'A' ? 'bg-blue-600 text-white' :
                tier === 'B' ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300'
  return <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${color}`}>Tier {tier}</span>
}

function VerdictBadge({ verdict }) {
  if (!verdict) return null
  const map = {
    STRONG_BUY: 'bg-emerald-500 text-black',
    GOOD_BUY: 'bg-green-700 text-white',
    FAIR: 'bg-gray-700 text-gray-200',
    OVERPRICED: 'bg-orange-700 text-white',
    PASS: 'bg-red-700 text-white',
  }
  return <span className={`text-[11px] font-black px-2 py-1 rounded-md uppercase tracking-wide ${map[verdict] || 'bg-gray-700 text-gray-300'}`}>{verdict.replace('_', ' ')}</span>
}

export default function CardPage() {
  const { slug } = useParams()
  const { driver, parallel } = useMemo(() => parseSlug(slug || ''), [slug])

  const [median, setMedian] = useState(null)
  const [recent, setRecent] = useState([])
  const [listings, setListings] = useState([])
  const [similar, setSimilar] = useState([])
  const [loading, setLoading] = useState(true)

  useSeo({
    title: driver && parallel
      ? `2025 Topps Chrome F1 ${driver} ${parallel} — Prices, Comps & Auctions | F1 Card Vault`
      : 'Card — F1 Card Vault',
    description: driver && parallel
      ? `Live tracker for the 2025 Topps Chrome Formula 1 ${driver} ${parallel}. ${median?.n || 0} recent sales, ${median?.median_total ? `$${median.median_total.toFixed(0)} median` : 'price data'}, PSA pop, and active eBay auctions. Free, always updated.`
      : 'Live 2025 Topps Chrome Formula 1 card prices.',
    ogTitle: driver && parallel
      ? `2025 Topps Chrome F1 ${driver} ${parallel} — Prices, Comps & Auctions`
      : 'F1 Card Vault',
    ogDescription: driver && parallel
      ? `Live tracker for the 2025 Topps Chrome Formula 1 ${driver} ${parallel}. ${median?.n || 0} recent sales, ${median?.median_total ? `$${median.median_total.toFixed(0)} median` : 'price data'}, PSA pop, and active eBay auctions.`
      : 'Live eBay prices and median comps for 2025 Topps Chrome F1.',
    ogImage: slug ? `${SITE}/og/card/${slug}` : undefined,
  })

  useProductJsonLd({
    driver,
    parallel,
    image: slug ? `${SITE}/og/card/${slug}` : undefined,
    medianPrice: median?.median_total,
    slug,
  })

  useEffect(() => {
    if (!driver || !parallel) { setLoading(false); return }
    let mounted = true
    setLoading(true)
    const qs = new URLSearchParams({ driver, parallel, year: '2025' })
    Promise.all([
      fetch(`${API}/api/sales/median?${qs}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/sales?${qs}&limit=20`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/auctions?driver=${encodeURIComponent(driver)}&limit=100`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([m, s, a]) => {
      if (!mounted) return
      setMedian(m)
      setRecent(s?.sales || [])
      // Filter client-side to this parallel
      const all = a?.auctions || []
      const pl = (parallel || '').toLowerCase()
      const matched = all.filter(x =>
        (x.card?.parallel || '').toLowerCase() === pl ||
        (x.title || '').toLowerCase().includes(pl)
      )
      setListings(matched.slice(0, 6))
      setLoading(false)
    })
    return () => { mounted = false }
  }, [driver, parallel])

  // Similar cards — same driver, different parallels, sorted by sale price
  useEffect(() => {
    if (!driver) { setSimilar([]); return }
    let mounted = true
    const qs = new URLSearchParams({ driver, limit: '20', year: '2025' })
    fetch(`${API}/api/sales?${qs}`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => {
        if (!mounted) return
        const all = data?.sales || []
        const plLower = (parallel || '').toLowerCase()
        // Filter to different parallels, dedupe by parallel keeping the highest sale.
        const byParallel = new Map()
        for (const s of all) {
          const p = (s.parallel || '').trim()
          if (!p) continue
          if (p.toLowerCase() === plLower) continue
          const prev = byParallel.get(p)
          if (!prev || (s.sale_price || 0) > (prev.sale_price || 0)) {
            byParallel.set(p, s)
          }
        }
        const arr = Array.from(byParallel.values())
          .sort((a, b) => (b.sale_price || 0) - (a.sale_price || 0))
          .slice(0, 3)
        setSimilar(arr)
      })
    return () => { mounted = false }
  }, [driver, parallel])

  if (!driver || !parallel) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 p-4">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Card' }]} />
        <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
        <div className="panel p-8 text-center">
          <h1 className="text-xl font-black text-white mb-2">Card not found</h1>
          <p className="text-gray-400 text-sm">Couldn't resolve slug "{slug}".</p>
        </div>
      </div>
    )
  }

  const medianPrice = median?.median_total
  const nComps = median?.n || 0
  const verdict = null

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Card' }]} />
      <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1 w-fit"><ArrowLeft size={12} /> Home</Link>

      {/* Hero */}
      <div className="panel p-5 md:p-6 flex flex-col md:flex-row gap-5 items-start">
        <img
          src={`${API}/api/drivers/photo?name=${encodeURIComponent(driver)}`}
          alt={driver}
          className="w-28 h-28 md:w-36 md:h-36 rounded-2xl object-cover border-2 border-gray-800 bg-gray-900"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <ScarcityBadge tier="A" />
            <VerdictBadge verdict={verdict} />
          </div>
          <h1 className="text-2xl md:text-4xl font-black text-white leading-tight">2025 Topps Chrome F1 {driver} {parallel}</h1>
          <p className="text-sm text-gray-400 mt-0.5">2025 Topps Chrome F1 · <span className="text-red-400 font-bold">{parallel}</span></p>

          <div className="mt-4 flex flex-wrap items-baseline gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Currently</div>
              <div className="text-3xl md:text-4xl font-black text-green-400 leading-none">
                {medianPrice ? `$${medianPrice.toFixed(0)}` : <span className="text-gray-600 text-xl">no data</span>}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {nComps > 0 ? `median across ${nComps} sales (90d)` : 'not enough sales'}
                {median?.low_confidence && nComps > 0 && <span className="text-yellow-500"> · low confidence</span>}
              </div>
            </div>
            {median?.max_total && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Highest</div>
                <div className="text-xl font-bold text-yellow-400">${median.max_total.toFixed(0)}</div>
              </div>
            )}
            {median?.min_total && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Lowest</div>
                <div className="text-xl font-bold text-gray-300">${median.min_total.toFixed(0)}</div>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2 flex-wrap items-center">
            <Link to={`/compare?a=${slug}`} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg">Compare</Link>
            <Link to={`/drivers?name=${encodeURIComponent(driver)}`} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg">Driver page</Link>
            <Link to={`/sales?driver=${encodeURIComponent(driver)}&parallel=${encodeURIComponent(parallel)}`} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg">All sales</Link>
            <ShareMenu
              title={`${driver} ${parallel}`}
              url={window.location.href}
              children={{ className: 'ml-auto p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors', icon: <Share2 size={14} /> }}
            />
          </div>
        </div>
      </div>

      {/* Similar cards — same driver, different parallels */}
      {similar.length > 0 && (
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-white text-sm flex items-center gap-2">
              <Users size={14} className="text-cyan-400" /> Similar cards
              <span className="text-[11px] text-gray-500 font-normal">other {driver} parallels</span>
            </h2>
            <Link
              to={`/drivers?name=${encodeURIComponent(driver)}`}
              className="text-[11px] text-cyan-400 hover:underline"
            >View all →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {similar.map(s => {
              const pSlug = `${kebab(driver)}-${kebab(s.parallel || '')}`
              return (
                <Link
                  key={s.id}
                  to={`/card/${pSlug}`}
                  className="bg-gray-800/60 hover:bg-gray-800 rounded-xl p-3 border border-gray-700/40 hover:border-cyan-700/50 transition-colors flex gap-3 items-start"
                >
                  {s.image_url && (
                    <img
                      src={s.image_url}
                      alt=""
                      className="w-12 h-16 rounded object-cover bg-gray-900 shrink-0"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white font-semibold line-clamp-2 leading-tight">
                      {s.title || `${driver} ${s.parallel}`}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 font-semibold">
                        {s.parallel}
                      </span>
                      {s.grade && s.grade !== 'Raw' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 font-bold">
                          {s.grade}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-[10px] text-gray-500">Last sale</div>
                    <div className="text-base font-black text-green-400 leading-none">
                      ${(s.sale_price || 0).toFixed(0)}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Raw → PSA 10 ROI calculator */}
      <RawToGradedROI
        driver={driver}
        parallel={parallel}
        isRookie={/rookie|rc\b/i.test(parallel || '')}
        isAuto={(parallel || '').toLowerCase().includes('auto')}
        rawPrice={medianPrice}
      />

      {/* Live listings */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><Tag size={14} className="text-red-400" /> Active Auctions</h2>
          <span className="text-[11px] text-gray-500">{listings.length} shown</span>
        </div>
        {loading ? (
          <div className="h-32 animate-pulse bg-gray-800/40 rounded-lg" />
        ) : listings.length === 0 ? (
          <p className="text-xs text-gray-500 italic py-4">No active listings right now — check back later.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {listings.map(a => {
              const total = (a.current_price || 0) + (a.shipping_cost || 0)
              const pctOfMed = medianPrice ? total / medianPrice : null
              const isDeal = pctOfMed != null && pctOfMed <= 0.8
              return (
                <a key={a.id} href={ebayAffiliateUrl(a.ebay_url)} target="_blank" rel="sponsored noopener"
                  className={`bg-gray-800/60 hover:bg-gray-800 rounded-xl p-3 border transition-colors ${isDeal ? 'border-green-700/50' : 'border-gray-700/40'}`}>
                  <div className="flex gap-3">
                    {a.image_url && <img src={a.image_url} alt="" className="w-14 h-16 rounded object-cover bg-gray-900" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-white font-semibold line-clamp-2 leading-tight">{a.title}</div>
                      <div className="flex items-baseline gap-2 mt-1.5">
                        <span className="text-base font-black text-green-400">${(a.current_price || 0).toFixed(0)}</span>
                        {pctOfMed != null && (
                          <span className={`text-[10px] font-bold ${isDeal ? 'text-green-400' : 'text-gray-500'}`}>
                            {(pctOfMed * 100).toFixed(0)}% of median
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-1">
                        <ExternalLink size={9} /> view on eBay
                      </div>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent sales */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-white text-sm flex items-center gap-2"><TrendingUp size={14} className="text-green-400" /> Recent Sold Comps</h2>
          <span className="text-[11px] text-gray-500">last {recent.length}</span>
        </div>
        {loading ? (
          <div className="h-32 animate-pulse bg-gray-800/40 rounded-lg" />
        ) : recent.length === 0 ? (
          <p className="text-xs text-gray-500 italic py-4">No recent sales on record for this combo yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Grade</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Total</th>
                  <th>Type</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map(s => (
                  <tr key={s.id}>
                    <td className="text-gray-400 text-xs">{s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}</td>
                    <td className="text-xs">
                      {s.grade ? (
                        <div className="flex items-center gap-1.5">
                          <span>{s.grade}</span>
                          {s.grade !== 'Raw' && (
                            <a href={getPsaPopUrl(driver, parallel, s.grade)} target="_blank" rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 transition-colors" title="View PSA population report">
                              <BarChart2 size={11} />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-600">Raw</span>
                      )}
                    </td>
                    <td className="text-right text-white font-semibold">${(s.sale_price || 0).toFixed(0)}</td>
                    <td className="text-right text-green-400 font-semibold">${(s.total_cost || 0).toFixed(0)}</td>
                    <td className="text-[10px] text-gray-500">{s.is_auction ? 'auction' : 'bin'}</td>
                    <td className="text-right">
                      {s.ebay_url && (
                        <a href={ebayAffiliateUrl(s.ebay_url)} target="_blank" rel="sponsored noopener" className="text-gray-500 hover:text-white">
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
