import { useState } from 'react'
import { ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function ScoreListing() {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!url) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await fetch(`${API}/api/ai/score-listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ebay_url: url }),
      })
      const data = await r.json()
      if (data?.status === 'no_key') {
        setError(data.message || 'ANTHROPIC_API_KEY not configured')
      } else if (!r.ok) {
        setError(data?.detail || `HTTP ${r.status}`)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const score = result?.legitimacy_score
  const tier = score == null ? 'gray' : score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red'
  const tierCls = {
    green:  'text-green-400  border-green-800/40 bg-green-900/20',
    yellow: 'text-yellow-300 border-yellow-800/40 bg-yellow-900/20',
    red:    'text-red-400    border-red-800/40 bg-red-900/20',
    gray:   'text-gray-400   border-gray-700 bg-gray-800/50',
  }[tier]

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-red-400" />
        <h1 className="page-title m-0">AI Listing Scorer</h1>
      </div>
      <p className="text-xs text-gray-500">
        Paste any eBay listing URL — Claude will evaluate it for legitimacy red flags.
      </p>

      <form onSubmit={submit} className="panel p-4 space-y-3">
        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">eBay URL</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://www.ebay.com/itm/..."
          required
          className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-red-500 outline-none"
        />
        <button
          disabled={busy}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg"
        >
          {busy ? 'Scoring…' : 'Score Listing'}
        </button>
      </form>

      {error && (
        <div className="panel p-4 text-sm text-red-400 border-red-800/40">
          {error}
        </div>
      )}

      {result && (
        <div className="panel p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className={`w-20 h-20 rounded-full border-4 ${tierCls} flex items-center justify-center text-2xl font-black`}>
              {score ?? '—'}
            </div>
            <div className="flex-1">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-bold">Legitimacy Score</div>
              <div className="text-white font-semibold text-sm mt-1 line-clamp-2">{result.title || url}</div>
            </div>
            {tier === 'green' ? <ShieldCheck className="text-green-400" size={32} /> : <ShieldAlert className="text-red-400" size={32} />}
          </div>

          <p className="text-sm text-gray-300 leading-relaxed">{result.summary}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Red flags</h3>
              {result.red_flags?.length ? (
                <ul className="space-y-1 text-xs text-red-200">
                  {result.red_flags.map((f, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{f}</span></li>)}
                </ul>
              ) : (
                <p className="text-xs text-gray-600 italic">None detected.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-2">Green flags</h3>
              {result.green_flags?.length ? (
                <ul className="space-y-1 text-xs text-green-200">
                  {result.green_flags.map((f, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{f}</span></li>)}
                </ul>
              ) : (
                <p className="text-xs text-gray-600 italic">None noted.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
