import { useState, useEffect } from 'react'
import { Upload, Sparkles, AlertCircle, X } from 'lucide-react'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const API = import.meta.env.VITE_API_URL || ''

function median(nums) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

function ScannedCards() {
  const { user, loading: authLoading } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [comps, setComps] = useState({})

  useEffect(() => {
    if (authLoading) return
    if (!supabaseReady || !user) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('user_portfolio')
        .select('*')
        .order('created_at', { ascending: false })
      if (cancelled) return
      setCards(data || [])
      setLoading(false)
      for (const c of (data || [])) {
        const params = new URLSearchParams()
        if (c.driver_name) params.set('driver', c.driver_name)
        if (c.parallel) params.set('parallel', c.parallel)
        if (c.grade) params.set('grade', c.grade)
        params.set('limit', '50')
        try {
          const r = await fetch(`${API}/api/sales?${params}`)
          if (!r.ok) continue
          const d = await r.json()
          const rows = Array.isArray(d) ? d : (d.results || d.sales || [])
          const prices = rows.map(x => Number(x.price ?? x.sold_price)).filter(Boolean)
          const med = median(prices)
          if (!cancelled) setComps(prev => ({ ...prev, [c.id]: { med, n: prices.length } }))
        } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [user, authLoading])

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-1 h-6 bg-cyan-500 rounded-full shrink-0" />
        <h2 className="text-lg font-black text-white tracking-tight">🗂 Your Scanned Cards</h2>
      </div>

      {authLoading || loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : !supabaseReady || !user ? (
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
          <a href="/login" className="text-cyan-400 hover:text-cyan-300 font-semibold">Sign in</a> to view your cards.
        </div>
      ) : cards.length === 0 ? (
        <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
          No scans yet — go to <a href="/my-cards" className="text-cyan-400 hover:text-cyan-300 font-semibold">My Cards</a> to scan your first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map(c => {
            const comp = comps[c.id]
            const est = comp?.med
            return (
              <div key={c.id} className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3 flex gap-3">
                {c.photo_url ? (
                  <img src={c.photo_url} alt="" className="w-20 h-28 object-cover rounded bg-gray-800 shrink-0" />
                ) : (
                  <div className="w-20 h-28 rounded bg-gray-800 shrink-0" />
                )}
                <div className="min-w-0 flex-1 text-xs">
                  <div className="font-bold text-white truncate">{c.driver_name || '—'}</div>
                  <div className="text-gray-400 truncate">
                    {c.parallel || 'Base'}{c.grade ? ` · PSA ${c.grade}` : ''}
                  </div>
                  <div className="mt-2 text-gray-300">
                    Comp median: {est ? `$${Math.round(est)}` : '—'}
                    {comp?.n ? <span className="text-gray-500"> (n={comp.n})</span> : null}
                  </div>
                  <div className="text-gray-300">Est. value: {est ? `$${Math.round(est)}` : '—'}</div>
                  <div className="text-gray-500">Your paid: {c.purchase_price != null ? `$${Number(c.purchase_price).toFixed(0)}` : '—'}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function GradePredictor() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setResult(null); setErr('')
    const r = new FileReader()
    r.onload = () => setPreview(r.result)
    r.readAsDataURL(f)
  }

  const predict = async () => {
    if (!file) return
    setBusy(true); setErr(''); setResult(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch(`${API}/api/ai/grade`, { method: 'POST', body: form })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || d.error || `HTTP ${res.status}`)
      setResult(d)
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  const grade = result?.predicted_grade
  const gradeColor = grade >= 9.5 ? 'text-emerald-400' : grade >= 8 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-fuchsia-500 rounded-full shrink-0" />
          <h1 className="text-2xl font-black text-white tracking-tight">AI Grade Predictor</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-900/30 text-fuchsia-300 border border-fuchsia-800/40 uppercase font-bold">Beta</span>
        </div>
        <p className="text-xs text-gray-500 mt-2 ml-4">Upload a card photo — Claude Haiku predicts likely PSA grade based on visible condition</p>
      </div>

      <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-5 space-y-4">
        {!preview ? (
          <label className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-gray-700 hover:border-fuchsia-600 rounded-xl cursor-pointer bg-gray-800/20 transition-colors">
            <Upload size={28} className="text-gray-500 mb-2" />
            <span className="text-sm text-gray-300 font-semibold">Choose card image</span>
            <span className="text-[11px] text-gray-600 mt-1">JPG / PNG · front of card · well-lit</span>
            <input type="file" accept="image/*" onChange={onFile} className="hidden" />
          </label>
        ) : (
          <div className="relative">
            <button
              onClick={() => { setFile(null); setPreview(null); setResult(null) }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-gray-900/80 hover:bg-gray-800 text-gray-400 hover:text-white"
            >
              <X size={14} />
            </button>
            <img src={preview} alt="preview" className="w-full rounded-xl border border-gray-800 max-h-96 object-contain bg-black" />
          </div>
        )}

        {preview && !result && (
          <button
            onClick={predict}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-sm font-black flex items-center justify-center gap-2"
          >
            <Sparkles size={14} /> {busy ? 'Analyzing with Claude…' : 'Predict Grade'}
          </button>
        )}

        {err && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <div>{err}</div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-fuchsia-950/40 to-purple-950/40 border border-fuchsia-600/40 rounded-2xl p-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 font-bold">Predicted PSA Grade</div>
                  <div className={`text-6xl font-black ${gradeColor} tabular-nums mt-1`}>{grade ?? '—'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Confidence</div>
                  <div className="text-3xl font-black text-white">{result.confidence ? `${Math.round(result.confidence * 100)}%` : '—'}</div>
                </div>
              </div>
            </div>

            {result.reasoning && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1.5">Reasoning</div>
                <div className="text-sm text-gray-300 leading-relaxed">{result.reasoning}</div>
              </div>
            )}

            {result.issues?.length > 0 && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">Issues Detected</div>
                <ul className="text-sm text-gray-300 space-y-1">
                  {result.issues.map((i, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-amber-400">•</span>
                      <span>{i}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={() => { setFile(null); setPreview(null); setResult(null) }}
              className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold"
            >
              Grade another card
            </button>
          </div>
        )}
      </div>

      <div className="text-[10px] text-gray-600 leading-relaxed">
        Note: This is an AI estimate based on visible condition in your photo. Actual PSA grades depend on factors invisible in photos (surface depth, back condition, exact centering measurements). Use as a rough guide only.
      </div>

      <ScannedCards />
    </div>
  )
}
