import { useEffect, useState } from 'react'
import { Package, TrendingUp, DollarSign } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function SealedEV() {
  const [price, setPrice] = useState(200)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = (p) => {
    setLoading(true)
    fetch(`${API}/api/sealed/ev?box_market_price=${p}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load(price) }, [])

  const submit = (e) => {
    e.preventDefault()
    load(price)
  }

  const verdictColor = {
    green:  'text-emerald-400 bg-emerald-600/15 border-emerald-600/40',
    yellow: 'text-amber-400 bg-amber-600/15 border-amber-600/40',
    red:    'text-red-400 bg-red-600/15 border-red-600/40',
    gray:   'text-gray-400 bg-gray-700/40 border-gray-700/60',
  }[data?.verdict?.color || 'gray']

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-cyan-500 rounded-full shrink-0" />
          <h1 className="text-2xl font-black text-white tracking-tight">Sealed Box EV</h1>
        </div>
        <p className="text-xs text-gray-500 mt-2 ml-4">
          2025 Topps Chrome F1 Hobby Box · expected value vs sealed market price
        </p>
      </div>

      {/* Price input */}
      <form onSubmit={submit} className="bg-gray-900/70 border border-gray-800 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
        <DollarSign size={16} className="text-emerald-400" />
        <label className="text-xs font-bold text-gray-400">Sealed Box Market Price</label>
        <input
          type="number"
          step="1"
          min="0"
          value={price}
          onChange={e => setPrice(e.target.value)}
          className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 w-28"
        />
        <button className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold">
          Calculate EV
        </button>
      </form>

      {loading && <div className="text-gray-500 text-sm">Calculating…</div>}

      {data && (
        <>
          {/* Verdict tile */}
          <div className={`rounded-2xl border p-5 ${verdictColor}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">Verdict</div>
                <div className="text-4xl font-black mt-1">{data.verdict.label}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">Expected Value</div>
                <div className="text-4xl font-black text-white">${data.total_ev.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">Market Price</div>
                <div className="text-4xl font-black text-gray-300">${data.box_market_price}</div>
              </div>
              {data.verdict.delta_usd != null && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">Delta</div>
                  <div className="text-2xl font-black">
                    {data.verdict.delta_usd >= 0 ? '+' : ''}${data.verdict.delta_usd.toFixed(2)}
                  </div>
                  <div className="text-xs opacity-80">{data.verdict.delta_pct}%</div>
                </div>
              )}
            </div>
          </div>

          {/* Breakdown */}
          <div className="bg-gray-900/70 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <Package size={13} className="text-cyan-400" />
              <h2 className="text-sm font-black text-white">EV Breakdown</h2>
              <span className="text-[10px] text-gray-500 font-mono">
                {data.pack_count} packs · {data.total_cards_per_box} cards
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="text-left px-4 py-2 font-bold">Parallel</th>
                    <th className="text-right px-4 py-2 font-bold">Expected/Box</th>
                    <th className="text-right px-4 py-2 font-bold">Avg Value</th>
                    <th className="text-right px-4 py-2 font-bold">Contribution</th>
                    <th className="text-right px-4 py-2 font-bold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((b, i) => (
                    <tr key={i} className="border-t border-gray-800/60 hover:bg-gray-800/30">
                      <td className="px-4 py-2 font-semibold text-white">{b.parallel}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-300">{b.expected_pulls.toFixed(b.expected_pulls < 1 ? 3 : 1)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-300">${b.avg_value_per_pull.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-400">${b.contribution.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${b.source === 'market' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                          {b.source}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-800/40 border-t border-gray-700">
                    <td className="px-4 py-2 font-black text-white" colSpan={3}>Total EV</td>
                    <td className="px-4 py-2 text-right font-black text-emerald-400 text-sm">${data.total_ev.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600 italic">
              {data.assumption_note}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
