import { useState, useRef } from 'react'
import { Camera, Upload, X, Sparkles, Check } from 'lucide-react'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)

  const reset = () => {
    setFile(null); setPreviewUrl(null); setScanResult(null)
    setForm({ driver_name: '', parallel: '', card_number: '', grade: '', purchase_price: '', notes: '' })
    setError(null)
  }

  const close = () => { reset(); onClose() }

  const handleFile = (f) => {
    if (!f) return
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
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
      setForm({
        driver_name: data.driver_name || '',
        parallel: data.parallel || '',
        card_number: data.card_number || '',
        grade: data.predicted_grade != null ? `PSA ${data.predicted_grade}` : '',
        purchase_price: '',
        notes: data.reasoning || '',
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
      let photo_url = null
      if (file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${user.id}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('card-photos').upload(path, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('card-photos').getPublicUrl(path)
        photo_url = pub?.publicUrl || null
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
      if (insErr) throw insErr
      onSaved?.()
      close()
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
            <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div className="flex items-center gap-1.5 text-purple-300 font-bold">
                <Check size={12} /> Detected:
              </div>
              {scanResult.driver_name && <div><span className="text-gray-500">Driver:</span> <span className="text-white">{scanResult.driver_name}</span></div>}
              {scanResult.parallel && <div><span className="text-gray-500">Parallel:</span> <span className="text-white">{scanResult.parallel}</span></div>}
              {scanResult.card_number && <div><span className="text-gray-500">Number:</span> <span className="text-white">{scanResult.card_number}</span></div>}
              {scanResult.predicted_grade != null && (
                <div><span className="text-gray-500">Predicted grade:</span> <span className="text-white">PSA {scanResult.predicted_grade}</span> <span className="text-gray-600">({Math.round((scanResult.confidence || 0) * 100)}% conf)</span></div>
              )}
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
