import { useEffect, useState } from 'react'
import { Calculator, TrendingUp } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

const PSA_FEES = { economy: 50, regular: 100, express: 175, super_express: 350 }
const PSA_PCT_10 = { 'rookie': 0.15, 'auto': 0.25, 'base_chrome': 0.40, 'numbered': 0.30, 'default': 0.25 }
const SHIPPING = 12  // round trip
const EBAY_FEE_PCT = 0.13

function predictPsa10Pct(parallel, isRookie, isAuto) {
  if (isAuto) return PSA_PCT_10.auto
  if (isRookie) return PSA_PCT_10.rookie
  if (parallel && /\/\d+/.test(parallel)) return PSA_PCT_10.numbered
  if (parallel === 'Base' || /refractor/i.test(parallel || '')) return PSA_PCT_10.base_chrome
  return PSA_PCT_10.default
}

export default function RawToGradedROI({ driver, parallel, isRookie, isAuto, rawPrice }) {
  const [psa10Med, setPsa10Med] = useState(null)
  const [tier, setTier] = useState('regular')

  useEffect(() => {
    if (!driver) return
    const params = new URLSearchParams({ driver, ...(parallel ? { parallel } : {}), grade: 'PSA 10' })
    fetch(`${API}/api/sales/median?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setPsa10Med(d?.median_total || null))
      .catch(() => {})
  }, [driver, parallel])

  if (!rawPrice || !psa10Med) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-gray-500 text-sm">
        <Calculator size={14} className="inline mr-2" />
        Need both raw price and PSA 10 comp data to compute ROI.
      </div>
    )
  }

  const psa10Pct = predictPsa10Pct(parallel, isRookie, isAuto)
  const fee = PSA_FEES[tier]
  const cost = Number(rawPrice) + fee + SHIPPING
  // Expected payout = (% PSA 10 * PSA10 sale) + (% PSA 9 * PSA10 * 0.5) + (% lower * raw)
  const expectedSale = psa10Pct * psa10Med + 0.45 * (psa10Med * 0.5) + 0.10 * rawPrice
  const afterEbayFee = expectedSale * (1 - EBAY_FEE_PCT)
  const profit = afterEbayFee - cost
  const roi = (profit / cost * 100)

  return (
    <div className="bg-gradient-to-br from-emerald-900/30 to-gray-900 border border-emerald-700/40 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-emerald-300 font-black">
        <Calculator size={16} /> Raw → PSA 10 ROI Estimator
      </div>
      <div className="text-xs text-gray-400">
        If you bought this raw at <span className="text-white font-bold">${Number(rawPrice).toFixed(2)}</span>,
        graded it ({tier} tier — ${fee}), and sold the result on eBay (13% FVF):
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Stat label="Total cost" value={`$${cost.toFixed(0)}`} />
        <Stat label="Expected sale" value={`$${afterEbayFee.toFixed(0)}`} hint={`${(psa10Pct*100).toFixed(0)}% chance PSA 10`} />
        <Stat label="Profit" value={`${profit > 0 ? '+' : ''}$${profit.toFixed(0)}`} color={profit > 0 ? 'text-emerald-400' : 'text-red-400'} />
        <Stat label="ROI" value={`${roi > 0 ? '+' : ''}${roi.toFixed(0)}%`} color={roi > 0 ? 'text-emerald-400' : 'text-red-400'} />
      </div>
      <div className="flex gap-1 mt-2">
        {Object.keys(PSA_FEES).map(t => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`text-[10px] font-bold px-2 py-1 rounded-lg ${tier===t ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-gray-600">
        Estimates only. PSA 10 % is a heuristic ({(psa10Pct*100).toFixed(0)}% for this card type).
        Real outcome depends on card centering, surface, corners.
      </div>
    </div>
  )
}

function Stat({ label, value, hint, color = 'text-white' }) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-2">
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className={`text-lg font-black ${color}`}>{value}</div>
      {hint && <div className="text-[9px] text-gray-500">{hint}</div>}
    </div>
  )
}
