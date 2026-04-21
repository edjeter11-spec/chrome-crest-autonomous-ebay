import { useState, useEffect, lazy, Suspense } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Package, Pencil, Trash2, X, Check, Plus, Award, AlertTriangle, Upload, Sparkles, Camera, Zap } from 'lucide-react'
import StatCard from '../components/StatCard'
import CSVImportModal from '../components/CSVImportModal'
import ScanCardModal from '../components/ScanCardModal'
import { swrFetch } from '../lib/cache'

const GradePredictor = lazy(() => import('./GradePredictor'))

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

  const submit = async (e) => {
    e.preventDefault()
    if (!form.driver || !form.purchase_price) return
    setBusy(true)
    try {
      await fetch(`${API}/api/portfolio`, {
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
      onAdd()
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
      <td><div className="w-9 h-11 rounded-lg bg-gray-800 flex items-center justify-center text-base">🏎</div></td>
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
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [tab, setTab] = useState('holdings') // 'holdings' | 'ai'
  const [drivers, setDrivers] = useState([])

  const load = () => swrFetch(`${API}/api/portfolio`, d => { setItems(d.items || d || []); setLoading(false) })

  useEffect(() => { load() }, [])

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

      {/* Scan hero — only shown when collection is empty so it doesn't clutter */}
      {!loading && items.length === 0 && (
        <button onClick={() => setScanning(true)}
          className="w-full block text-left bg-gradient-to-br from-purple-900/40 to-pink-900/20 border-2 border-dashed border-purple-700/50 hover:border-purple-500 rounded-2xl p-6 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-purple-600/30 flex items-center justify-center shrink-0">
              <Camera size={22} className="text-purple-300" />
            </div>
            <div>
              <div className="font-black text-white text-lg">Snap a card to get started</div>
              <div className="text-xs text-purple-200/80 mt-0.5">AI identifies driver + parallel, finds eBay comps, saves to your collection with sold-history insights.</div>
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
      {scanning && <ScanCardModal open={scanning} onClose={() => setScanning(false)} onSaved={() => { setScanning(false); load() }} />}

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
        <div className="panel flex flex-col items-center justify-center py-20 text-gray-600">
          <Package size={36} className="mb-4 opacity-20" />
          <p className="text-sm font-medium">No holdings yet</p>
          <p className="text-xs mt-1 text-gray-700">Click "Add Card" to track your first purchase</p>
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
                  return (
                    <tr key={item.id} className="group">
                      <td>
                        <div className="w-9 h-11 rounded-lg bg-gray-800 flex items-center justify-center text-base">🏎</div>
                      </td>
                      <td>
                        <div className="font-semibold text-white">{item.card?.driver_name}</div>
                        {item.notes && <div className="text-[10px] text-gray-600 truncate max-w-[120px]">{item.notes}</div>}
                      </td>
                      <td className="text-gray-500 text-xs">{item.card?.parallel || '—'}</td>
                      <td>
                        {item.card?.grade && item.card.grade !== 'Raw' ? (
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
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditing(item.id)} className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors">
                            <Pencil size={11} />
                          </button>
                          <button onClick={() => deleteItem(item.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors">
                            <Trash2 size={11} />
                          </button>
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
