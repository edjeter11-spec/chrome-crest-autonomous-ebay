import { useState, useEffect, lazy, Suspense } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Package, Pencil, Trash2, X, Check, Plus, Award, AlertTriangle, Upload, Sparkles, Camera, Zap, Car } from 'lucide-react'
import StatCard from '../components/StatCard'
import CSVImportModal from '../components/CSVImportModal'
import ScanCardModal from '../components/ScanCardModal'
import { swrFetch } from '../lib/cache'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const GradePredictor = lazy(() => import('./GradePredictor'))

function median(nums) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

// Session-scoped cache so we don't re-hit the API for every row render.
const _thumbCache = new Map()

function CardThumb({ driver, parallel, fallbackEmoji = '🏎', size = 'w-9 h-11' }) {
  const API = import.meta.env.VITE_API_URL || ''
  const key = `${driver || ''}|${parallel || ''}`
  const [url, setUrl] = useState(() => _thumbCache.get(key) || null)
  useEffect(() => {
    if (_thumbCache.has(key)) { setUrl(_thumbCache.get(key)); return }
    if (!driver) return
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams()
        params.set('driver', driver)
        if (parallel && parallel !== 'Base') params.set('parallel', parallel)
        params.set('limit', '10')
        const r = await fetch(`${API}/api/sales?${params}`)
        if (!r.ok) return
        const d = await r.json()
        const rows = Array.isArray(d) ? d : (d.sales || d.results || [])
        // Pick the first row with a non-placeholder image
        const img = rows.map(r => r.image_url).find(u => u && !u.includes('placehold'))
        if (img) {
          _thumbCache.set(key, img)
          if (!cancelled) setUrl(img)
        } else {
          _thumbCache.set(key, '')
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [key])
  if (url) {
    return <img src={url} alt="" className={`${size} rounded-lg object-cover bg-gray-800 border border-gray-700/50`} />
  }
  return <div className={`${size} rounded-lg bg-gray-800 flex items-center justify-center text-base`}>{fallbackEmoji}</div>
}

function ScanInfoModal({ item, onClose, onDelete }) {
  const s = item._scan || {}
  const ai = s.ai_scan_json || {}
  const predictedGrade = ai.predicted_grade
  const confidence = ai.confidence
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md my-8 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-purple-400" />
            <h3 className="font-bold text-white text-sm">Scanned with AI</h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-white"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">
          {s.photo_url && (
            <img src={s.photo_url} alt="Scanned card" className="w-full rounded-lg bg-gray-800 border border-gray-700" />
          )}
          <div>
            <div className="font-black text-white text-base">{s.driver_name || '—'}</div>
            <div className="text-xs text-gray-400">{s.parallel || 'Base'}{s.card_number ? ` · #${s.card_number}` : ''}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs bg-gray-950/50 rounded-lg p-3 border border-gray-800">
            <span className="text-gray-500">AI grade prediction:</span>
            <span className="text-white font-bold text-right">{predictedGrade != null ? `PSA ${predictedGrade}` : '—'}</span>
            <span className="text-gray-500">Confidence:</span>
            <span className="text-gray-300 text-right">{confidence != null ? `${Math.round(confidence * 100)}%` : '—'}</span>
            <span className="text-gray-500">Market value (Raw comp):</span>
            <span className="text-emerald-400 font-bold text-right">{item.has_valuation ? `$${Math.round(item.current_value)}` : '—'}</span>
            <span className="text-gray-500">Recent sales (n):</span>
            <span className="text-gray-300 text-right">{item.comps_n ?? '—'}</span>
            <span className="text-gray-500">Your paid:</span>
            <span className="text-gray-300 text-right">{item.purchase_price ? `$${Number(item.purchase_price).toFixed(0)}` : '—'}</span>
          </div>
          {ai.reasoning && (
            <div className="text-[11px] text-gray-400 leading-relaxed bg-gray-950/50 rounded-lg p-3 border border-gray-800">
              <div className="font-bold text-gray-300 mb-1">AI notes</div>
              {ai.reasoning}
            </div>
          )}
          <div className="text-[10px] text-gray-500 italic">
            Market value uses recent sales for this driver + parallel (graded + raw). The AI grade is a prediction only — treat as raw for pricing until you actually send it to PSA.
          </div>
          <button onClick={onDelete} className="w-full px-3 py-2 bg-red-900/40 hover:bg-red-900/60 border border-red-800/50 text-red-300 text-xs font-bold rounded-lg">
            Remove from collection
          </button>
        </div>
      </div>
    </div>
  )
}

function ScannedCardsBlock({ refreshKey, onCount }) {
  const API = import.meta.env.VITE_API_URL || ''
  const { user, loading: authLoading } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [comps, setComps] = useState({})

  useEffect(() => {
    if (authLoading) return
    if (!supabaseReady || !user) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('user_portfolio')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) { setCards([]); setLoading(false); return }
      const rows = data || []
      setCards(rows)
      setLoading(false)
      onCount?.(rows.length)
      // Single batched lookup replaces N per-card /api/sales calls.
      if (rows.length > 0) {
        try {
          const queries = rows.map(c => ({
            driver: c.driver_name || '',
            parallel: c.parallel || null,
            grade: c.grade || null,
          }))
          const r = await fetch(`${API}/api/sales/lookup-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queries }),
          })
          if (!r.ok) return
          const batch = await r.json() || {}
          if (cancelled) return
          const next = {}
          rows.forEach((c, i) => {
            const salesArr = batch[String(i)] || []
            const prices = salesArr.map(x => Number(x.sale_price ?? x.total)).filter(Boolean)
            const m = median(prices)
            const last30 = salesArr.filter(s => {
              const ts = new Date(s.sale_date || 0).getTime()
              return ts && (Date.now() - ts) < 30 * 86400 * 1000
            }).length
            next[c.id] = {
              med: m,
              n: prices.length,
              last30,
              hi: Math.max(...prices, 0),
              lo: Math.min(...prices.filter(p => p > 0).concat(Infinity)),
            }
          })
          if (!cancelled) setComps(next)
        } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [user, authLoading, refreshKey])

  const remove = async (id) => {
    if (!confirm('Delete this scanned card?')) return
    setCards(prev => prev.filter(c => c.id !== id))
    await supabase.from('user_portfolio').delete().eq('id', id)
  }

  if (authLoading || loading) return <div className="text-sm text-gray-500 py-4">Loading your scanned cards…</div>
  if (!supabaseReady || !user) return null
  if (!cards.length) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Camera size={12} className="text-purple-400" />
        <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400">Scanned Cards · {cards.length}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map(c => {
          const comp = comps[c.id]
          const est = comp?.med
          const paid = c.purchase_price != null ? Number(c.purchase_price) : null
          const pnl = est != null && paid != null ? est - paid : null
          const pnlPct = pnl != null && paid > 0 ? (pnl / paid) * 100 : null
          return (
            <div key={c.id} className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3 flex gap-3 relative group">
              {c.photo_url ? (
                <img src={c.photo_url} alt="" className="w-20 h-28 object-cover rounded bg-gray-800 shrink-0" />
              ) : (
                <div className="w-20 h-28 rounded bg-gray-800 shrink-0 flex items-center justify-center">
                  <Camera size={20} className="text-gray-700" />
                </div>
              )}
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-bold text-white truncate">{c.driver_name || '—'}</div>
                <div className="text-gray-400 truncate">{c.parallel || 'Base'}{c.grade ? ` · ${c.grade}` : ''}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="text-gray-500">Market value:</span>
                  <span className="text-white font-bold text-right">{est != null ? `$${Math.round(est)}` : '—'}</span>
                  <span className="text-gray-500">Recent sales (n):</span>
                  <span className="text-gray-300 text-right">{comp?.n ?? '—'}</span>
                  <span className="text-gray-500">Sold last 30d:</span>
                  <span className="text-gray-300 text-right">{comp?.last30 ?? '—'}</span>
                  <span className="text-gray-500">Range:</span>
                  <span className="text-gray-300 text-right">
                    {comp?.lo && Number.isFinite(comp.lo) ? `$${Math.round(comp.lo)}–$${Math.round(comp.hi)}` : '—'}
                  </span>
                  <span className="text-gray-500">Your paid:</span>
                  <span className="text-gray-300 text-right">{paid != null ? `$${paid.toFixed(0)}` : '—'}</span>
                  {pnl != null && (<>
                    <span className="text-gray-500">P&L:</span>
                    <span className={`${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'} font-bold text-right`}>
                      {pnl >= 0 ? '+' : ''}${Math.round(pnl)}{pnlPct != null ? ` (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(0)}%)` : ''}
                    </span>
                  </>)}
                </div>
              </div>
              <button onClick={() => remove(c.id)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded bg-gray-800 text-gray-500 hover:text-red-400"
                title="Delete">
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AIAdvisorSection() {
  const API = import.meta.env.VITE_API_URL || ''
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await fetch(`${API}/api/ai/portfolio-advice`, { method: 'POST' })
      const data = await r.json()
      if (data?.status === 'no_key') setError(data.message || 'ANTHROPIC_API_KEY not set')
      else if (data?.status === 'empty') setError('Portfolio is empty — add holdings first.')
      else if (!r.ok) setError(data?.detail || `HTTP ${r.status}`)
      else setResult(data)
    } catch (e) {
      setError(e.message || 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel p-4 space-y-3 border-purple-800/30">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-400" />
          <h3 className="font-bold text-white text-sm">AI Advisor</h3>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
        >
          <Sparkles size={12} /> {busy ? 'Thinking…' : 'Get sell recommendations'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-2">Sell now</h4>
            <div className="space-y-2">
              {(result.sell || []).map((s, i) => (
                <div key={i} className="bg-gray-800/60 rounded-lg p-2.5 border border-red-900/30">
                  <div className="text-xs font-bold text-white truncate">{s.card}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{s.reason}</div>
                  <div className="flex gap-3 mt-1.5 text-[10px] text-gray-500">
                    {s.current_value != null && <span>${Number(s.current_value).toFixed(0)}</span>}
                    {s.profit_pct != null && (
                      <span className={Number(s.profit_pct) >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {Number(s.profit_pct) >= 0 ? '+' : ''}{Number(s.profit_pct).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {(!result.sell || !result.sell.length) && <p className="text-xs text-gray-600 italic">No sell recommendations.</p>}
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-green-400 mb-2">Hold</h4>
            <div className="space-y-2">
              {(result.hold || []).map((h, i) => (
                <div key={i} className="bg-gray-800/60 rounded-lg p-2.5 border border-green-900/30">
                  <div className="text-xs font-bold text-white truncate">{h.card}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{h.reason}</div>
                </div>
              ))}
              {(!result.hold || !result.hold.length) && <p className="text-xs text-gray-600 italic">No hold recommendations.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const API = import.meta.env.VITE_API_URL || ''

const PARALLELS = [
  'Base', 'Refractor', 'Prism Refractor', 'Aqua /199', 'Blue /150',
  'Green /99', 'Gold /50', 'Orange /25', 'Red /5', 'SuperFractor 1/1',
  'Autograph', 'Auto Blue /150', 'Auto Green /99', 'Auto Gold /50',
  'Auto Orange /25', 'Auto Red /5', 'Auto SuperFractor 1/1',
  'Speed Wheels', 'Neon Nations', 'Floor It', 'Vegas at Night', 'Diamond 75th',
]
const GRADES = ['Raw', 'PSA 10', 'PSA 9', 'PSA 8', 'BGS 9.5', 'BGS 10', 'SGC 10']

function PnlCell({ value, pct, has, realisticPnl, realisticPct }) {
  if (!has) return <div className="text-right text-gray-600 text-xs italic">n/a</div>
  const positive = value >= 0
  const color = positive ? 'text-green-400' : 'text-red-400'
  const rpositive = (realisticPnl ?? 0) >= 0
  const rcolor = rpositive ? 'text-green-500/80' : 'text-red-500/80'
  return (
    <div className={`text-right ${color}`}>
      <div className="font-semibold">{positive ? '+' : ''}${value.toFixed(2)}</div>
      <div className="text-[10px] opacity-70">{positive ? '+' : ''}{pct.toFixed(1)}%</div>
      {realisticPnl != null && (
        <div className={`text-[10px] ${rcolor} mt-0.5`}
          title="Realistic P&L after 13% eBay fee + $4 shipping. Excludes sales tax.">
          net {rpositive ? '+' : ''}${realisticPnl.toFixed(0)} ({realisticPct?.toFixed(1)}%)
        </div>
      )}
    </div>
  )
}

function AddCardForm({ onAdd, onCancel, drivers }) {
  const [form, setForm] = useState({
    driver: '', parallel: 'Base', grade: 'Raw',
    purchase_price: '', purchase_date: new Date().toISOString().slice(0, 10),
    quantity: 1, notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!form.driver || !form.purchase_price) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`${API}/api/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver: form.driver,
          parallel: form.parallel,
          grade: form.grade,
          purchase_price: Number(form.purchase_price),
          purchase_date: new Date(form.purchase_date).toISOString(),
          quantity: Number(form.quantity),
          notes: form.notes || null,
        }),
      })
      // Surface backend failures — previously the form just closed and
      // pretended the card was saved.
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Save failed (${res.status}) — ${body.slice(0, 120)}`)
      }
      onAdd()
    } catch (e) {
      setErr(e?.message || 'Save failed — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="panel p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-white text-sm">Add Card</h3>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-white"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-bold">Driver</label>
          <input list="driver-list" value={form.driver} onChange={e => setForm({ ...form, driver: e.target.value })}
            required placeholder="e.g. Max Verstappen"
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700" />
          <datalist id="driver-list">
            {drivers.map(d => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-bold">Parallel</label>
          <select value={form.parallel} onChange={e => setForm({ ...form, parallel: e.target.value })}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700">
            {PARALLELS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-bold">Grade</label>
          <select value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700">
            {GRADES.map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-bold">Paid ($)</label>
          <input type="number" step="0.01" min="0" required value={form.purchase_price}
            onChange={e => setForm({ ...form, purchase_price: e.target.value })}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-bold">Date</label>
          <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-bold">Qty</label>
          <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
            className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-500 uppercase font-bold">Notes</label>
        <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-700" />
      </div>
      {err && (
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded px-3 py-2">
          {err}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
        <button disabled={busy} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg">
          {busy ? 'Adding…' : 'Add to Portfolio'}
        </button>
      </div>
    </form>
  )
}

function EditRow({ item, onSave, onCancel }) {
  const [qty, setQty] = useState(item.quantity || 1)
  const [price, setPrice] = useState(item.purchase_price || 0)
  const [notes, setNotes] = useState(item.notes || '')

  const save = async () => {
    await fetch(`${API}/api/portfolio/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: Number(qty), purchase_price: Number(price), notes }),
    })
    onSave()
  }

  return (
    <tr className="bg-gray-800/40">
      <td><div className="w-9 h-11 rounded-lg bg-gray-800 flex items-center justify-center"><Car size={16} className="text-gray-500" /></div></td>
      <td><div className="font-semibold text-white text-sm">{item.card?.driver_name}</div></td>
      <td className="text-gray-500 text-xs">{item.card?.parallel}</td>
      <td className="text-xs text-gray-400">{item.card?.grade}</td>
      <td className="text-right">
        <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
          className="w-14 bg-gray-700 text-white text-xs rounded px-2 py-1 text-right border border-gray-600" />
      </td>
      <td className="text-right">
        <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
          className="w-20 bg-gray-700 text-white text-xs rounded px-2 py-1 text-right border border-gray-600" />
      </td>
      <td className="text-right text-green-400">${item.current_value?.toFixed(2)}</td>
      <td>
        <div className="flex items-center justify-end gap-1">
          <button onClick={save} className="p-1 text-green-400 hover:text-green-300"><Check size={13} /></button>
          <button onClick={onCancel} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
        </div>
      </td>
      <td></td>
    </tr>
  )
}

export default function Portfolio() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanRefresh, setScanRefresh] = useState(0)
  const [tab, setTab] = useState('holdings') // 'holdings' | 'ai'
  const [drivers, setDrivers] = useState([])
  const [infoItem, setInfoItem] = useState(null)

  // Merges manual /api/portfolio holdings with Supabase user_portfolio scans.
  // Scanned cards get live median comps from /api/sales keyed on driver+parallel
  // only — the AI-predicted grade is ignored because raw cards are almost always
  // not actually graded yet.
  const load = async () => {
    let manual = []
    try {
      const r = await fetch(`${API}/api/portfolio`)
      if (r.ok) {
        const d = await r.json()
        manual = d.items || d || []
      }
    } catch {}
    manual = (manual || []).map(x => ({ ...x, _source: 'manual' }))

    let scans = []
    if (supabaseReady && user) {
      try {
        const { data } = await supabase
          .from('user_portfolio')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        scans = data || []
      } catch {}
    }

    // Enrich scans with comp median. Previously fired one /api/sales request
    // per scanned card (50 cards = 50 requests on mount). Now a single
    // /api/sales/lookup-batch call returns the latest sales per query tuple.
    let batchResults = {}
    if (scans.length > 0) {
      try {
        const queries = scans.map(c => ({
          driver: c.driver_name || '',
          parallel: c.parallel || null,
          // grade intentionally omitted — see comment below; AI-predicted
          // grade is not reliable for raw cards.
        }))
        const r = await fetch(`${API}/api/sales/lookup-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries }),
        })
        if (r.ok) batchResults = await r.json() || {}
      } catch {}
    }

    const enriched = scans.map((c, i) => {
      const rows = batchResults[String(i)] || []
      const prices = rows.map(x => Number(x.sale_price ?? x.total)).filter(Boolean)
      const medPrice = median(prices)
      const n = prices.length
      const paid = c.purchase_price != null ? Number(c.purchase_price) : 0
      const val = medPrice || 0
      const pnl = val - paid
      const pnlPct = paid > 0 ? (pnl / paid) * 100 : 0
      return {
        id: `scan-${c.id}`,
        _source: 'scan',
        _scan: c,
        quantity: 1,
        purchase_price: paid,
        current_value: medPrice,
        has_valuation: medPrice != null,
        pnl_pct: pnlPct,
        realistic_pnl: pnl * 0.87 - 4,
        realistic_pnl_pct: paid > 0 ? ((pnl * 0.87 - 4) / paid) * 100 : 0,
        notes: c.notes,
        card: { driver_name: c.driver_name, parallel: c.parallel || 'Base', grade: 'Raw' },
        comps_n: n,
      }
    })

    setItems([...enriched, ...manual])
    setLoading(false)
  }

  useEffect(() => { load() }, [user, scanRefresh])

  useEffect(() => {
    fetch(`${API}/api/cards/drivers-summary`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setDrivers((d || []).map(x => x.driver_name).filter(Boolean)))
      .catch(() => {})
  }, [])

  const deleteItem = async (id) => {
    if (!confirm('Remove this holding?')) return
    setItems(prev => prev.filter(i => i.id !== id))
    await fetch(`${API}/api/portfolio/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const totalCost = items.reduce((s, i) => s + ((i.purchase_price || 0) * (i.quantity || 1)), 0)
  const totalValue = items.reduce((s, i) => s + ((i.current_value || 0) * (i.quantity || 1)), 0)
  const totalPnl = totalValue - totalCost
  const pnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0
  const totalCards = items.reduce((s, i) => s + (i.quantity || 1), 0)
  const totalRealisticValue = items.reduce((s, i) => s + (i.realistic_value || 0), 0)
  const totalRealisticPnl = totalRealisticValue - totalCost
  const realisticPnlPct = totalCost > 0 ? (totalRealisticPnl / totalCost * 100) : 0

  // Top gainer / worst loser (by pnl_pct, excluding no-valuation)
  const scored = items.filter(i => i.has_valuation)
  const topGainer = scored.reduce((best, i) => (i.pnl_pct > (best?.pnl_pct ?? -Infinity) ? i : best), null)
  const worstLoser = scored.reduce((worst, i) => (i.pnl_pct < (worst?.pnl_pct ?? Infinity) ? i : worst), null)

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">My Cards</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setScanning(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:brightness-110 text-white text-xs font-bold rounded-lg shadow-lg shadow-purple-900/30">
            <Camera size={14} /> Scan Card
          </button>
          <button onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs font-bold rounded-lg">
            <Upload size={14} /> Import CSV
          </button>
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg">
              <Plus size={14} /> Add Manually
            </button>
          )}
        </div>
      </div>

      {/* Scan hero — only shown when nothing in collection */}
      {!loading && items.length === 0 && (
        <button onClick={() => setScanning(true)}
          className="w-full block text-left bg-gradient-to-br from-purple-900/40 to-pink-900/20 border-2 border-dashed border-purple-700/50 hover:border-purple-500 rounded-2xl p-6 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-purple-600/30 flex items-center justify-center shrink-0">
              <Camera size={22} className="text-purple-300" />
            </div>
            <div>
              <div className="font-black text-white text-lg">Snap a card to get started</div>
              <div className="text-xs text-purple-200/80 mt-0.5">AI identifies driver + parallel, finds eBay recent sales, saves to your collection with sold-history insights.</div>
            </div>
          </div>
        </button>
      )}

      {/* Tab switcher */}
      <div className="flex items-center gap-2 border-b border-gray-800">
        <button onClick={() => setTab('holdings')}
          className={`px-4 py-2 text-sm font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
            tab === 'holdings' ? 'text-white border-red-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
          <Package size={14} /> Holdings
        </button>
        <button onClick={() => setTab('ai')}
          className={`px-4 py-2 text-sm font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
            tab === 'ai' ? 'text-white border-red-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
          <Sparkles size={14} /> AI Grader
        </button>
      </div>

      {tab === 'ai' && (
        <Suspense fallback={<div className="text-gray-500 text-sm p-4">Loading AI grader…</div>}>
          <GradePredictor />
        </Suspense>
      )}

      {tab === 'holdings' && <>

      {importing && <CSVImportModal onClose={() => setImporting(false)} onImported={load} />}
      {adding && <AddCardForm drivers={drivers} onAdd={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} />}
      {scanning && <ScanCardModal open={scanning} onClose={() => setScanning(false)} onSaved={() => { setScanning(false); setScanRefresh(x => x + 1) }} />}
      {infoItem && <ScanInfoModal item={infoItem} onClose={() => setInfoItem(null)} onDelete={async () => {
        if (!confirm('Delete this scanned card?')) return
        await supabase.from('user_portfolio').delete().eq('id', infoItem._scan.id)
        setInfoItem(null); setScanRefresh(x => x + 1)
      }} />}

      <AIAdvisorSection />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Cost" value={loading ? null : `$${totalCost.toFixed(0)}`} icon={DollarSign} color="blue" />
        <StatCard label="Current Value" value={loading ? null : `$${totalValue.toFixed(0)}`} icon={TrendingUp} color="green" />
        <div title="Assumes 13% eBay final value fee + $4 shipping cost. Excludes sales tax.">
          <StatCard
            label="Net Realistic Value"
            value={loading ? null : `$${totalRealisticValue.toFixed(0)}`}
            sub={totalRealisticPnl >= 0 ? `+${realisticPnlPct.toFixed(1)}%` : `${realisticPnlPct.toFixed(1)}%`}
            icon={DollarSign}
            color={totalRealisticPnl >= 0 ? 'green' : 'red'}
          />
        </div>
        <StatCard
          label="Total P&L"
          value={loading ? null : `${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(0)}`}
          sub={`${pnlPct.toFixed(1)}%`}
          icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
          color={totalPnl >= 0 ? 'green' : 'red'}
        />
        <StatCard label="Cards Owned" value={loading ? null : totalCards} icon={Package} color="purple" />
      </div>

      {(topGainer || worstLoser) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {topGainer && (
            <div className="panel p-3 flex items-center gap-3 border-green-800/30">
              <Award className="text-green-400 shrink-0" size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">Top Gainer</div>
                <div className="text-sm text-white font-bold truncate">{topGainer.card?.driver_name} · {topGainer.card?.parallel}</div>
              </div>
              <div className="text-green-400 font-black text-lg">+{topGainer.pnl_pct.toFixed(1)}%</div>
            </div>
          )}
          {worstLoser && worstLoser.id !== topGainer?.id && (
            <div className="panel p-3 flex items-center gap-3 border-red-800/30">
              <AlertTriangle className="text-red-400 shrink-0" size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">Worst Loser</div>
                <div className="text-sm text-white font-bold truncate">{worstLoser.card?.driver_name} · {worstLoser.card?.parallel}</div>
              </div>
              <div className="text-red-400 font-black text-lg">{worstLoser.pnl_pct.toFixed(1)}%</div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="panel h-64 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-20">
          <Package size={48} className="mb-4 text-gray-500" />
          <p className="text-lg font-bold text-white">Time to build your portfolio</p>
          <p className="text-sm text-gray-400 mt-2 mb-6 max-w-sm text-center">Track purchases, monitor recent sales, and watch your collection grow. Scan a card or add holdings manually.</p>
          <div className="flex gap-3 flex-wrap justify-center">
            <button onClick={() => setScanning(true)} className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:brightness-110 text-white text-sm font-bold rounded-lg flex items-center gap-2 shadow-lg shadow-purple-900/30">
              <Camera size={16} /> Scan Card
            </button>
            <button onClick={() => setAdding(true)} className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg flex items-center gap-2">
              <Plus size={16} /> Add Manually
            </button>
          </div>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-800/60 flex items-center justify-between">
            <h2 className="font-bold text-white text-sm">Holdings</h2>
            <span className="text-xs text-gray-500">{items.length} positions · {totalCards} cards · sorted by P&L %</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr>
                  <th className="w-12"></th>
                  <th>Driver</th>
                  <th>Parallel</th>
                  <th>Grade</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">P&L</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  if (editing === item.id) {
                    return <EditRow key={item.id} item={item} onSave={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
                  }
                  const cost = (item.purchase_price || 0) * (item.quantity || 1)
                  const val = (item.current_value || 0) * (item.quantity || 1)
                  const pnl = val - cost
                  const pct = cost > 0 ? pnl / cost * 100 : 0
                  const isScan = item._source === 'scan'
                  return (
                    <tr key={item.id} className="group cursor-pointer hover:bg-gray-800/30" onClick={() => isScan && setInfoItem(item)}>
                      <td>
                        {isScan && item._scan?.photo_url ? (
                          <img src={item._scan.photo_url} alt="" className="w-9 h-11 rounded-lg object-cover bg-gray-800" />
                        ) : (
                          <CardThumb driver={item.card?.driver_name} parallel={item.card?.parallel} />
                        )}
                      </td>
                      <td>
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          {item.card?.driver_name || '—'}
                          {isScan && (
                            <span className="text-[9px] font-black px-1 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-700/40 flex items-center gap-0.5">
                              <Sparkles size={8} /> AI
                            </span>
                          )}
                        </div>
                        {item.notes && <div className="text-[10px] text-gray-600 truncate max-w-[120px]">{item.notes}</div>}
                      </td>
                      <td className="text-gray-500 text-xs">{item.card?.parallel || '—'}</td>
                      <td>
                        {isScan ? (
                          <span className="text-[10px] text-gray-500" title="Scanned cards treated as Raw for comp lookup — AI grade is prediction only">Raw</span>
                        ) : item.card?.grade && item.card.grade !== 'Raw' ? (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400 border border-yellow-800/30">
                            {item.card.grade}
                          </span>
                        ) : <span className="text-xs text-gray-600">{item.card?.grade || '—'}</span>}
                      </td>
                      <td className="text-right font-medium">{item.quantity || 1}</td>
                      <td className="text-right text-gray-300">${(item.purchase_price || 0).toFixed(2)}</td>
                      <td className="text-right font-medium">
                        {item.has_valuation
                          ? <span className="text-green-400">${(item.current_value || 0).toFixed(2)}</span>
                          : <span className="text-gray-600 text-xs italic">no data</span>}
                      </td>
                      <td><PnlCell value={pnl} pct={pct} has={item.has_valuation} realisticPnl={item.realistic_pnl} realisticPct={item.realistic_pnl_pct} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                          {isScan ? (
                            <button onClick={() => setInfoItem(item)} className="p-1.5 text-gray-500 hover:text-purple-400 transition-colors" title="Scan info">
                              <Sparkles size={11} />
                            </button>
                          ) : (
                            <>
                              <button onClick={() => setEditing(item.id)} className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors">
                                <Pencil size={11} />
                              </button>
                              <button onClick={() => deleteItem(item.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors">
                                <Trash2 size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
