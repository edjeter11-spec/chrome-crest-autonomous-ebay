import { useEffect, useState, useMemo } from 'react'
import { ArrowLeftRight, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function median(vals) {
  if (!vals.length) return null
  const v = [...vals].sort((a, b) => a - b)
  const n = v.length
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2
}

function groupByKey(sales) {
  const map = new Map()
  for (const s of sales) {
    if (!s.driver_name || !s.parallel) continue
    const grade = s.grade || 'Raw'
    const key = `${s.driver_name}||${s.parallel}||${grade}`
    const price = s.total_cost ?? s.sale_price
    if (!price || price <= 0) continue
    if (!map.has(key)) map.set(key, { driver: s.driver_name, parallel: s.parallel, grade, prices: [] })
    map.get(key).prices.push(price)
  }
  return map
}

export default function Arbitrage() {
  const [loading, setLoading] = useState(true)
  const [ebay, setEbay] = useState([])
  const [scp, setScp] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/api/sales?limit=500`).then(r => r.json()),
      fetch(`${API}/api/sales?limit=500&exclude_source=none&source=SportsCardsPro`).then(r => r.json()),
    ]).then(([e, s]) => {
      setEbay(e.sales || [])
      setScp(s.sales || [])
      setLoading(false)
    }).catch(err => { setError(String(err)); setLoading(false) })
  }, [])

  const opportunities = useMemo(() => {
    const eMap = groupByKey(ebay)
    const sMap = groupByKey(scp)
    const out = []
    for (const [key, eg] of eMap) {
      const sg = sMap.get(key)
      if (!sg) continue
      if (eg.prices.length < 3 || sg.prices.length < 3) continue
      const eMed = median(eg.prices)
      const sMed = median(sg.prices)
      if (!eMed || !sMed) continue
      const delta = eMed - sMed
      const pct = Math.abs(delta) / Math.min(eMed, sMed) * 100
      if (pct < 30) continue
      out.push({
        driver: eg.driver, parallel: eg.parallel, grade: eg.grade,
        eMed, sMed, delta, pct,
        direction: delta > 0 ? 'Buy on SCP, sell on eBay' : 'Buy on eBay, sell on SCP',
        nEbay: eg.prices.length, nScp: sg.prices.length,
      })
    }
    out.sort((a, b) => b.pct - a.pct)
    return out
  }, [ebay, scp])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ArrowLeftRight className="text-red-500" size={28} />
        <div>
          <h1 className="text-2xl font-black text-white">Arbitrage Finder</h1>
          <p className="text-sm text-gray-500">Price gaps &gt; 30% between eBay and SportsCardsPro (n≥3 on both sides)</p>
        </div>
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {!loading && !error && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
          {opportunities.length === 0 ? (
            <div className="p-6 text-gray-500 text-sm">No arbitrage opportunities found in current dataset.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-800/60 text-gray-400 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Card</th>
                  <th className="text-right px-4 py-3">eBay med (n)</th>
                  <th className="text-right px-4 py-3">SCP med (n)</th>
                  <th className="text-right px-4 py-3">Δ %</th>
                  <th className="text-left px-4 py-3">Strategy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {opportunities.map((o, i) => (
                  <tr key={i} className="hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-white font-semibold">
                      {o.driver}
                      <div className="text-xs text-gray-500 font-normal">{o.parallel} · {o.grade}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">${o.eMed.toFixed(2)} <span className="text-gray-500 text-xs">({o.nEbay})</span></td>
                    <td className="px-4 py-3 text-right text-gray-200">${o.sMed.toFixed(2)} <span className="text-gray-500 text-xs">({o.nScp})</span></td>
                    <td className={`px-4 py-3 text-right font-black ${o.pct > 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                      {o.delta > 0 ? <TrendingUp size={12} className="inline" /> : <TrendingDown size={12} className="inline" />} {o.pct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-gray-300 text-xs">{o.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
