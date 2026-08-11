import { useState, useRef } from 'react'
import { Camera, Upload, X, Sparkles, Check, AlertTriangle, Flag } from 'lucide-react'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const API = import.meta.env.VITE_API_URL || ''

// Confidence -> tailwind color classes + label
function confidenceStyle(conf) {
  const c = typeof conf === 'number' ? conf : 0
  if (c >= 0.8) return { cls: 'bg-green-900/40 text-green-300 border-green-700/60', label: 'HIGH' }
  if (c >= 0.6) return { cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/60', label: 'MED' }
  return { cls: 'bg-red-900/40 text-red-300 border-red-700/60', label: 'LOW' }
}

function ConfBadge({ label, conf }) {
  const s = confidenceStyle(conf)
  const pct = Math.round((conf || 0) * 100)
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${s.cls}`}>
      {label}: {pct}% {s.label === 'LOW' && <AlertTriangle size={10} />}
    </span>
  )
}

// Log scan correction to localStorage for later analysis
function logCorrection(entry) {
  try {
    const key = 'cc_scan_corrections'
    const prev = JSON.parse(localStorage.getItem(key) || '[]')
    prev.push({ ...entry, ts: Date.now() })
    // Keep last 200 to avoid unbounded growth
    const trimmed = prev.slice(-200)
    localStorage.setItem(key, JSON.stringify(trimmed))
  } catch (_) { /* ignore quota errors */ }
}

export default function ScanCardModal({ open, onClose, onSaved }) {
  const { user } = useAuth()
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({
    driver_name: '', parallel: '', card_number: '', grade: '',
    purchase_price: '', notes: '',
  })
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState({ driver: '', parallel: '', comment: '' })
  const [feedbackSent, setFeedbackSent] = useState(false)
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)

  const reset = () => {
    // Revoke before dropping the reference — object URLs otherwise pin the
    // decoded blob in memory for the tab's lifetime. Scanning many cards in
    // one session without this leaks a full-res image per scan.
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setFile(null); setScanResult(null)
    setForm({ driver_name: '', parallel: '', card_number: '', grade: '', purchase_price: '', notes: '' })
    setError(null)
    setFeedbackOpen(false); setFeedback({ driver: '', parallel: '', comment: '' }); setFeedbackSent(false)
  }

  const close = () => { reset(); onClose() }

  const handleFile = (f) => {
    if (!f) return
    setFile(f)
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
    setError(null)
    setScanResult(null)
  }

  const runScan = async () => {
    if (!file) return
    setScanning(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const r = await fetch(`${API}/api/ai/scan-card`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`Scan failed: ${r.status}`)
      const data = await r.json()
      setScanResult(data)
      // Pre-fill with first guess
      const firstGuess = data.top_guesses?.[0] || data
      setForm({
        driver_name: firstGuess.driver_name || '',
        parallel: firstGuess.parallel || '',
        card_number: data.card_number || '',
        grade: firstGuess.predicted_grade != null ? `PSA ${firstGuess.predicted_grade}` : '',
        purchase_price: '',
        notes: firstGuess.notes || data.reasoning || '',
      })
    } catch (e) {
      setError(e.message || 'Scan error')
    } finally {
      setScanning(false)
    }
  }

  const save = async () => {
    if (!user || !supabaseReady) { setError('Sign in required'); return }
    setSaving(true); setError(null)
    try {
      // Photo upload is best-effort — if the `card-photos` bucket is missing or
      // permission-denied, we still save the scanned metadata so the card lands
      // in the user's collection instead of blocking the whole save.
      let photo_url = null
      let photoWarning = null
      if (file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${user.id}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('card-photos').upload(path, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        })
        if (upErr) {
          photoWarning = /bucket/i.test(upErr.message || '')
            ? 'Saved without photo — create a "card-photos" storage bucket in Supabase to enable image uploads.'
            : `Saved without photo — ${upErr.message}`
        } else {
          const { data: pub } = supabase.storage.from('card-photos').getPublicUrl(path)
          photo_url = pub?.publicUrl || null
        }
      }
      const row = {
        user_id: user.id,
        driver_name: form.driver_name || null,
        parallel: form.parallel || null,
        grade: form.grade || null,
        card_number: form.card_number || null,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        notes: form.notes || null,
        photo_url,
        ai_scan_json: scanResult || null,
      }
      const { error: insErr } = await supabase.from('user_portfolio').insert(row)
      if (insErr) {
        // Schema-cache error means the user_portfolio table doesn't exist on
        // this Supabase project yet — surface a clearer prompt.
        if (/schema cache|does not exist|relation.*user_portfolio/i.test(insErr.message || '')) {
          throw new Error('Collection table missing — create the user_portfolio table in your Supabase project (see /setup docs).')
        }
        throw insErr
      }
      if (photoWarning) setError(photoWarning)
      onSaved?.()
      if (!photoWarning) close()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400" />
            <h2 className="text-white font-bold text-sm">Scan card with AI</h2>
          </div>
          <button onClick={close} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          {!previewUrl && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraRef.current?.click()}
                className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl flex flex-col items-center gap-2"
              >
                <Camera size={24} />
                <span className="text-sm">Take photo</span>
              </button>
              <button
                onClick={() => uploadRef.current?.click()}
                className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-4 rounded-xl flex flex-col items-center gap-2"
              >
                <Upload size={24} />
                <span className="text-sm">Upload</span>
              </button>
              <input
                ref={cameraRef} type="file" accept="image/*" capture="environment"
                className="hidden" onChange={e => handleFile(e.target.files?.[0])}
              />
              <input
                ref={uploadRef} type="file" accept="image/*"
                className="hidden" onChange={e => handleFile(e.target.files?.[0])}
              />
            </div>
          )}

          {previewUrl && (
            <div className="relative">
              <img src={previewUrl} alt="card" className="w-full max-h-64 object-contain rounded-lg bg-black" />
              <button
                onClick={reset}
                className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 rounded-full"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {previewUrl && !scanResult && (
            <button
              onClick={runScan} disabled={scanning}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
            >
              <Sparkles size={16} />
              {scanning ? 'Scanning…' : 'Scan with AI'}
            </button>
          )}

          {scanResult && (
            <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-purple-300 font-bold text-xs">
                <Check size={12} /> Detected:
              </div>
              {scanResult.top_guesses && scanResult.top_guesses.length > 0 ? (
                <div className="space-y-2">
                  {scanResult.top_guesses.map((guess, i) => {
                    const isTopGuess = i === 0
                    const cd = guess.confidence_driver ?? guess.confidence ?? 0
                    const cp = guess.confidence_parallel ?? guess.confidence ?? 0
                    const lowConf = cd < 0.6 || cp < 0.6
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setForm({
                            ...form,
                            driver_name: guess.driver_name || '',
                            parallel: guess.parallel || '',
                            grade: guess.predicted_grade != null ? `PSA ${guess.predicted_grade}` : '',
                          })
                        }}
                        className={`w-full text-left rounded-lg p-3 transition-colors border-2 ${
                          isTopGuess
                            ? 'bg-green-900/20 border-green-600/60 hover:bg-green-900/30'
                            : 'bg-gray-800/50 hover:bg-gray-800 border-gray-700/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-white">
                              {guess.driver_name || '?'} {guess.parallel && `· ${guess.parallel}`}
                              {guess.print_run && <span className="ml-1 text-gray-400">{guess.print_run}</span>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              <ConfBadge label="Driver" conf={cd} />
                              <ConfBadge label="Parallel" conf={cp} />
                            </div>
                            {guess.predicted_grade != null && (
                              <div className="text-[10px] text-gray-300 mt-1.5">
                                Grade: PSA {guess.predicted_grade}
                                <span className="ml-1 font-semibold text-green-400">({guess.grade_confidence ? Math.round((guess.grade_confidence || 0) * 100) : '?'}% conf)</span>
                              </div>
                            )}
                            {guess.notes && (
                              <div className="text-[10px] text-gray-400 italic mt-1.5 leading-snug">
                                {guess.notes}
                              </div>
                            )}
                            {lowConf && isTopGuess && (
                              <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-900/30 border border-red-800/50 px-1.5 py-0.5 rounded">
                                <AlertTriangle size={10} /> Verify manually
                              </div>
                            )}
                          </div>
                          {isTopGuess && (
                            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-green-400">Top</span>
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-500">
                  {scanResult.driver_name && <div><span className="text-gray-500">Driver:</span> <span className="text-white">{scanResult.driver_name}</span></div>}
                  {scanResult.parallel && <div><span className="text-gray-500">Parallel:</span> <span className="text-white">{scanResult.parallel}</span></div>}
                  {scanResult.card_number && <div><span className="text-gray-500">Number:</span> <span className="text-white">{scanResult.card_number}</span></div>}
                  {scanResult.predicted_grade != null && (
                    <div><span className="text-gray-500">Predicted grade:</span> <span className="text-white">PSA {scanResult.predicted_grade}</span> <span className="text-gray-600">({Math.round((scanResult.confidence || 0) * 100)}% conf)</span></div>
                  )}
                </div>
              )}
              {scanResult.card_number && <div className="text-xs"><span className="text-gray-500">Number:</span> <span className="text-white">{scanResult.card_number}</span></div>}
              {scanResult.reasoning && (
                <div className="text-[10px] text-gray-400 italic leading-snug border-t border-purple-800/40 pt-2">
                  <span className="text-purple-300 font-bold not-italic">Model notes: </span>
                  {scanResult.reasoning}
                </div>
              )}

              {/* Feedback loop */}
              <div className="border-t border-purple-800/40 pt-2">
                {!feedbackOpen && !feedbackSent && (
                  <button
                    onClick={() => {
                      const top = scanResult.top_guesses?.[0] || scanResult
                      setFeedback({
                        driver: top.driver_name || '',
                        parallel: top.parallel || '',
                        comment: '',
                      })
                      setFeedbackOpen(true)
                    }}
                    className="text-[11px] text-gray-400 hover:text-white inline-flex items-center gap-1"
                  >
                    <Flag size={11} /> Wrong? Report correct identification
                  </button>
                )}
                {feedbackSent && (
                  <div className="text-[11px] text-green-400 inline-flex items-center gap-1">
                    <Check size={11} /> Thanks — feedback logged locally
                  </div>
                )}
                {feedbackOpen && !feedbackSent && (
                  <div className="space-y-2 bg-gray-900/60 border border-gray-800 rounded-lg p-2">
                    <div className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Correct identification:</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Correct driver" value={feedback.driver} onChange={v => setFeedback({ ...feedback, driver: v })} />
                      <Field label="Correct parallel" value={feedback.parallel} onChange={v => setFeedback({ ...feedback, parallel: v })} />
                    </div>
                    <Field label="Notes (optional)" value={feedback.comment} onChange={v => setFeedback({ ...feedback, comment: v })} textarea />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const top = scanResult.top_guesses?.[0] || scanResult
                          logCorrection({
                            model_driver: top.driver_name || null,
                            model_parallel: top.parallel || null,
                            model_confidence_driver: top.confidence_driver ?? null,
                            model_confidence_parallel: top.confidence_parallel ?? null,
                            correct_driver: feedback.driver || null,
                            correct_parallel: feedback.parallel || null,
                            comment: feedback.comment || null,
                          })
                          setFeedbackSent(true)
                          setFeedbackOpen(false)
                        }}
                        className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-1.5 rounded"
                      >
                        Submit correction
                      </button>
                      <button
                        onClick={() => setFeedbackOpen(false)}
                        className="px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold py-1.5 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {(previewUrl || scanResult) && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Driver" value={form.driver_name} onChange={v => setForm({ ...form, driver_name: v })} />
                <Field label="Parallel" value={form.parallel} onChange={v => setForm({ ...form, parallel: v })} />
                <Field label="Card #" value={form.card_number} onChange={v => setForm({ ...form, card_number: v })} />
                <Field label="Grade" value={form.grade} onChange={v => setForm({ ...form, grade: v })} />
                <Field label="Paid $" type="number" value={form.purchase_price} onChange={v => setForm({ ...form, purchase_price: v })} />
              </div>
              <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} textarea />
            </div>
          )}

          {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 px-3 py-2 rounded-lg">{error}</div>}

          {(previewUrl || scanResult) && (
            <button
              onClick={save} disabled={saving}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {saving ? 'Saving…' : 'Save to my collection'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', textarea = false }) {
  const Cmp = textarea ? 'textarea' : 'input'
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500 font-semibold uppercase">{label}</span>
      <Cmp
        type={type} value={value || ''} onChange={e => onChange(e.target.value)}
        rows={textarea ? 2 : undefined}
        className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs focus:border-red-500 focus:outline-none"
      />
    </label>
  )
}
