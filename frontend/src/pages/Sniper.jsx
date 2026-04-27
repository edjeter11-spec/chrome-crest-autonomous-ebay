import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Target, Trash2, Pause, Play, Plus, Link as LinkIcon, BellRing, Smartphone,
  AlertCircle, Edit2, Download, Upload, ChevronRight, ChevronLeft, Check, X,
  DollarSign, User as UserIcon, Sparkles, MoreHorizontal,
} from 'lucide-react'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ALL_PARALLELS, AUTO_VARIANTS } from '../lib/parallels'
import { pushSupported, isSubscribed, subscribePush } from '../lib/push'
import { usePageTitle } from '../lib/pageTitle'
import { teamColor as resolveTeamColor } from '../lib/teamColors'

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

  if (state === 'unsupported') return null

  // Soft confirmation when already subscribed (don't shout).
  if (state === 'on') {
    return (
      <div className="bg-emerald-900/15 border border-emerald-700/30 rounded-2xl p-3 mb-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-600/20 flex items-center justify-center shrink-0">
          <Check size={16} className="text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-emerald-200 text-sm">Push alerts on</div>
          <div className="text-[11px] text-emerald-300/70 mt-0.5">We'll ping your phone the moment a card matches.</div>
        </div>
      </div>
    )
  }

  if (state === 'needs-install') {
    return (
      <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/30 border border-indigo-700/50 rounded-2xl p-5 mb-5 flex items-start gap-3">
        <Smartphone size={22} className="text-indigo-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-black text-white text-sm">Install to enable push alerts</div>
          <div className="text-[11px] text-indigo-200/80 mt-1 leading-relaxed">iOS only allows push notifications when this site is added to your Home Screen. Tap the <span className="font-bold">Share</span> icon in Safari → <span className="font-bold">Add to Home Screen</span>, then open it from the new icon and come back here.</div>
        </div>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="bg-gradient-to-br from-amber-900/40 to-orange-900/30 border border-amber-700/50 rounded-2xl p-5 mb-5 flex items-start gap-3">
        <AlertCircle size={22} className="text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-black text-white text-sm">Notifications blocked</div>
          <div className="text-[11px] text-amber-200/80 mt-1">Re-enable in your browser/phone settings for this site, then refresh.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-rose-900/30 to-orange-900/20 border border-rose-700/40 rounded-2xl p-5 mb-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-rose-600/30 flex items-center justify-center shrink-0">
        <BellRing size={22} className="text-rose-200" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-black text-white text-base">Turn on alerts</div>
        <div className="text-xs text-rose-200/80 mt-0.5">{err || "We'll ping you the moment a match appears."}</div>
      </div>
      <button
        onClick={enable}
        disabled={state === 'busy' || state === 'checking'}
        className="min-h-[44px] px-5 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-black rounded-xl shrink-0"
      >
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

// Driver → team (lowercase) for color accent on rule cards.
const DRIVER_TO_TEAM = {
  'max verstappen': 'Red Bull', 'yuki tsunoda': 'Red Bull', 'sergio perez': 'Red Bull',
  'lewis hamilton': 'Ferrari', 'charles leclerc': 'Ferrari', 'carlos sainz': 'Williams',
  'lando norris': 'McLaren', 'oscar piastri': 'McLaren',
  'george russell': 'Mercedes', 'andrea kimi antonelli': 'Mercedes', 'valtteri bottas': 'Mercedes',
  'fernando alonso': 'Aston Martin', 'lance stroll': 'Aston Martin',
  'pierre gasly': 'Alpine', 'jack doohan': 'Alpine', 'esteban ocon': 'Haas',
  'oliver bearman': 'Haas', 'kevin magnussen': 'Haas', 'nico hulkenberg': 'Sauber',
  'gabriel bortoleto': 'Sauber', 'zhou guanyu': 'Sauber',
  'alexander albon': 'Williams', 'liam lawson': 'Racing Bulls',
  'isack hadjar': 'Racing Bulls',
}

const PRESETS = [
  { label: 'Verstappen Gold /50 < $250', rule: { driver_name: 'Max Verstappen', parallel: 'Gold /50', max_price: 250 } },
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

function ruleTeamColor(rule) {
  if (!rule?.driver_name) return null
  const team = DRIVER_TO_TEAM[rule.driver_name.toLowerCase()]
  return team ? resolveTeamColor(team) : null
}

// Visual rule card — replaces the old table-row layout.
function RuleCard({ rule, matchCount, lastMatched, onEdit, onToggle, onDelete }) {
  const accent = ruleTeamColor(rule)
  const chips = []
  if (rule.driver_name) chips.push({ label: rule.driver_name, kind: 'driver' })
  else chips.push({ label: 'Any driver', kind: 'muted' })
  if (rule.parallel) chips.push({ label: rule.parallel, kind: 'parallel' })
  if (rule.grade) chips.push({ label: rule.grade, kind: 'grade' })
  if (rule.max_price) chips.push({ label: `≤ $${rule.max_price}`, kind: 'price' })
  if (rule.max_percent_of_median) chips.push({ label: `≤ ${rule.max_percent_of_median}% of median`, kind: 'price' })
  if (rule.ending_soon_only) chips.push({ label: '<6h left', kind: 'soon' })

  const chipClass = (kind) => {
    switch (kind) {
      case 'driver':   return 'bg-white/10 text-white border-white/20'
      case 'parallel': return 'bg-yellow-900/30 text-yellow-200 border-yellow-700/40'
      case 'grade':    return 'bg-purple-900/30 text-purple-200 border-purple-700/40'
      case 'price':    return 'bg-emerald-900/30 text-emerald-200 border-emerald-700/40'
      case 'soon':     return 'bg-orange-900/30 text-orange-200 border-orange-700/40'
      default:         return 'bg-gray-800/60 text-gray-400 border-gray-700/40'
    }
  }

  return (
    <div
      className={`relative bg-gradient-to-br from-gray-900 to-gray-950 border rounded-3xl p-5 overflow-hidden ${
        rule.active ? 'border-gray-800/80' : 'border-gray-800/40 opacity-60'
      }`}
    >
      {/* Team-color side bar accent */}
      {accent && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5"
          style={{ backgroundColor: accent }}
        />
      )}

      <div className="flex items-start justify-between gap-3 mb-3">
        {/* Status pill */}
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide border ${
            rule.active
              ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40'
              : 'bg-amber-900/30 text-amber-300 border-amber-700/40'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${rule.active ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {rule.active ? 'Active' : 'Paused'}
          </span>
          {(matchCount || 0) > 0 && (
            <span className="text-[11px] font-bold text-cyan-300 bg-cyan-900/20 border border-cyan-800/40 px-2 py-0.5 rounded-full">
              {matchCount} {matchCount === 1 ? 'hit' : 'hits'}
            </span>
          )}
        </div>
        <div className="text-[10px] text-gray-500 text-right shrink-0">
          Last match<br /><span className="text-gray-300 font-semibold">{timeAgo(lastMatched || rule.last_triggered_at)}</span>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {chips.map((c, i) => (
          <span
            key={i}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${chipClass(c.kind)}`}
          >
            {c.label}
          </span>
        ))}
      </div>

      {/* Big touch action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onEdit(rule)}
          className="min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 text-sm font-bold border border-blue-700/30"
        >
          <Edit2 size={14} /> Edit
        </button>
        <button
          onClick={() => onToggle(rule)}
          className="min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-800/80 hover:bg-gray-700 text-gray-200 text-sm font-bold border border-gray-700/40"
        >
          {rule.active ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
        </button>
        <button
          onClick={() => onDelete(rule)}
          className="min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-200 text-sm font-bold border border-red-700/30"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  )
}

export default function Sniper() {
  usePageTitle('Auto Bid')
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [rules, setRules] = useState([])
  const [matchCounts, setMatchCounts] = useState({})
  const [lastMatched, setLastMatched] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [driver, setDriver] = useState('')
  const [parallel, setParallel] = useState('')
  const [grade, setGrade] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [maxPct, setMaxPct] = useState('')
  const [endingSoon, setEndingSoon] = useState(false)
  const [maxPerDay, setMaxPerDay] = useState(3)
  const [discordEnabled, setDiscordEnabled] = useState(false)
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('')

  // Wizard step (1 = card, 2 = max bid, 3 = notify)
  const [step, setStep] = useState(1)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const [urlInput, setUrlInput] = useState('')
  const [urlResult, setUrlResult] = useState(null)
  const [urlLoading, setUrlLoading] = useState(false)

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  // Pre-fill form from URL params (coming from driver detail)
  useEffect(() => {
    const driverParam = searchParams.get('driver')
    const maxPriceParam = searchParams.get('maxPrice')
    const parallelParam = searchParams.get('parallel')
    const gradeParam = searchParams.get('grade')
    const endingSoonParam = searchParams.get('endingSoon')

    if (driverParam) { setDriver(driverParam); setWizardOpen(true) }
    if (maxPriceParam) setMaxPrice(maxPriceParam)
    if (parallelParam) setParallel(parallelParam)
    if (gradeParam) setGrade(gradeParam)
    if (endingSoonParam) setEndingSoon(true)
  }, [searchParams])

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
    setWizardOpen(true)
    setStep(1)
  }

  const createRule = async (e) => {
    e.preventDefault()
    setError('')
    if (!user) { setError('Sign in first'); return }
    // Max price / max % is now optional — leaving both blank means "alert on any match"
    setSaving(true)
    const trimmedWebhook = (discordWebhookUrl || '').trim()
    if (discordEnabled && trimmedWebhook && !trimmedWebhook.startsWith('https://discord.com/api/webhooks/')) {
      setSaving(false)
      setError('Discord webhook URL must start with https://discord.com/api/webhooks/')
      return
    }
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
      discord_enabled: !!discordEnabled,
      discord_webhook_url: discordEnabled ? (trimmedWebhook || null) : null,
    }

    if (editingId) {
      // Update existing rule
      const { error: err } = await supabase.from('user_snipe_rules').update(row).eq('id', editingId)
      setSaving(false)
      if (err) { setError(err.message); return }
    } else {
      // Create new rule
      const { error: err } = await supabase.from('user_snipe_rules').insert(row)
      setSaving(false)
      if (err) { setError(err.message); return }
    }

    setDriver(''); setParallel(''); setGrade(''); setMaxPrice(''); setMaxPct(''); setEndingSoon(false); setMaxPerDay(3); setEditingId(null)
    setDiscordEnabled(false); setDiscordWebhookUrl('')
    setWizardOpen(false); setStep(1)
    loadRules()
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setDriver(r.driver_name || '')
    setParallel(r.parallel || '')
    setGrade(r.grade || '')
    setMaxPrice(r.max_price ? String(r.max_price) : '')
    setMaxPct(r.max_percent_of_median ? String(r.max_percent_of_median) : '')
    setEndingSoon(r.ending_soon_only || false)
    setMaxPerDay(r.max_per_day || 3)
    setDiscordEnabled(!!r.discord_enabled)
    setDiscordWebhookUrl(r.discord_webhook_url || '')
    setError('')
    setWizardOpen(true)
    setStep(1)
    setTimeout(() => {
      document.getElementById('sniper-wizard')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDriver(''); setParallel(''); setGrade(''); setMaxPrice(''); setMaxPct(''); setEndingSoon(false); setMaxPerDay(3)
    setDiscordEnabled(false); setDiscordWebhookUrl('')
    setError('')
    setWizardOpen(false)
    setStep(1)
  }

  const toggleRule = async (r) => {
    await supabase.from('user_snipe_rules').update({ active: !r.active }).eq('id', r.id)
    loadRules()
  }
  const deleteRule = async (r) => {
    if (!confirm('Delete this rule? This cannot be undone.')) return
    await supabase.from('user_snipe_rules').delete().eq('id', r.id)
    if (editingId === r.id) cancelEdit()
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

  const exportRules = async () => {
    if (!user) return
    setExporting(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const r = await fetch(`${API}/api/sniper/rules/export`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await r.json()
      if (data.status === 'ok') {
        const json = JSON.stringify(data, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `sniper-rules-${new Date().toISOString().split('T')[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        setError('Export failed: ' + (data.message || 'unknown error'))
      }
    } catch (e) {
      setError('Export error: ' + String(e))
    }
    setExporting(false)
  }

  const importRules = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const rules = Array.isArray(data.rules) ? data.rules : Array.isArray(data) ? data : []

      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const r = await fetch(`${API}/api/sniper/rules/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rules }),
      })
      const result = await r.json()
      setImportResult(result)
      if (result.status === 'ok' || result.status === 'partial') {
        loadRules()
      }
    } catch (e) {
      setImportResult({ status: 'error', message: String(e) })
    }
    setImporting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Wizard navigation
  const canAdvanceFrom = (s) => {
    // No hard validation per step — the form itself is forgiving (everything optional).
    // Only block step 2 → 3 if both price fields are non-numeric garbage.
    return true
  }
  const goNext = () => { if (step < 3 && canAdvanceFrom(step)) setStep(step + 1) }
  const goBack = () => { if (step > 1) setStep(step - 1) }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-3xl font-black text-white flex items-center gap-2">
          <span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center shadow-lg">
            <Target size={20} className="text-white" />
          </span>
          Auto Bid
        </h1>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">
          Tell us which cards you want and your max price. We'll alert you the moment one shows up.
        </p>
      </div>

      <PushCTA />

      {/* Empty-state hero */}
      {!loading && rules.length === 0 && !wizardOpen && (
        <div className="bg-gradient-to-br from-red-900/20 via-gray-900 to-orange-900/15 border border-red-700/30 rounded-3xl p-8 text-center mb-6">
          <div className="text-5xl mb-4">🎯</div>
          <h2 className="text-2xl font-black text-white mb-3">Set up your first auto-bid</h2>
          <p className="text-sm text-gray-300 leading-relaxed max-w-md mx-auto mb-6">
            Tell us what cards you want and your max bid. We'll alert you when one shows up so you can grab it before someone else.
          </p>
          <button
            onClick={() => { setWizardOpen(true); setStep(1) }}
            className="min-h-[52px] inline-flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white text-base font-black rounded-2xl shadow-lg shadow-red-900/40"
          >
            <Plus size={18} /> Create my first auto-bid
          </button>

          {/* Friendly preset shortcuts */}
          <div className="mt-7 pt-6 border-t border-gray-800/60">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-3 flex items-center justify-center gap-1.5">
              <Sparkles size={12} /> Or start from a popular pick
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="min-h-[40px] px-3.5 py-2 rounded-full bg-gray-800/80 hover:bg-gray-700 text-xs font-semibold text-gray-200 border border-gray-700/50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* "Add new" button when user has rules and isn't editing */}
      {!loading && rules.length > 0 && !wizardOpen && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-white">Your auto-bids</h2>
          <button
            onClick={() => { setWizardOpen(true); setStep(1); setEditingId(null); cancelEditFields() }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white text-sm font-black rounded-xl shadow-md"
          >
            <Plus size={16} /> New
          </button>
        </div>
      )}

      {/* Wizard */}
      {wizardOpen && (
        <div
          id="sniper-wizard"
          className={`bg-gradient-to-br from-gray-900 to-gray-950 rounded-3xl p-5 md:p-6 mb-6 border ${
            editingId ? 'border-blue-700/50' : 'border-red-700/40'
          } shadow-xl`}
        >
          {/* Wizard header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${editingId ? 'bg-blue-600/20' : 'bg-red-600/20'}`}>
                {editingId ? <Edit2 size={16} className="text-blue-300" /> : <Target size={16} className="text-red-300" />}
              </div>
              <div>
                <div className="text-base font-black text-white">{editingId ? 'Edit auto-bid' : 'New auto-bid'}</div>
                <div className="text-[11px] text-gray-500">Step {step} of 3</div>
              </div>
            </div>
            <button
              onClick={cancelEdit}
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <X size={18} />
            </button>
          </div>

          {/* Stepper bar */}
          <div className="flex gap-1.5 mb-6">
            {[1, 2, 3].map(n => (
              <div
                key={n}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  n <= step ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gray-800'
                }`}
              />
            ))}
          </div>

          <form onSubmit={createRule}>
            {/* STEP 1 — Which card? */}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
                    <UserIcon size={18} className="text-red-400" /> Which card?
                  </h3>
                  <p className="text-xs text-gray-400">Pick a driver and parallel, or leave blank to match anything.</p>
                </div>

                <label className="block">
                  <div className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Driver</div>
                  <select
                    value={driver}
                    onChange={e => setDriver(e.target.value)}
                    className="w-full min-h-[52px] bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 text-base text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="">Any driver</option>
                    {DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>

                <label className="block">
                  <div className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Parallel</div>
                  <select
                    value={parallel}
                    onChange={e => setParallel(e.target.value)}
                    className="w-full min-h-[52px] bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 text-base text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="">Any parallel</option>
                    <option value="Autograph">Autograph (any)</option>
                    {ALL_PARALLELS.filter(p => p !== 'Autograph').map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>

                {/* Auto-variant selector — only when Autograph picked */}
                {parallel === 'Autograph' && (
                  <div className="bg-yellow-900/15 border border-yellow-700/40 rounded-2xl p-4">
                    <div className="text-[11px] font-black text-yellow-300 uppercase tracking-wider mb-2.5">Auto parallel type</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['Any', ...AUTO_VARIANTS.filter(v => v !== 'Any')].map(v => {
                        const target = v === 'Any' ? 'Autograph' : v
                        const active = parallel === target || (v === 'Any' && parallel === 'Autograph')
                        return (
                          <button
                            type="button"
                            key={v}
                            onClick={() => setParallel(target)}
                            className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              active ? 'bg-yellow-500 text-black border border-yellow-400' : 'bg-gray-800/60 text-gray-300 border border-transparent hover:border-gray-700/50'
                            }`}
                          >
                            {v === 'Any' ? 'Base Auto (any)' : `Auto · ${v}`}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <label className="block">
                  <div className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Grade <span className="text-gray-600 normal-case font-normal">(optional)</span></div>
                  <input
                    value={grade}
                    onChange={e => setGrade(e.target.value)}
                    placeholder="PSA 10, Raw, or leave blank"
                    className="w-full min-h-[52px] bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 text-base text-white focus:border-red-500 focus:outline-none"
                  />
                </label>
              </div>
            )}

            {/* STEP 2 — Max bid */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
                    <DollarSign size={18} className="text-emerald-400" /> Your max bid
                  </h3>
                  <p className="text-xs text-gray-400">We'll alert you when an auction is at or below this price.</p>
                </div>

                <label className="block">
                  <div className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Max price</div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-gray-500">$</span>
                    <input
                      type="number"
                      step="1"
                      value={maxPrice}
                      onChange={e => setMaxPrice(e.target.value)}
                      placeholder="Any price"
                      className="w-full min-h-[64px] bg-gray-800 border border-gray-700 rounded-2xl pl-10 pr-4 py-4 text-2xl font-black text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[50, 100, 250, 500, 1000].map(v => (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setMaxPrice(String(v))}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-gray-800/80 hover:bg-emerald-700/40 text-xs font-bold text-gray-300 border border-gray-700/50"
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                </label>

                <details className="bg-gray-800/40 rounded-2xl p-4 border border-gray-800">
                  <summary className="text-xs font-bold text-gray-300 uppercase tracking-wide cursor-pointer flex items-center gap-1.5">
                    <ChevronRight size={12} /> Advanced price options
                  </summary>
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">OR Max % of median</div>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={maxPct}
                        onChange={e => setMaxPct(e.target.value)}
                        placeholder="70 = alert if <70% of median"
                        className="w-full min-h-[44px] bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white"
                      />
                    </label>
                    <label className="block">
                      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Max alerts per day</div>
                      <input
                        type="number"
                        min="1"
                        value={maxPerDay}
                        onChange={e => setMaxPerDay(e.target.value)}
                        className="w-full min-h-[44px] bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white"
                      />
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-gray-200 min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={endingSoon}
                        onChange={e => setEndingSoon(e.target.checked)}
                        className="w-5 h-5"
                      />
                      Only alert when auction has &lt;6h left
                    </label>
                  </div>
                </details>
              </div>
            )}

            {/* STEP 3 — Notify */}
            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
                    <BellRing size={18} className="text-orange-400" /> Notify me how?
                  </h3>
                  <p className="text-xs text-gray-400">Push notifications are on by default. Add Discord if your crew wants the heads-up too.</p>
                </div>

                <div className="bg-emerald-900/15 border border-emerald-700/40 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600/30 flex items-center justify-center">
                    <BellRing size={18} className="text-emerald-300" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-black text-white">Push notification</div>
                    <div className="text-[11px] text-emerald-200/80">Always on — instant ping to your phone.</div>
                  </div>
                  <Check size={18} className="text-emerald-400" />
                </div>

                {/* Discord webhook (per-rule) */}
                <div className="bg-indigo-900/20 border border-indigo-700/40 rounded-2xl p-4 space-y-3">
                  <label className="flex items-center gap-2.5 text-sm text-indigo-100 font-bold min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={discordEnabled}
                      onChange={e => setDiscordEnabled(e.target.checked)}
                      className="w-5 h-5"
                    />
                    Also send to Discord
                  </label>
                  {discordEnabled && (
                    <>
                      <input
                        type="url"
                        value={discordWebhookUrl}
                        onChange={e => setDiscordWebhookUrl(e.target.value)}
                        placeholder="https://discord.com/api/webhooks/..."
                        className="w-full min-h-[44px] bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white"
                      />
                      <div className="text-[11px] text-indigo-300/70 leading-relaxed">
                        Get a webhook URL from your Discord server's channel settings → Integrations → Webhooks.
                      </div>
                    </>
                  )}
                </div>

                {/* Recap */}
                <div className="bg-gray-800/40 border border-gray-800 rounded-2xl p-4">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Summary</div>
                  <div className="text-sm text-gray-200 leading-relaxed">
                    Alert me when <span className="font-black text-white">{driver || 'any driver'}</span> appears
                    {parallel ? <> as <span className="font-black text-yellow-300">{parallel}</span></> : ''}
                    {grade ? <> graded <span className="font-black text-purple-300">{grade}</span></> : ''}
                    {maxPrice ? <> for <span className="font-black text-emerald-300">≤ ${maxPrice}</span></> : ''}
                    {maxPct ? <> at <span className="font-black text-emerald-300">&lt; {maxPct}% of median</span></> : ''}
                    {endingSoon ? ' with <6h left' : ''}.
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-900/30 border border-red-700/50 text-xs text-red-300">{error}</div>
            )}
            {!user && (
              <div className="mt-4 p-3 rounded-xl bg-gray-800/60 border border-gray-700 text-xs text-gray-400">Sign in to save rules.</div>
            )}

            {/* Wizard nav */}
            <div className="mt-6 flex gap-2">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="min-h-[52px] flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-gray-800 hover:bg-gray-700 text-white text-base font-bold"
                >
                  <ChevronLeft size={18} /> Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="min-h-[52px] flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-gray-800 hover:bg-gray-700 text-white text-base font-bold"
                >
                  Cancel
                </button>
              )}
              {step < 3 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="min-h-[52px] flex-[2] flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white text-base font-black shadow-lg"
                >
                  Next <ChevronRight size={18} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving || !user}
                  className={`min-h-[52px] flex-[2] flex items-center justify-center gap-1.5 py-3 rounded-2xl text-white text-base font-black shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                    editingId
                      ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400'
                      : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400'
                  }`}
                >
                  <Check size={18} /> {saving ? 'Saving…' : editingId ? 'Update auto-bid' : 'Save auto-bid'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
      ) : rules.length > 0 ? (
        <div className="space-y-3">
          {rules.map(r => (
            <RuleCard
              key={r.id}
              rule={r}
              matchCount={matchCounts[r.id]}
              lastMatched={lastMatched[r.id]}
              onEdit={startEdit}
              onToggle={toggleRule}
              onDelete={deleteRule}
            />
          ))}
        </div>
      ) : null}

      {/* Import result toast */}
      {importResult && (
        <div className={`mt-5 p-4 rounded-2xl text-sm ${
          importResult.status === 'error'
            ? 'bg-red-900/30 border border-red-700/50 text-red-300'
            : importResult.status === 'ok'
            ? 'bg-green-900/30 border border-green-700/50 text-green-300'
            : 'bg-yellow-900/30 border border-yellow-700/50 text-yellow-300'
        }`}>
          <div className="font-black">{importResult.status === 'ok' ? 'Import successful' : importResult.status === 'partial' ? 'Import partial' : 'Import failed'}</div>
          {importResult.created > 0 && <div className="mt-1">Created {importResult.created} rule(s)</div>}
          {importResult.errors?.length > 0 && (
            <div className="mt-2 opacity-80 text-xs">
              {importResult.errors.slice(0, 3).map((e, i) => <div key={i}>{e}</div>)}
              {importResult.errors.length > 3 && <div>… and {importResult.errors.length - 3} more</div>}
            </div>
          )}
        </div>
      )}

      {/* Power-user "More" disclosure — pinned at bottom */}
      <div className="mt-8 pt-6 border-t border-gray-800/60">
        <button
          onClick={() => setShowMore(s => !s)}
          className="min-h-[44px] w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gray-900/50 hover:bg-gray-800/60 text-sm font-bold text-gray-400 hover:text-gray-200 border border-gray-800/60"
        >
          <MoreHorizontal size={16} />
          {showMore ? 'Hide advanced tools' : 'More tools'}
        </button>

        {showMore && (
          <div className="mt-4 space-y-4">
            {/* Paste URL */}
            <div className="bg-gray-900 border border-gray-800/60 rounded-2xl p-5">
              <div className="text-xs font-black text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <LinkIcon size={14} /> Test an eBay listing
              </div>
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onBlur={checkUrl}
                placeholder="https://www.ebay.com/itm/..."
                className="w-full min-h-[44px] bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white"
              />
              {urlLoading && <div className="text-xs text-gray-500 mt-2">Checking…</div>}
              {urlResult && (
                <div className="mt-3 text-xs">
                  {urlResult.status === 'ok' ? (
                    <>
                      <div className="text-gray-400 mb-1">{urlResult.auction?.title}</div>
                      {urlResult.matches?.filter(m => m.matched).length > 0 ? (
                        <div className="text-green-400 font-bold">Matches {urlResult.matches.filter(m => m.matched).length} rule(s)</div>
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

            {/* Import / Export */}
            <div className="bg-gray-900 border border-gray-800/60 rounded-2xl p-5">
              <div className="text-xs font-black text-gray-300 uppercase tracking-wider mb-3">Backup &amp; restore</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={exportRules}
                  disabled={exporting || !user || rules.length === 0}
                  className="min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-bold border border-gray-700/50 disabled:opacity-50"
                >
                  <Download size={14} /> {exporting ? 'Exporting…' : 'Export'}
                </button>
                <label className="min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-bold border border-gray-700/50 cursor-pointer">
                  <Upload size={14} /> {importing ? 'Importing…' : 'Import'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={importRules}
                    disabled={importing || !user}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // Local helper — wipe form fields without touching wizardOpen
  function cancelEditFields() {
    setDriver(''); setParallel(''); setGrade(''); setMaxPrice(''); setMaxPct(''); setEndingSoon(false); setMaxPerDay(3)
    setDiscordEnabled(false); setDiscordWebhookUrl('')
    setError('')
  }
}
