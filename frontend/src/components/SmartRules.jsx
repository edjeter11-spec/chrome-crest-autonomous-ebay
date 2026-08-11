import { useEffect, useState } from 'react'
import { Plus, Trash2, Sparkles, Zap } from 'lucide-react'
import { DRIVERS_F1, DRIVERS_F2, DRIVERS_F3, DRIVERS_LEGENDS } from '../lib/drivers'
import { supabase } from '../lib/supabase'

const API = import.meta.env.VITE_API_URL || ''

// watch-rules mutations are per-user server-side (Supabase JWT + row
// ownership) — every write must carry the session token.
async function authHeaders(extra = {}) {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  } catch {
    return extra
  }
}

const PARALLELS = [
  '', 'Refractor', 'Autograph', 'SuperFractor', 'Aqua /199', 'Pink /250', 'Teal /299',
  'Blue /150', 'Green /99', 'Gold /50', 'Orange /25', 'Red /5', 'Black /10', 'F1 75th /75',
  'Vegas at Night', 'Neon Nations', 'Speed Wheels', 'Helix', 'Top Speed', 'Diamond 75th',
]
const GRADES = ['', 'Raw', 'PSA 10', 'PSA 9', 'BGS 9.5', 'SGC 10']
const ALL_DRIVERS = ['', ...[...DRIVERS_F1, ...DRIVERS_F2, ...DRIVERS_F3, ...DRIVERS_LEGENDS].sort()]

export default function SmartRules() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const load = async () => {
    try {
      const r = await fetch(`${API}/api/watch-rules`, { headers: await authHeaders() })
      if (r.ok) {
        const d = await r.json()
        setRules(d.rules || [])
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const del = async (id) => {
    await fetch(`${API}/api/watch-rules/${id}`, { method: 'DELETE', headers: await authHeaders() })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  const toggle = async (r) => {
    await fetch(`${API}/api/watch-rules/${r.id}`, {
      method: 'PATCH',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ active: !r.active }),
    })
    setRules(prev => prev.map(x => x.id === r.id ? { ...x, active: !x.active } : x))
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-violet-400" />
          <h2 className="text-sm font-black uppercase tracking-wider text-gray-300">Smart Rules</h2>
          <span className="text-xs text-gray-500">({rules.length})</span>
        </div>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="px-3 py-1.5 rounded-lg bg-violet-600/15 border border-violet-600/40 text-violet-300 text-xs font-bold hover:bg-violet-600/25 flex items-center gap-1.5"
        >
          <Plus size={11} /> New rule
        </button>
      </div>

      <p className="text-[11px] text-gray-500 mb-3">
        Auto-watch any matching auction. Runs every cron cycle — matches get bumped to your watchlist automatically.
      </p>

      {showAdd && <AddRuleForm onClose={() => setShowAdd(false)} onAdded={() => { load(); setShowAdd(false) }} />}

      {loading ? (
        <div className="space-y-2">
          {Array(2).fill(0).map((_, i) => <div key={i} className="h-14 bg-gray-900/40 rounded-2xl animate-pulse" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-gradient-to-br from-violet-900/20 to-purple-900/20 border border-violet-700/40 rounded-2xl py-8 text-center">
          <Sparkles size={28} className="mx-auto mb-2 text-violet-400" />
          <p className="text-sm font-bold text-white">No smart rules yet</p>
          <p className="text-xs text-gray-400 mt-2 mb-4">Create one to auto-watch matching auctions. Example: "Any Verstappen Refractor under $50" — we handle the rest.</p>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-lg">
            <Plus size={13} /> Create Smart Rule
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(r => (
            <div key={r.id} className={`bg-gray-900/70 border rounded-2xl p-3 flex items-center gap-3 ${r.active ? 'border-violet-600/30' : 'border-gray-800/60 opacity-60'}`}>
              <Zap size={14} className={r.active ? 'text-violet-400' : 'text-gray-600'} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{r.label}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">
                  Created {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                </div>
              </div>
              <button
                onClick={() => toggle(r)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${r.active ? 'bg-violet-600/20 text-violet-300 border border-violet-600/40' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
              >
                {r.active ? 'ACTIVE' : 'OFF'}
              </button>
              <button
                onClick={() => del(r.id)}
                className="p-1.5 rounded-lg bg-gray-800 hover:bg-red-900/30 text-gray-500 hover:text-red-400"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AddRuleForm({ onClose, onAdded }) {
  const [driver, setDriver] = useState('')
  const [parallel, setParallel] = useState('')
  const [grade, setGrade] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const mp = parseFloat(maxPrice)
    if (!mp || mp <= 0) { setErr('Max price required'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${API}/api/watch-rules`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          driver_filter: driver || null,
          parallel_filter: parallel || null,
          grade_filter: grade || null,
          max_price: mp,
          active: true,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onAdded?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="bg-gray-900/70 border border-violet-600/30 rounded-2xl p-4 mb-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Driver (any)</label>
          <input list="rule-drivers" value={driver} onChange={e => setDriver(e.target.value)}
            placeholder="Any"
            className="w-full bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700" />
          <datalist id="rule-drivers">
            {ALL_DRIVERS.map(d => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Parallel</label>
          <select value={parallel} onChange={e => setParallel(e.target.value)}
            className="w-full bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
            <option value="">Any</option>
            {PARALLELS.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Grade</label>
          <select value={grade} onChange={e => setGrade(e.target.value)}
            className="w-full bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
            <option value="">Any</option>
            {GRADES.filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 block">Max Price ($)</label>
          <input type="number" step="0.01" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
            placeholder="50"
            className="w-full bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700" />
        </div>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
        <button type="submit" disabled={busy}
          className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-bold">
          {busy ? 'Saving…' : 'Add rule'}
        </button>
      </div>
    </form>
  )
}
