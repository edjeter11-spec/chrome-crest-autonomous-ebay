import { useEffect, useState, useMemo } from 'react'
import { Activity, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

const SIGNAL_STYLE = {
  BUY:   { bg: 'bg-green-500/20',  border: 'border-green-500/60',  text: 'text-green-300',  dot: '#22c55e' },
  HOLD:  { bg: 'bg-yellow-500/15', border: 'border-yellow-500/40', text: 'text-yellow-300', dot: '#eab308' },
  AVOID: { bg: 'bg-red-500/20',    border: 'border-red-500/60',    text: 'text-red-300',    dot: '#ef4444' },
}

function volColor(pct) {
  if (pct < 25) return 'rgba(34,197,94,0.25)'
  if (pct < 45) return 'rgba(234,179,8,0.22)'
  if (pct < 65) return 'rgba(249,115,22,0.25)'
  return 'rgba(239,68,68,0.3)'
}

function momentumIcon(pct) {
  if (pct > 3) return <TrendingUp size={11} className="text-green-400" />
  if (pct < -3) return <TrendingDown size={11} className="text-red-400" />
  return <Minus size={11} className="text-gray-500" />
}

export default function Volatility() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(60)
  const [selectedCell, setSelectedCell] = useState(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/sales/volatility-heatmap?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setData(null); setLoading(false) })
  }, [days])

  const cellMap = useMemo(() => {
    if (!data?.cells) return new Map()
    const m = new Map()
    for (const c of data.cells) m.set(`${c.driver}|${c.parallel}`, c)
    return m
  }, [data])

  const summary = useMemo(() => {
    if (!data?.cells?.length) return null
    const buys = data.cells.filter(c => c.signal === 'BUY').length
    const avoids = data.cells.filter(c => c.signal === 'AVOID').length
    const avgVol = data.cells.reduce((a, c) => a + c.volatility_pct, 0) / data.cells.length
    return { buys, avoids, avgVol: avgVol.toFixed(0), total: data.cells.length }
  }, [data])

  if (loading) {
    return <div className="p-6 text-gray-500">Loading volatility heatmap…</div>
  }

  if (!data || !data.cells?.length) {
    return (
      <div className="p-6">
        <div className="panel p-10 text-center text-gray-500">
          <Activity size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Not enough sales data yet for a volatility grid.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={18} className="text-amber-400" />
            Price Volatility Heatmap
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Driver × parallel grid showing price swing (color) and recent momentum (↑↓).
            Find calm, trending-up cells to buy — avoid chaotic, falling ones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                days === d
                  ? 'bg-amber-500/20 border border-amber-500/60 text-amber-300'
                  : 'bg-gray-800/60 border border-gray-700/40 text-gray-400 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={`panel p-3 border ${SIGNAL_STYLE.BUY.border}`}>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Buy signals</div>
            <div className={`text-2xl font-bold ${SIGNAL_STYLE.BUY.text} mt-1`}>{summary.buys}</div>
          </div>
          <div className={`panel p-3 border ${SIGNAL_STYLE.AVOID.border}`}>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Avoid signals</div>
            <div className={`text-2xl font-bold ${SIGNAL_STYLE.AVOID.text} mt-1`}>{summary.avoids}</div>
          </div>
          <div className="panel p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Avg volatility</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.avgVol}%</div>
          </div>
          <div className="panel p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cells tracked</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.total}</div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="panel p-3 overflow-x-auto">
        <table className="text-xs w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2 sticky left-0 bg-gray-900/80 z-10 text-gray-400 font-bold uppercase tracking-wider">Driver</th>
              {data.parallels.map(p => (
                <th key={p} className="p-2 text-center text-gray-400 font-bold uppercase tracking-wider" style={{ minWidth: 95 }}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.drivers.map(driver => (
              <tr key={driver} className="border-t border-gray-800/60">
                <td className="p-2 sticky left-0 bg-gray-900/80 z-10 text-white font-semibold whitespace-nowrap">
                  {driver}
                </td>
                {data.parallels.map(parallel => {
                  const cell = cellMap.get(`${driver}|${parallel}`)
                  if (!cell) {
                    return <td key={parallel} className="p-1 text-center text-gray-700">—</td>
                  }
                  const style = SIGNAL_STYLE[cell.signal]
                  return (
                    <td
                      key={parallel}
                      className={`p-1.5 text-center cursor-pointer transition hover:brightness-125 border ${style.border}`}
                      style={{ background: volColor(cell.volatility_pct) }}
                      onClick={() => setSelectedCell(cell)}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span className={`text-[10px] font-bold ${style.text}`}>{cell.signal}</span>
                      </div>
                      <div className="text-[10px] text-gray-300 mt-0.5 flex items-center justify-center gap-1">
                        {momentumIcon(cell.momentum_pct)}
                        {cell.momentum_pct > 0 ? '+' : ''}{cell.momentum_pct}%
                      </div>
                      <div className="text-[9px] text-gray-500 mt-0.5">
                        vol {cell.volatility_pct}% · n={cell.count}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="panel p-3 text-[11px] text-gray-400">
        <div className="flex items-center gap-2 mb-2 text-gray-300 font-semibold">
          <Info size={12} /> How to read this
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-gray-500 font-bold uppercase tracking-wider text-[9px] mb-1">Signal</div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: SIGNAL_STYLE.BUY.dot }} />
              <b className="text-green-300">BUY</b> — low volatility, positive momentum (calm + climbing)
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: SIGNAL_STYLE.HOLD.dot }} />
              <b className="text-yellow-300">HOLD</b> — normal market, wait for clearer signal
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: SIGNAL_STYLE.AVOID.dot }} />
              <b className="text-red-300">AVOID</b> — high volatility or falling prices
            </div>
          </div>
          <div>
            <div className="text-gray-500 font-bold uppercase tracking-wider text-[9px] mb-1">Cell color (volatility)</div>
            <div className="flex items-center gap-1">
              <span className="inline-block w-5 h-4" style={{ background: 'rgba(34,197,94,0.25)' }} />
              <span>&lt;25% calm</span>
              <span className="inline-block w-5 h-4 ml-2" style={{ background: 'rgba(234,179,8,0.22)' }} />
              <span>25–45%</span>
              <span className="inline-block w-5 h-4 ml-2" style={{ background: 'rgba(249,115,22,0.25)' }} />
              <span>45–65%</span>
              <span className="inline-block w-5 h-4 ml-2" style={{ background: 'rgba(239,68,68,0.3)' }} />
              <span>&gt;65% wild</span>
            </div>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selectedCell && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="panel p-5 max-w-md w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-white">{selectedCell.driver}</h3>
                <p className="text-xs text-gray-400">{selectedCell.parallel}</p>
              </div>
              <span className={`px-3 py-1 rounded-lg text-xs font-bold ${SIGNAL_STYLE[selectedCell.signal].bg} ${SIGNAL_STYLE[selectedCell.signal].text} border ${SIGNAL_STYLE[selectedCell.signal].border}`}>
                {selectedCell.signal}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-gray-500 text-[10px] uppercase tracking-widest">Sales ({days}d)</div>
                <div className="text-xl text-white font-bold mt-1">{selectedCell.count}</div>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-gray-500 text-[10px] uppercase tracking-widest">Median price</div>
                <div className="text-xl text-white font-bold mt-1">${selectedCell.median}</div>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-gray-500 text-[10px] uppercase tracking-widest">Volatility</div>
                <div className="text-xl text-white font-bold mt-1">{selectedCell.volatility_pct}%</div>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-gray-500 text-[10px] uppercase tracking-widest">Momentum</div>
                <div className={`text-xl font-bold mt-1 ${selectedCell.momentum_pct > 0 ? 'text-green-400' : selectedCell.momentum_pct < 0 ? 'text-red-400' : 'text-white'}`}>
                  {selectedCell.momentum_pct > 0 ? '+' : ''}{selectedCell.momentum_pct}%
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <a
                href={`/sales?driver=${encodeURIComponent(selectedCell.driver)}&parallel=${encodeURIComponent(selectedCell.parallel)}`}
                className="flex-1 px-3 py-2 text-center bg-amber-500/20 border border-amber-500/60 text-amber-300 rounded-lg text-xs font-bold hover:bg-amber-500/30"
              >
                View Sales
              </a>
              <button
                onClick={() => setSelectedCell(null)}
                className="px-3 py-2 bg-gray-700/40 border border-gray-600/40 text-gray-300 rounded-lg text-xs font-bold hover:bg-gray-700/60"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
