import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { verdictFor } from '../lib/verdict'

const API = import.meta.env.VITE_API_URL || ''

export default function EmbedPrice() {
  const [params] = useSearchParams()
  const driver = params.get('driver') || ''
  const parallel = params.get('parallel') || ''
  const grade = params.get('grade') || ''

  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!driver) { setErr('missing driver'); return }
    const q = new URLSearchParams()
    q.set('driver', driver)
    if (parallel) q.set('parallel', parallel)
    if (grade) q.set('grade', grade)
    q.set('days', '90')
    q.set('limit', '50')
    fetch(`${API}/api/sales?${q.toString()}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const sales = d.sales || []
        if (!sales.length) { setData({ median: null, count: 0 }); return }
        const prices = sales.map(s => (s.sale_price || 0) + (s.shipping_cost || 0)).filter(Boolean).sort((a,b) => a-b)
        const median = prices[Math.floor(prices.length / 2)]
        setData({ median, count: prices.length })
      })
      .catch(() => setErr('failed'))
  }, [driver, parallel, grade])

  const verdict = data?.median ? verdictFor(data.median, data.median, data.count) : null

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#111827',
      color: '#fff',
      padding: '8px 12px',
      borderRadius: 10,
      width: 300,
      height: 80,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      border: '1px solid #374151',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 800, letterSpacing: 0.8 }}>
        <span style={{ width: 6, height: 6, background: '#ef4444', borderRadius: '50%' }} />
        F1 Card Vault
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {driver}{parallel && <span style={{ color: '#67e8f9', marginLeft: 6 }}>{parallel}</span>}
        {grade && grade !== 'Raw' && <span style={{ color: '#fbbf24', marginLeft: 6, fontSize: 10 }}>{grade}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        {err ? (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>—</span>
        ) : !data ? (
          <span style={{ fontSize: 12, color: '#6b7280' }}>loading…</span>
        ) : data.median == null ? (
          <span style={{ fontSize: 12, color: '#6b7280' }}>no comps</span>
        ) : (
          <>
            <span style={{ fontSize: 20, fontWeight: 900, color: '#34d399' }}>${data.median.toFixed(2)}</span>
            <span style={{ fontSize: 10, color: '#6b7280' }}>median · {data.count} sold</span>
            {verdict && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 10,
                fontWeight: 800,
                padding: '2px 6px',
                borderRadius: 6,
                background: verdict.key === 'STRONG_BUY' ? '#16a34a' : verdict.key === 'GOOD_BUY' ? '#059669' : verdict.key === 'PASS' ? '#991b1b' : '#374151',
                color: '#fff',
              }}>
                {verdict.label}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
