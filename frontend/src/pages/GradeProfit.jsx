import { useState, useEffect } from 'react'
import { Calculator, Shield, DollarSign } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''
const GRADING_FEE = 25
const HIT_PROB = { 'PSA 10': 0.30, 'PSA 9': 0.60, 'PSA 8': 0.85 }

export default function GradeProfit() {
  const [drivers, setDrivers] = useState([])
  const [parallels, setParallels] = useState([])
  const [driver, setDriver] = useState('Max Verstappen')
  const [parallel, setParallel] = useState('Refractor')
  const [currentGrade, setCurrentGrade] = useState('Raw')
  const [targetGrade, setTargetGrade] = useState('PSA 10')
  const [currentMed, setCurrentMed] = useState(null)
  const [targetMed, setTargetMed] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/sales/stats`).then(r => r.json()).then(d => {
      setDrivers((d.top_drivers || []).map(r => r.driver))
      setParallels((d.by_parallel || []).map(r => r.parallel))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!driver || !parallel) return
    setLoading(true)
    const cg = currentGrade === 'Raw' ? '' : `&grade=${encodeURIComponent(currentGrade)}`
    const tg = targetGrade === 'Raw' ? '' : `&grade=${encodeURIComponent(targetGrade)}`
    Promise.all([
      fetch(`${API}/api/sales/median?driver=${encodeURIComponent(driver)}&parallel=${encodeURIComponent(parallel)}${cg}`).then(r => r.json()),
      fetch(`${API}/api/sales/median?driver=${encodeURIComponent(driver)}&parallel=${encodeURIComponent(parallel)}${tg}`).then(r => r.json()),
    ]).then(([c, t]) => {
      setCurrentMed(c); setTargetMed(t); setLoading(false)
    }).catch(() => setLoading(false))
  }, [driver, parallel, currentGrade, targetGrade])

  const prob = HIT_PROB[targetGrade] ?? 0.5
  const curVal = currentMed?.median_total ?? 0
  const tgtVal = targetMed?.median_total ?? 0
  const expected = tgtVal * prob
  const netProfit = expected - curVal - GRADING_FEE
  const breakEven = tgtVal > 0 ? (curVal + GRADING_FEE) / tgtVal : null

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Calculator className="text-red-500" size={28} />
        <div>
          <h1 className="text-2xl font-black text-white">Slab vs Raw Profit Calculator</h1>
          <p className="text-sm text-gray-500">Estimate expected value of grading a card</p>
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-500 uppercase block mb-1">Driver</label>
          <select value={driver} onChange={e => setDriver(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
            {drivers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase block mb-1">Parallel</label>
          <select value={parallel} onChange={e => setParallel(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
            {parallels.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase block mb-1">Current Grade</label>
          <select value={currentGrade} onChange={e => setCurrentGrade(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
            {['Raw', 'PSA 8', 'PSA 9'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase block mb-1">Target Grade</label>
          <select value={targetGrade} onChange={e => setTargetGrade(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
            {['PSA 8', 'PSA 9', 'PSA 10'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}

      {!loading && (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-2xl p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Stat label="Current value" value={curVal ? `$${curVal.toFixed(0)}` : 'n/a'} />
            <Stat label={`${targetGrade} median`} value={tgtVal ? `$${tgtVal.toFixed(0)}` : 'n/a'} />
            <Stat label="Hit probability" value={`${(prob * 100).toFixed(0)}%`} />
            <Stat label="Grading fee" value={`$${GRADING_FEE}`} />
          </div>

          <div className="border-t border-gray-700 pt-5">
            <div className="text-xs text-gray-500 uppercase mb-1">Expected Value Formula</div>
            <div className="font-mono text-sm text-gray-300 mb-3">
              (${tgtVal.toFixed(0)} × {prob.toFixed(2)}) − ${curVal.toFixed(0)} − ${GRADING_FEE} = <span className={netProfit >= 0 ? 'text-green-400 font-black' : 'text-red-400 font-black'}>${netProfit.toFixed(0)}</span>
            </div>
            <div className={`text-2xl font-black ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {netProfit >= 0 ? 'GRADE IT' : 'SKIP'} — net EV ${netProfit.toFixed(0)}
            </div>
            {breakEven !== null && (
              <div className="text-xs text-gray-500 mt-2">
                Break-even hit rate: {(breakEven * 100).toFixed(1)}% (you need at least this probability to profit)
              </div>
            )}
            <div className="text-[11px] text-gray-600 mt-3">
              Hit probabilities are rough estimates based on typical submission outcomes for modern chrome: PSA 10 ≈ 30%, PSA 9 ≈ 60%, PSA 8 ≈ 85%.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-gray-900/80 rounded-xl p-3 border border-gray-800">
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className="text-lg font-black text-white">{value}</div>
    </div>
  )
}
