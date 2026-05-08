import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

const ROWS = [
  {
    ratio: '≤ 0.6 (with ≥10 comps)',
    verdict: 'STRONG_BUY',
    badge: 'bg-emerald-600/40 text-emerald-200',
    meaning: 'At least 40% under median, with high confidence',
  },
  {
    ratio: '≤ 0.8',
    verdict: 'GOOD_BUY',
    badge: 'bg-emerald-600/25 text-emerald-300',
    meaning: '20% or more under median',
  },
  {
    ratio: '≤ 1.05',
    verdict: 'FAIR',
    badge: 'bg-gray-600/40 text-gray-200',
    meaning: 'Within 5% of median',
  },
  {
    ratio: '≤ 1.25',
    verdict: 'OVERPRICED',
    badge: 'bg-amber-600/30 text-amber-200',
    meaning: '5–25% over median',
  },
  {
    ratio: '> 1.25',
    verdict: 'PASS',
    badge: 'bg-red-600/30 text-red-200',
    meaning: 'More than 25% over median',
  },
]

export default function HowWeScore() {
  useEffect(() => {
    document.title = 'How We Score Auctions — F1 Card Vault'
  }, [])

  const lastUpdated = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-3xl mx-auto space-y-5 p-2">
      <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1 w-fit">
        <ArrowLeft size={12} /> Home
      </Link>

      <div className="panel p-6 space-y-6">
        <header>
          <h1 className="text-3xl font-black text-white">How We Score Auctions</h1>
          <p className="text-sm text-gray-400 mt-1">
            What the STRONG BUY, GOOD BUY, FAIR, OVERPRICED, and PASS verdicts mean — and how we
            compute them.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">What is a verdict?</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Each active auction is compared to recent sold prices for the <strong className="text-white">same
            driver, parallel, and grade</strong>. We compute a ratio of the current total price
            (current bid + shipping) divided by the median sold price, then map that ratio to one
            of five verdicts.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white">The thresholds</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-800/60">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60">
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                  <th className="px-4 py-3 font-semibold">Ratio</th>
                  <th className="px-4 py-3 font-semibold">Verdict</th>
                  <th className="px-4 py-3 font-semibold">What it means</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {ROWS.map((r) => (
                  <tr key={r.verdict} className="hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-mono text-xs text-gray-300 whitespace-nowrap">
                      {r.ratio}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[10px] font-black px-2 py-1 rounded ${r.badge}`}>
                        {r.verdict.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{r.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500">
            Ratio = (current bid + shipping) / median sold price for the matching driver + parallel
            + grade.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">What "low confidence" means</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            If we have fewer than <strong className="text-white">10 sold comps</strong> in the last
            90 days, we flag the verdict as low-confidence. STRONG BUY requires ≥10 comps to apply
            — below that threshold we demote what would have been STRONG BUY down into the GOOD
            BUY range. With fewer than 3 comps total, we don't post a verdict at all because the
            median isn't trustworthy.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">Where the comps come from</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Real eBay sold listings, ingested daily for every driver in the 2025 Topps Chrome F1
            set. We exclude duplicates and shipping is included in totals so the comparison is
            apples-to-apples with the live auction's all-in cost.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">Limitations</h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                A brand-new card with no sold history will have no verdict at all — there's nothing
                to compare against.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                Heavily graded cards (PSA 10) need their own grade-specific comp pool. We use
                whatever's available and surface confidence accordingly.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                Verdicts are a signal, not financial advice. Do your own due diligence before
                bidding.
              </span>
            </li>
          </ul>
        </section>

        <div className="pt-4 border-t border-gray-800/60 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-gray-500">Last updated: {lastUpdated}</p>
          <Link
            to="/"
            className="inline-flex items-center justify-center text-xs font-black px-4 py-2.5 sm:py-2 min-h-[40px] sm:min-h-0 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
