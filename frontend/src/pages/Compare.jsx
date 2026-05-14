import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Heart, TrendingUp, TrendingDown, Award, Scale, Save, Link2, Check } from 'lucide-react'
import { DRIVERS_F1, DRIVERS_F2, DRIVERS_F3, DRIVERS_LEGENDS } from '../lib/drivers'
import { TOP_PARALLELS } from './CardPage'
import { ALL_PARALLELS } from '../lib/parallels'
import CardImagePlaceholder from '../components/CardImagePlaceholder'

const API = import.meta.env.VITE_API_URL || ''
const ALL_DRIVERS = [...DRIVERS_F1, ...DRIVERS_F2, ...DRIVERS_F3, ...DRIVERS_LEGENDS]

function kebab(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseSlug(slug) {
  const clean = kebab(slug)
  const sorted = [...ALL_DRIVERS].sort((a, b) => b.length - a.length)
  for (const d of sorted) {
    const dk = kebab(d)
    if (clean === dk || clean.startsWith(dk + '-')) {
      const rest = clean.slice(dk.length).replace(/^-+/, '')
      // Try ALL_PARALLELS (broader) first, then TOP_PARALLELS — longest match wins.
      const pool = [...new Set([...(ALL_PARALLELS || []), ...TOP_PARALLELS])]
        .sort((a, b) => kebab(b).length - kebab(a).length)
      for (const p of pool) {
        const pk = kebab(p)
        if (rest === pk) return { driver: d, parallel: p }
      }
      for (const p of pool) {
        const pk = kebab(p)
        if (rest.startsWith(pk)) return { driver: d, parallel: p }
      }
      // No registered parallel matched — title-case the remainder so we at
      // least round-trip what the URL said rather than silently dropping it.
      const pretty = rest.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ').trim()
      return { driver: d, parallel: pretty || 'Refractor' }
    }
  }
  return { driver: null, parallel: null }
}

function toSlug(driver, parallel) {
  return `${kebab(driver)}-${kebab(parallel)}`
}

function MomentumChip({ delta }) {
  if (delta == null) return <span className="text-gray-500 text-xs font-semibold">—</span>
  const up = delta > 0
  const flat = Math.abs(delta) < 1
  const color = flat ? 'text-gray-400' : up ? 'text-emerald-400' : 'text-red-400'
  const arrow = flat ? '→' : up ? '↑' : '↓'
  return <span className={`font-bold ${color} text-xs`}>{arrow} {flat ? 'flat' : `${Math.abs(delta).toFixed(0)}%`}</span>
}

function ScarcityBadge({ tier }) {
  if (!tier || tier === '-') return null
  const color = tier === 'S' ? 'bg-yellow-500 text-black' :
                tier === 'A' ? 'bg-blue-600 text-white' :
                tier === 'B' ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300'
  return <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${color}`}>Tier {tier}</span>
}

function Picker({ label, driver, parallel, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="text-[10px] uppercase font-bold text-gray-500">{label} Driver</label>
        <input
          list={`drivers-${label}`}
          value={driver}
          onChange={e => onChange(e.target.value, parallel)}
          className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700"
          placeholder="e.g. Max Verstappen"
        />
        <datalist id={`drivers-${label}`}>
          {ALL_DRIVERS.map(d => <option key={d} value={d} />)}
        </datalist>
      </div>
      <div>
        <label className="text-[10px] uppercase font-bold text-gray-500">{label} Parallel</label>
        <select
          value={parallel}
          onChange={e => onChange(driver, e.target.value)}
          className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700"
        >
          {TOP_PARALLELS.map(p => <option key={p}>{p}</option>)}
        </select>
      </div>
    </div>
  )
}

function useCardData(driver, parallel) {
  const [data, setData] = useState({ median: null, sales: [], listings: [], momentum: null })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!driver || !parallel) { setData({ median: null, sales: [], listings: [], momentum: null }); return }
    let mounted = true
    setLoading(true)
    const qs = new URLSearchParams({ driver, parallel, year: '2025' })
    Promise.all([
      fetch(`${API}/api/sales/median?${qs}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/sales?${qs}&limit=50`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/auctions?driver=${encodeURIComponent(driver)}&limit=100`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/sales/momentum?driver=${encodeURIComponent(driver)}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([m, s, a, mo]) => {
      if (!mounted) return
      const matched = (a?.auctions || []).filter(x =>
        (x.card?.parallel || '').toLowerCase() === (parallel || '').toLowerCase() ||
        (x.title || '').toLowerCase().includes((parallel || '').toLowerCase())
      )
      setData({
        median: m,
        sales: s?.sales || [],
        listings: matched,
        momentum: mo?.momentum || null,
      })
      setLoading(false)
    })
    return () => { mounted = false }
  }, [driver, parallel])

  return { data, loading }
}

function Column({ side, driver, parallel, data, loading }) {
  // Track image-load failure so we can swap in the F1-themed placeholder instead
  // of leaving an empty grey square (the previous behavior — `display:none` on
  // the <img> left the rounded `bg-gray-900` div visually empty).
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [driver])
  const med = data.median?.median_total
  const nComps = data.median?.n || 0
  const highest = data.median?.max_total
  const salesLast30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000
    return (data.sales || []).filter(s => s.sale_date && new Date(s.sale_date).getTime() >= cutoff).length
  }, [data.sales])
  const activeBest = (data.listings || []).reduce((min, a) => {
    const t = (a.current_price || 0) + (a.shipping_cost || 0)
    return (t > 0 && (!min || t < min)) ? t : min
  }, null)
  const deltaVsMedian = (activeBest && med) ? (activeBest - med) / med * 100 : null

  const addToWishlist = async () => {
    try {
      await fetch(`${API}/api/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver, parallel, grade: 'Raw', max_price: med ? Math.round(med * 0.8) : null }),
      })
      alert('Added to watchlist')
    } catch (e) {
      alert('Failed: ' + (e.message || 'error'))
    }
  }

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-start gap-3">
        {driver && !imgFailed ? (
          <img
            src={`${API}/api/drivers/photo?name=${encodeURIComponent(driver)}`}
            alt={driver}
            className="w-16 h-16 rounded-xl object-cover border border-gray-800 bg-gray-900"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-800 shrink-0">
            <CardImagePlaceholder driverName={driver || '—'} labelClassName="text-[10px] font-black tracking-widest" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Side {side}</div>
          <h2 className="text-lg font-black text-white truncate">{driver || '—'}</h2>
          <div className="text-xs text-red-400 font-bold">{parallel || '—'}</div>
        </div>
      </div>

      {loading ? (
        <div className="h-40 animate-pulse bg-gray-800/40 rounded-lg" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase text-gray-500 font-bold">Median (90d)</div>
              <div className="text-2xl font-black text-green-400">{med ? `$${med.toFixed(0)}` : '—'}</div>
              <div className="text-[10px] text-gray-500">{nComps} sales</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-gray-500 font-bold">Momentum 7d</div>
              <div className="text-xl"><MomentumChip delta={data.momentum?.delta_pct} /></div>
              <div className="text-[10px] text-gray-500">{data.momentum?.recent_n || 0} recent</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-gray-500 font-bold">Sales / 30d</div>
              <div className="text-xl font-bold text-white">{salesLast30}</div>
              <div className="text-[10px] text-gray-500">velocity</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-gray-500 font-bold">Highest ever</div>
              <div className="text-xl font-bold text-yellow-400">{highest ? `$${highest.toFixed(0)}` : '—'}</div>
              <div className="text-[10px] text-gray-500">90d peak</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-gray-500 font-bold">Best active</div>
              <div className="text-xl font-bold text-white">{activeBest ? `$${activeBest.toFixed(0)}` : '—'}</div>
              <div className={`text-[10px] ${deltaVsMedian != null && deltaVsMedian < 0 ? 'text-green-400' : 'text-gray-500'}`}>
                {deltaVsMedian != null ? `${deltaVsMedian > 0 ? '+' : ''}${deltaVsMedian.toFixed(0)}% vs median` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-gray-500 font-bold">Scarcity</div>
              <div className="mt-1.5"><ScarcityBadge tier="A" /></div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={addToWishlist} className="flex-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs font-bold rounded-lg border border-red-800/40 flex items-center justify-center gap-1.5">
              <Heart size={12} /> Add to watchlist
            </button>
            {driver && parallel && (
              <Link to={`/card/${toSlug(driver, parallel)}`} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg">
                Details
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function Compare() {
  const [params, setParams] = useSearchParams()
  // Support both shareable `?cards=slug1,slug2` and legacy `?a=&b=` formats.
  const cardsParam = params.get('cards')
  const cardSlugs = cardsParam ? cardsParam.split(',').map(s => s.trim()).filter(Boolean) : []
  const aSlug = cardSlugs[0] || params.get('a') || 'lewis-hamilton-refractor'
  const bSlug = cardSlugs[1] || params.get('b') || 'max-verstappen-refractor'
  const a = useMemo(() => parseSlug(aSlug), [aSlug])
  const b = useMemo(() => parseSlug(bSlug), [bSlug])

  const [aDriver, setADriver] = useState(a.driver || '')
  const [aParallel, setAParallel] = useState(a.parallel || 'Refractor')
  const [bDriver, setBDriver] = useState(b.driver || '')
  const [bParallel, setBParallel] = useState(b.parallel || 'Refractor')
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    setParams({ a: toSlug(aDriver, aParallel), b: toSlug(bDriver, bParallel) }, { replace: true })
  }, [aDriver, aParallel, bDriver, bParallel])

  const saveComparison = () => {
    const cards = [toSlug(aDriver, aParallel), toSlug(bDriver, bParallel)].filter(Boolean).join(',')
    setParams({ cards }, { replace: false })
    setSaved(true)
    setToast('Comparison saved!')
    setTimeout(() => setToast(''), 2000)
    setTimeout(() => setSaved(false), 2000)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setToast('Link copied!')
      setTimeout(() => setToast(''), 2000)
    } catch {
      setToast('Copy failed')
      setTimeout(() => setToast(''), 2000)
    }
  }

  useEffect(() => {
    document.title = `Compare ${aDriver || ''} ${aParallel || ''} vs ${bDriver || ''} ${bParallel || ''} · F1 Card Vault`
  }, [aDriver, aParallel, bDriver, bParallel])

  const { data: aData, loading: aLoad } = useCardData(aDriver, aParallel)
  const { data: bData, loading: bLoad } = useCardData(bDriver, bParallel)

  // Better-value heuristic: price-to-median ratio (lower is better),
  // weighted by momentum and sales volume.
  const betterValue = useMemo(() => {
    const score = (d) => {
      const med = d.median?.median_total
      const best = (d.listings || []).reduce((m, a) => {
        const t = (a.current_price || 0) + (a.shipping_cost || 0)
        return (t > 0 && (!m || t < m)) ? t : m
      }, null)
      if (!med || !best) return null
      const ratio = best / med
      const mom = d.momentum?.delta_pct ?? 0
      const vol = d.median?.n || 0
      // lower ratio = better. add momentum boost, volume modest boost.
      return -ratio + mom / 200 + Math.min(vol, 30) / 200
    }
    const sa = score(aData)
    const sb = score(bData)
    if (sa == null && sb == null) return null
    if (sa == null) return 'B'
    if (sb == null) return 'A'
    return sa > sb ? 'A' : 'B'
  }, [aData, bData])

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title flex items-center gap-2"><Scale size={20} /> Compare Cards</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={saveComparison}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg flex items-center gap-1.5"
          >
            {saved ? <Check size={13} className="text-green-400" /> : <Save size={13} />}
            {saved ? 'Saved' : 'Save comparison'}
          </button>
          <button
            onClick={copyLink}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg flex items-center gap-1.5"
          >
            <Link2 size={13} /> Copy link
          </button>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 border border-gray-700 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div className="panel p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Picker label="A" driver={aDriver} parallel={aParallel}
          onChange={(d, p) => { setADriver(d); setAParallel(p) }} />
        <Picker label="B" driver={bDriver} parallel={bParallel}
          onChange={(d, p) => { setBDriver(d); setBParallel(p) }} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Column side="A" driver={aDriver} parallel={aParallel} data={aData} loading={aLoad} />
        <Column side="B" driver={bDriver} parallel={bParallel} data={bData} loading={bLoad} />
      </div>

      {betterValue && (
        <div className="panel p-4 flex items-center gap-3 border-green-800/40 bg-green-900/10">
          <Award className="text-green-400 shrink-0" size={22} />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-green-400 font-black">Better value</div>
            <div className="text-sm text-white font-bold">
              Side {betterValue}: {(betterValue === 'A' ? aDriver : bDriver)} {(betterValue === 'A' ? aParallel : bParallel)}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Based on lower price-to-median ratio, stronger momentum, and sales volume.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
