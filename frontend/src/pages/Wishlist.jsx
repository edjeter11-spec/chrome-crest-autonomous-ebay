import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Heart, Trash2, Zap, Eye, Plus, Clock, Tag, Gavel, ExternalLink,
  AlertCircle, X, Share2
} from 'lucide-react'
import { swrFetch } from '../lib/cache'
import { DRIVERS_F1, DRIVERS_F2, DRIVERS_F3, DRIVERS_LEGENDS } from '../lib/drivers'
import ShareWatchlistModal from '../components/ShareWatchlistModal'
import SmartRules from '../components/SmartRules'
import { ebayAffiliateUrl } from '../lib/ebay'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Very High', 'Must Have']
const PRIORITY_STYLES = [
  '',
  'text-gray-400 bg-gray-800/60',
  'text-blue-400 bg-blue-900/20',
  'text-yellow-400 bg-yellow-900/20',
  'text-orange-400 bg-orange-900/20',
  'text-red-400 bg-red-900/20',
]

const PARALLELS = [
  'Base', 'Refractor', 'Prism Refractor', 'Autograph',
  'SuperFractor', 'Red /5', 'Black /10', 'Orange /25', 'Gold /50', 'F1 75th /75',
  'Green /99', 'Blue /150', 'Aqua /199', 'Pink /250', 'Teal /299',
  'Vegas at Night', 'Neon Nations', 'Floor It', 'Speed Wheels', 'Top Speed',
  'Helix', 'Ultrasonic', 'The Grail', 'Futuro', 'Diamond 75th',
]
const GRADES = ['Raw', 'PSA 10', 'PSA 9', 'PSA 8', 'BGS 10', 'BGS 9.5', 'BGS 9', 'SGC 10', 'SGC 9.5']
const ALL_DRIVERS = [...DRIVERS_F1, ...DRIVERS_F2, ...DRIVERS_F3, ...DRIVERS_LEGENDS].sort()

function timeLeft(seconds) {
  if (!seconds || seconds <= 0) return { text: 'ENDED', cls: 'text-gray-500' }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    return { text: `${m}m`, cls: 'text-red-400 font-bold' }
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    return { text: `${h}h`, cls: 'text-orange-400' }
  }
  return { text: `${Math.floor(seconds / 86400)}d`, cls: 'text-gray-400' }
}

export default function Watchlist() {
  const navigate = useNavigate()
  const [watching, setWatching] = useState([])
  const [wishlist, setWishlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [activeAuctions, setActiveAuctions] = useState([])

  const load = useCallback(() => {
    swrFetch(`${API}/api/auctions/watchlist/all`,
      d => setWatching(d.auctions || d || []))
    swrFetch(`${API}/api/wishlist`,
      d => { setWishlist(d.items || d || []); setLoading(false) })
    swrFetch(`${API}/api/auctions?limit=500&status=active`,
      d => setActiveAuctions(d.auctions || []))
  }, [])

  useEffect(() => { load() }, [load])

  // Match each wishlist item against live auctions: same driver + parallel,
  // current_price <= max_price (incl. shipping)
  const matchesFor = (item) => {
    if (!item.card) return []
    const drv = (item.card.driver_name || '').toLowerCase()
    const par = (item.card.parallel || '').toLowerCase()
    const max = item.max_price || Infinity
    return activeAuctions.filter(a => {
      const aDrv = (a.card?.driver_name || '').toLowerCase()
      const aPar = (a.card?.parallel || '').toLowerCase()
      const total = (a.current_price || 0) + (a.shipping_cost || 0)
      return aDrv === drv && aPar === par && total <= max
    }).slice(0, 3)
  }

  const releaseAuction = async (id) => {
    await fetch(`${API}/api/auctions/${id}/watch`, { method: 'POST' })
    setWatching(prev => prev.filter(a => a.id !== id))
  }

  const removeWishItem = async (id) => {
    await fetch(`${API}/api/wishlist/${id}`, { method: 'DELETE' })
    setWishlist(prev => prev.filter(i => i.id !== id))
  }

  const toggleAutoSnipe = async (id, current) => {
    await fetch(`${API}/api/wishlist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_snipe: !current })
    })
    setWishlist(prev => prev.map(i => i.id === id ? { ...i, auto_snipe: !current } : i))
  }

  const totalWatched = watching.length
  const totalWish = wishlist.length
  const totalMatches = useMemo(
    () => wishlist.reduce((sum, item) => sum + matchesFor(item).length, 0),
    [wishlist, activeAuctions]
  )

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-1 h-7 bg-yellow-500 rounded-full shrink-0" />
          <h1 className="text-2xl font-black text-white tracking-tight">Watchlist</h1>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-gray-800 text-gray-300 border border-gray-700/50">
            {totalWatched} watching · {totalWish} wishlist · {totalMatches} matching
          </span>
          <button
            onClick={() => setShowShare(true)}
            className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-600/40 text-blue-300 text-xs font-bold hover:bg-blue-600/25 flex items-center gap-1.5"
          >
            <Share2 size={11} /> Share
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2 ml-4">
          <span className="text-gray-400">Watching</span> = specific live auctions you're tracking ·{' '}
          <span className="text-gray-400">Wishlist</span> = cards you want, with max price + auto-match
        </p>
      </div>

      {showShare && <ShareWatchlistModal onClose={() => setShowShare(false)} />}

      {/* SECTION 1 — Watching live auctions */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Eye size={14} className="text-yellow-400" />
          <h2 className="text-sm font-black uppercase tracking-wider text-gray-300">Watching Now</h2>
          <span className="text-xs text-gray-500">({totalWatched})</span>
        </div>
        {watching.length === 0 ? (
          <div className="bg-gray-900/40 border border-gray-800/60 rounded-2xl py-10 text-center">
            <Eye size={24} className="mx-auto mb-2 text-gray-700" />
            <p className="text-sm text-gray-500">Not watching any auctions</p>
            <p className="text-xs text-gray-700 mt-1">Click "Watch" on any listing in Live Auctions or Buy It Now</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {watching.map(a => {
              const tl = timeLeft(a.time_left || 0)
              const total = (a.current_price || 0) + (a.shipping_cost || 0)
              return (
                <div key={a.id} className="bg-gray-900/70 border border-gray-800/60 rounded-2xl p-3 flex gap-3 items-start">
                  <div className="w-14 h-20 rounded-lg bg-gray-800 overflow-hidden shrink-0">
                    {a.image_url
                      ? <img src={a.image_url.includes('i.ebayimg.com') ? a.image_url : `${API}/api/proxy/image?url=${encodeURIComponent(a.image_url)}`}
                             alt="" className="w-full h-full object-cover" onError={e => e.target.style.display='none'} />
                      : <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">🏎</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400 line-clamp-2 leading-snug">{a.title}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-base font-black text-emerald-400">${total.toFixed(2)}</span>
                      {a.shipping_cost > 0 && <span className="text-[10px] text-gray-600">+${a.shipping_cost.toFixed(2)} ship</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock size={10} className="text-gray-600" />
                      <span className={`text-xs ${tl.cls}`}>{tl.text}</span>
                      {a.bid_count > 0 && <span className="text-xs text-gray-500">· {a.bid_count} bids</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <a href={ebayAffiliateUrl(a.ebay_url)} target="_blank" rel="sponsored noopener"
                       className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                      <ExternalLink size={11} />
                    </a>
                    <button onClick={() => releaseAuction(a.id)} title="Stop watching"
                            className="p-1.5 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition-colors">
                      <X size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* SECTION 2 — Wishlist */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Heart size={14} className="text-pink-400" />
            <h2 className="text-sm font-black uppercase tracking-wider text-gray-300">Wishlist</h2>
            <span className="text-xs text-gray-500">({totalWish})</span>
          </div>
          <button onClick={() => setShowAdd(s => !s)}
                  className="px-3 py-1.5 rounded-lg bg-pink-600/15 border border-pink-600/40 text-pink-300 text-xs font-bold hover:bg-pink-600/25 flex items-center gap-1.5">
            <Plus size={11} /> Add card
          </button>
        </div>

        {showAdd && <AddWishlistForm onClose={() => setShowAdd(false)} onAdded={load} />}

        {loading ? (
          <div className="space-y-2">
            {Array(3).fill(0).map((_, i) => <div key={i} className="h-20 bg-gray-900/40 rounded-2xl animate-pulse" />)}
          </div>
        ) : wishlist.length === 0 ? (
          <div className="bg-gray-900/40 border border-gray-800/60 rounded-2xl py-10 text-center">
            <Heart size={24} className="mx-auto mb-2 text-gray-700" />
            <p className="text-sm text-gray-500">No cards on your wishlist yet</p>
            <p className="text-xs text-gray-700 mt-1">Add a card type to auto-match against live listings</p>
          </div>
        ) : (
          <div className="space-y-3">
            {wishlist.map(item => {
              const matches = matchesFor(item)
              return (
                <div key={item.id} className="bg-gray-900/70 border border-gray-800/60 rounded-2xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-16 rounded-lg flex items-center justify-center shrink-0"
                         style={{ background: `linear-gradient(135deg, #1a1a2e, ${item.card?.team_color || '#444'}55)` }}>
                      <Heart size={14} className="text-pink-400 opacity-50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">{item.card?.driver_name || '—'}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{item.card?.parallel || '—'}</span>
                        {item.card?.grade && item.card.grade !== 'Raw' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400 border border-yellow-800/40">{item.card.grade}</span>
                        )}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[item.priority] || ''}`}>
                          {PRIORITY_LABELS[item.priority] || item.priority}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Max <span className="text-emerald-400 font-bold">${item.max_price?.toFixed(2)}</span>
                        {item.notes && <span className="ml-3 text-gray-600 italic">"{item.notes}"</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => toggleAutoSnipe(item.id, item.auto_snipe)}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                item.auto_snipe
                                  ? 'bg-red-600/20 text-red-400 border border-red-600/30'
                                  : 'bg-gray-800/60 text-gray-500 border border-gray-700/30 hover:text-gray-300'
                              }`}>
                        <Zap size={9} /> {item.auto_snipe ? 'AUTO' : 'OFF'}
                      </button>
                      <button onClick={() => removeWishItem(item.id)}
                              className="p-1.5 rounded-lg bg-gray-800 hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Matching live listings under max price */}
                  {matches.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800/60">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold mb-2 flex items-center gap-1">
                        <AlertCircle size={9} /> {matches.length} live listing{matches.length !== 1 ? 's' : ''} under your max
                      </div>
                      <div className="space-y-1.5">
                        {matches.map(m => {
                          const t = (m.current_price || 0) + (m.shipping_cost || 0)
                          const tl = timeLeft(m.time_left || 0)
                          const isAuc = (m.buying_options || []).includes('AUCTION')
                          return (
                            <a key={m.id} href={ebayAffiliateUrl(m.ebay_url)} target="_blank" rel="sponsored noopener"
                               className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/40 hover:bg-gray-800 transition-colors">
                              {isAuc ? <Gavel size={10} className="text-red-400" /> : <Tag size={10} className="text-green-400" />}
                              <span className="text-xs text-gray-300 truncate flex-1">{m.title}</span>
                              <span className="text-xs font-bold text-emerald-400">${t.toFixed(2)}</span>
                              {isAuc && <span className={`text-[10px] ${tl.cls} ml-1`}>{tl.text}</span>}
                              <ExternalLink size={9} className="text-gray-600" />
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* SECTION 3 — Smart rules */}
      <SmartRules />
    </div>
  )
}

function AddWishlistForm({ onClose, onAdded }) {
  const [driver, setDriver] = useState('')
  const [parallel, setParallel] = useState('Refractor')
  const [grade, setGrade] = useState('Raw')
  const [maxPrice, setMaxPrice] = useState('')
  const [priority, setPriority] = useState(3)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!driver || !maxPrice) { setErr('Driver + max price required'); return }
    setSaving(true); setErr('')
    try {
      const res = await fetch(`${API}/api/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_name: driver, parallel, grade,
          max_price: parseFloat(maxPrice), priority, notes: notes || null,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onAdded?.()
      onClose()
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="bg-gray-900/70 border border-pink-600/30 rounded-2xl p-4 mb-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Driver</label>
          <input list="driver-list" value={driver} onChange={e => setDriver(e.target.value)}
                 className="input-field w-full px-3 py-2 text-sm" placeholder="e.g. Lewis Hamilton" />
          <datalist id="driver-list">
            {ALL_DRIVERS.map(d => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Parallel</label>
          <select value={parallel} onChange={e => setParallel(e.target.value)}
                  className="input-field w-full px-3 py-2 text-sm">
            {PARALLELS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Grade</label>
          <select value={grade} onChange={e => setGrade(e.target.value)}
                  className="input-field w-full px-3 py-2 text-sm">
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Max Price ($)</label>
          <input type="number" step="0.01" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
                 className="input-field w-full px-3 py-2 text-sm" placeholder="100.00" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Priority</label>
          <select value={priority} onChange={e => setPriority(parseInt(e.target.value))}
                  className="input-field w-full px-3 py-2 text-sm">
            {[1,2,3,4,5].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
                 className="input-field w-full px-3 py-2 text-sm" placeholder="rookie premium, etc." />
        </div>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm font-bold disabled:opacity-50">
          {saving ? 'Saving…' : 'Add to Wishlist'}
        </button>
        <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}
