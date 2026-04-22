import { useState, useEffect, useMemo } from 'react'
import { Target, Trash2, Pause, Play, Plus, Link as LinkIcon, BellRing, Smartphone, AlertCircle } from 'lucide-react'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ALL_PARALLELS, AUTO_VARIANTS } from '../lib/parallels'
import { pushSupported, isSubscribed, subscribePush } from '../lib/push'

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '')
}
function isStandalonePWA() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function PushCTA() {
  const [state, setState] = useState('checking') // checking | unsupported | off | on | busy | needs-install | denied
  const [err, setErr] = useState('')
  useEffect(() => {
    // iOS Safari only supports web-push when installed to home screen.
    if (isIOS() && !isStandalonePWA()) { setState('needs-install'); return }
    if (!pushSupported()) { setState('unsupported'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    isSubscribed().then(on => setState(on ? 'on' : 'off')).catch(() => setState('off'))
  }, [])

  const enable = async () => {
    setErr(''); setState('busy')
    try { await subscribePush(); setState('on') }
    catch (e) {
      setErr(e?.message || 'Could not enable — check browser permission.')
      if (e?.message === 'Permission denied') setState('denied')
      else setState('off')
    }
  }

  if (state === 'on' || state === 'unsupported') return null

  if (state === 'needs-install') {
    return (
      <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/30 border border-indigo-700/50 rounded-2xl p-4 mb-5 flex items-start gap-3">
        <Smartphone size={22} className="text-indigo-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-black text-white text-sm">Install to enable push alerts</div>
          <div className="text-[11px] text-indigo-200/80 mt-0.5 leading-relaxed">iOS only allows push notifications when this site is added to your Home Screen. Tap the <span className="font-bold">Share</span> icon in Safari → <span className="font-bold">Add to Home Screen</span>, then open it from the new icon and come back here.</div>
        </div>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="bg-gradient-to-r from-amber-900/40 to-orange-900/30 border border-amber-700/50 rounded-2xl p-4 mb-5 flex items-start gap-3">
        <AlertCircle size={22} className="text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-black text-white text-sm">Notifications blocked</div>
          <div className="text-[11px] text-amber-200/80 mt-0.5">Re-enable in your browser/phone settings for this site, then refresh.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-r from-red-900/40 to-orange-900/30 border border-red-700/50 rounded-2xl p-4 mb-5 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-red-600/40 flex items-center justify-center shrink-0">
        <BellRing size={18} className="text-red-200" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-black text-white text-sm">Turn on snipe alerts</div>
        <div className="text-[11px] text-red-200/80 mt-0.5">{err || "We'll push a notification the moment a listing matches your rules."}</div>
      </div>
      <button onClick={enable} disabled={state === 'busy' || state === 'checking'}
        className="px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-black rounded-lg shrink-0">
        {state === 'busy' ? 'Enabling…' : 'Enable'}
      </button>
    </div>
  )
}

const API = import.meta.env.VITE_API_URL || ''

const DRIVERS = [
  'Max Verstappen', 'Lewis Hamilton', 'Charles Leclerc', 'Lando Norris',
  'Oscar Piastri', 'Fernando Alonso', 'Carlos Sainz', 'George Russell',
  'Sergio Perez', 'Lance Stroll', 'Valtteri Bottas', 'Esteban Ocon',
  'Pierre Gasly', 'Yuki Tsunoda', 'Nico Hulkenberg', 'Kevin Magnussen',
  'Zhou Guanyu', 'Alexander Albon', 'Gabriel Bortoleto', 'Liam Lawson',
  'Andrea Kimi Antonelli', 'Oliver Bearman', 'Jack Doohan', 'Isack Hadjar',
]

const PRESETS = [
  { label: 'Any Verstappen Gold /50 < $250', rule: { driver_name: 'Max Verstappen', parallel: 'Gold /50', max_price: 250 } },
  { label: 'Any Autograph /25 < $500', rule: { parallel: 'Orange /25 Auto', max_price: 500 } },
  { label: 'Any Rookie Helix < $300', rule: { parallel: 'Helix', max_price: 300 } },
  { label: 'Any Refractor Auto < $200', rule: { parallel: 'Refractor Auto', max_price: 200 } },
]

function timeAgo(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Sniper() {
  const { user } = useAuth()
  const [rules, setRules] = useState([])
  const [matchCounts, setMatchCounts] = useState({})
  const [lastMatched, setLastMatched] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [driver, setDriver] = useState('')
  const [parallel, setParallel] = useState('')
  const [grade, setGrade] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [maxPct, setMaxPct] = useState('')
  const [endingSoon, setEndingSoon] = useState(false)
  const [maxPerDay, setMaxPerDay] = useState(3)

  const [urlInput, setUrlInput] = useState('')
  const [urlResult, setUrlResult] = useState(null)
  const [urlLoading, setUrlLoading] = useState(false)

  const loadRules = async () => {
    if (!supabaseReady || !user) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('user_snipe_rules')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error) setRules(data || [])
    const { data: matches } = await supabase
      .from('user_snipe_matches')
      .select('rule_id, created_at')
      .order('created_at', { ascending: false })
    const counts = {}
    const last = {}
    ;(matches || []).forEach(m => {
      counts[m.rule_id] = (counts[m.rule_id] || 0) + 1
      if (!last[m.rule_id]) last[m.rule_id] = m.created_at  // first seen = most recent due to ordering
    })
    setMatchCounts(counts)
    setLastMatched(last)
    setLoading(false)
  }

  useEffect(() => { loadRules() }, [user])

  const applyPreset = (preset) => {
    setDriver(preset.rule.driver_name || '')
    setParallel(preset.rule.parallel || '')
    setGrade(preset.rule.grade || '')
    setMaxPrice(preset.rule.max_price ?? '')
    setMaxPct(preset.rule.max_percent_of_median ?? '')
    setEndingSoon(!!preset.rule.ending_soon_only)
  }

  const createRule = async (e) => {
    e.preventDefault()
    setError('')
    if (!user) { setError('Sign in first'); return }
    // Max price / max % is now optional — leaving both blank means "alert on any match"
    setSaving(true)
    const row = {
      user_id: user.id,
      driver_name: driver || null,
      parallel: parallel || null,
      grade: grade || null,
      max_price: maxPrice ? Number(maxPrice) : null,
      max_percent_of_median: maxPct ? Number(maxPct) : null,
      ending_soon_only: endingSoon,
      max_per_day: Number(maxPerDay) || 3,
      active: true,
      name: [driver || 'Any', parallel || 'any', grade, maxPrice ? `<$${maxPrice}` : '', maxPct ? `<${maxPct}%` : ''].filter(Boolean).join(' '),
    }
    const { error } = await supabase.from('user_snipe_rules').insert(row)
    setSaving(false)
    if (error) { setError(error.message); return }
    setDriver(''); setParallel(''); setGrade(''); setMaxPrice(''); setMaxPct(''); setEndingSoon(false); setMaxPerDay(3)
    loadRules()
  }

  const toggleRule = async (r) => {
    await supabase.from('user_snipe_rules').update({ active: !r.active }).eq('id', r.id)
    loadRules()
  }
  const deleteRule = async (r) => {
    if (!confirm('Delete this rule?')) return
    await supabase.from('user_snipe_rules').delete().eq('id', r.id)
    loadRules()
  }

  const checkUrl = async () => {
    if (!urlInput.trim()) return
    setUrlLoading(true); setUrlResult(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const r = await fetch(`${API}/api/sniper/check-url?url=${encodeURIComponent(urlInput.trim())}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const j = await r.json()
      setUrlResult(j)
    } catch (e) {
      setUrlResult({ status: 'error', message: String(e) })
    }
    setUrlLoading(false)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Target size={24} className="text-red-500" />
          Sniper
        </h1>
        <p className="text-sm text-gray-500 mt-1">Get notified when your target cards hit a price.</p>
      </div>

      <PushCTA />

      {/* Presets */}
      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700 text-xs font-semibold text-gray-300 border border-gray-700/50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Rule builder */}
      <form onSubmit={createRule} className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-gray-400">
            Driver
            <select value={driver} onChange={e => setDriver(e.target.value)} className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">Any driver</option>
              {DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Parallel
            <select value={parallel} onChange={e => setParallel(e.target.value)} className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">Any parallel</option>
              <option value="Autograph">Autograph (any)</option>
              {ALL_PARALLELS.filter(p => p !== 'Autograph').map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Grade
            <input value={grade} onChange={e => setGrade(e.target.value)} placeholder="PSA 10, Raw, or leave blank" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
        </div>

        {/* Auto-variant selector — only when Autograph picked */}
        {parallel === 'Autograph' && (
          <div className="bg-yellow-900/15 border border-yellow-700/40 rounded-lg p-3">
            <div className="text-[11px] font-black text-yellow-300 uppercase tracking-wider mb-2">Auto parallel type</div>
            <div className="flex flex-wrap gap-1.5">
              {['Any', ...AUTO_VARIANTS.filter(v => v !== 'Any')].map(v => {
                const target = v === 'Any' ? 'Autograph' : v
                const active = parallel === target || (v === 'Any' && parallel === 'Autograph')
                return (
                  <button type="button" key={v} onClick={() => setParallel(target)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      active ? 'bg-yellow-500 text-black border border-yellow-400' : 'bg-gray-800/60 text-gray-300 border border-transparent hover:border-gray-700/50'
                    }`}>
                    {v === 'Any' ? 'Base Auto (any)' : `Auto · ${v}`}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-gray-400">
            Max price $ <span className="text-gray-600 normal-case">(optional)</span>
            <input type="number" step="1" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Any price" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-400">
            OR Max % of median
            <input type="number" min="1" max="100" value={maxPct} onChange={e => setMaxPct(e.target.value)} placeholder="70 = alert if <70% of median" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-400">
            Max alerts/day
            <input type="number" min="1" value={maxPerDay} onChange={e => setMaxPerDay(e.target.value)} className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={endingSoon} onChange={e => setEndingSoon(e.target.checked)} />
          Only alert when auction has &lt;6h left
        </label>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <button type="submit" disabled={saving || !user} className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold text-sm px-4 py-2 rounded-lg flex items-center gap-2">
          <Plus size={14} /> {saving ? 'Saving…' : 'Create rule'}
        </button>
        {!user && <div className="text-xs text-gray-500">Sign in to save rules.</div>}
      </form>

      {/* Paste URL */}
      <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 mb-6">
        <div className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
          <LinkIcon size={12} /> Paste an eBay listing URL to check against your rules
        </div>
        <input
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onBlur={checkUrl}
          placeholder="https://www.ebay.com/itm/..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
        />
        {urlLoading && <div className="text-xs text-gray-500 mt-2">Checking…</div>}
        {urlResult && (
          <div className="mt-3 text-xs">
            {urlResult.status === 'ok' ? (
              <>
                <div className="text-gray-400 mb-1">{urlResult.auction?.title}</div>
                {urlResult.matches?.filter(m => m.matched).length > 0 ? (
                  <div className="text-green-400 font-semibold">Matches {urlResult.matches.filter(m => m.matched).length} rule(s)</div>
                ) : (
                  <div className="text-gray-500">No rules match this listing.</div>
                )}
              </>
            ) : (
              <div className="text-gray-500">{urlResult.message || urlResult.status}</div>
            )}
          </div>
        )}
      </div>

      {/* Active rules */}
      <h2 className="text-sm font-bold text-white mb-3">Your rules</h2>
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-6 text-center text-sm text-gray-500">
          No rules yet. Create your first above.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(r => (
            <div key={r.id} className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-4 ${r.active ? 'border-gray-800/60' : 'border-gray-800/30 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {r.driver_name || 'Any driver'} · {r.parallel || 'any parallel'}{r.grade ? ` · ${r.grade}` : ''}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {r.max_price ? `< $${r.max_price}` : ''}
                  {r.max_percent_of_median ? ` < ${r.max_percent_of_median}% of median` : ''}
                  {r.ending_soon_only ? ' · <6h left' : ''}
                  {' · max '}{r.max_per_day}/day
                </div>
                <div className="text-[10px] text-gray-600 mt-1">
                  Last matched {timeAgo(lastMatched[r.id] || r.last_triggered_at)} · {matchCounts[r.id] || 0} total matches
                </div>
              </div>
              <button onClick={() => toggleRule(r)} title={r.active ? 'Pause' : 'Resume'} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400">
                {r.active ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button onClick={() => deleteRule(r)} title="Delete" className="p-2 rounded-lg hover:bg-red-900/40 text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
