import { useState } from 'react'
import { X, Upload, FileText, AlertCircle, Check } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

// Very lightweight CSV parser — handles quoted fields with commas.
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return { headers: [], rows: [] }
  const parseLine = (line) => {
    const out = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (c === ',' && !inQ) {
        out.push(cur); cur = ''
      } else cur += c
    }
    out.push(cur)
    return out.map(s => s.trim())
  }
  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l)
    const o = {}
    headers.forEach((h, i) => { o[h] = vals[i] ?? '' })
    return o
  })
  return { headers, rows }
}

export default function CSVImportModal({ onClose, onImported }) {
  const [rows, setRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { headers, rows } = parseCSV(String(reader.result || ''))
        setHeaders(headers); setRows(rows); setErr('')
        if (!rows.length) setErr('CSV has no data rows')
      } catch (ex) {
        setErr('Could not parse CSV: ' + ex.message)
      }
    }
    reader.readAsText(file)
  }

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${API}/api/portfolio/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResult(await res.json())
      onImported?.()
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Upload size={18} className="text-blue-400" />
            <h3 className="text-lg font-black text-white">Bulk Import CSV</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {!result ? (
            <>
              <div className="text-xs text-gray-400 mb-3">
                Expected columns: <span className="font-mono text-gray-300">driver, parallel, grade, purchase_price, quantity, purchase_date, notes</span>
              </div>
              <div className="text-[11px] text-gray-500 mb-4">
                Only <span className="font-bold">driver</span> is required. <span className="font-mono">purchase_date</span> accepts YYYY-MM-DD.
              </div>

              <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-gray-700 hover:border-blue-600 rounded-xl bg-gray-800/30 cursor-pointer transition-colors">
                <FileText size={16} className="text-gray-400" />
                <span className="text-sm text-gray-300">
                  {rows.length ? `${rows.length} rows loaded · ${headers.length} columns` : 'Choose CSV file'}
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
              </label>

              {err && (
                <div className="mt-3 flex items-center gap-2 text-xs text-red-400">
                  <AlertCircle size={12} /> {err}
                </div>
              )}

              {rows.length > 0 && (
                <div className="mt-4 bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                    Preview (first 5)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr>
                          {headers.map(h => (
                            <th key={h} className="px-2 py-1.5 text-left text-gray-500 font-bold border-b border-gray-800">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 5).map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/60">
                            {headers.map(h => (
                              <td key={h} className="px-2 py-1 text-gray-300 truncate max-w-[140px]">{r[h]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <Check size={32} className="mx-auto text-emerald-400 mb-3" />
              <div className="text-lg font-black text-white">Import complete</div>
              <div className="text-sm text-gray-400 mt-1">
                <span className="text-emerald-400 font-bold">{result.inserted}</span> inserted ·{' '}
                <span className="text-amber-400">{result.skipped}</span> skipped
              </div>
              {result.errors?.length > 0 && (
                <div className="mt-4 bg-gray-800/40 border border-gray-700 rounded-xl p-3 text-left text-xs">
                  <div className="font-bold text-red-400 mb-2">Errors:</div>
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-gray-400">{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex gap-2 justify-end">
          {!result ? (
            <>
              <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button
                onClick={submit}
                disabled={busy || !rows.length}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold"
              >
                {busy ? 'Importing…' : `Import ${rows.length} rows`}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
