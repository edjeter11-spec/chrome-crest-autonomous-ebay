import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Flag } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function RaceWeekend() {
  const [race, setRace] = useState(null)
  const [movers, setMovers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title =
      'Race Weekend Card Movers — Live F1 Topps Chrome Price Trends | F1 Card Vault'
    const desc =
      'See which 2025 Topps Chrome F1 driver cards are moving most going into the next race weekend. Live 7-day price trends vs 30-day baseline.'
    let m = document.querySelector('meta[name="description"]')
    if (!m) {
      m = document.createElement('meta')
      m.name = 'description'
      document.head.appendChild(m)
    }
    m.content = desc

    Promise.all([
      fetch(`${API}/api/races/upcoming?limit=1`)
        .then((r) => r.json())
        .catch(() => null),
      fetch(`${API}/api/seo/race-weekend-movers`)
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([calData, moversData]) => {
        if (calData && calData.races && calData.races.length > 0) {
          setRace(calData.races[0])
        }
        if (moversData && Array.isArray(moversData.movers)) {
          setMovers(moversData.movers)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-gray-500">Loading race weekend data…</div>

  return (
    <article className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-3xl md:text-4xl font-black text-white">
          F1 Race Weekend Card Movers
        </h1>
        <p className="text-gray-400 mt-2">
          Which 2025 Topps Chrome driver cards are moving most heading into race weekend.
          7-day median vs the prior 30-day baseline — updated continuously.
        </p>
      </header>

      {race && (
        <section className="bg-gradient-to-br from-red-900/30 to-gray-900 border border-red-800/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <Flag size={18} className="text-red-400" />
            <span className="text-xs uppercase tracking-wider text-red-300 font-bold">
              Next Race
            </span>
          </div>
          <h2 className="text-2xl font-black text-white">
            {race.flag} {race.name}
          </h2>
          <p className="text-gray-300 mt-1">
            {race.circuit}
            {race.city ? `, ${race.city}` : ''} {race.country ? `• ${race.country}` : ''}
          </p>
          {typeof race.days_until === 'number' && (
            <p className="text-amber-400 font-semibold mt-2">
              {race.days_until <= 0 ? 'Live now' : `${race.days_until} day${race.days_until === 1 ? '' : 's'} away`}
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold text-white mb-3">Top 10 Movers (7d vs 30d)</h2>
        {movers.length === 0 ? (
          <div className="text-gray-500 text-sm bg-gray-900/40 border border-gray-800 rounded-xl p-6">
            Not enough recent sales data yet. Check back after the next round of auctions close.
          </div>
        ) : (
          <ol className="space-y-2">
            {movers.map((m, i) => (
              <li
                key={m.driver}
                className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-gray-500 font-mono text-sm w-6 text-right">
                    {i + 1}.
                  </span>
                  <div className="min-w-0">
                    <Link
                      to={`/drivers/${m.slug}/guide`}
                      className="font-bold text-white hover:text-red-400 truncate block"
                    >
                      {m.driver}
                    </Link>
                    <div className="text-[11px] text-gray-500">
                      {m.team || '—'} • {m.sales_7d} sales (7d) • median ${m.median_7d?.toFixed(0)}
                    </div>
                  </div>
                </div>
                <div
                  className={`flex items-center gap-1 font-bold text-sm whitespace-nowrap ${
                    m.direction === 'up' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {m.direction === 'up' ? (
                    <TrendingUp size={16} />
                  ) : (
                    <TrendingDown size={16} />
                  )}
                  {m.direction === 'up' ? '+' : '-'}
                  {m.pct_change > 0 ? m.pct_change : -m.pct_change}%
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="pt-4 border-t border-gray-800">
        <h2 className="text-xl font-bold text-white mb-3">Why race weekends move card prices</h2>
        <p className="text-gray-300 leading-relaxed">
          Driver card prices spike on results — pole positions, podiums, and rookie wins
          historically drive 10–40% short-term movement on the Topps Chrome 2025 set. The list
          above tracks median sale price over the trailing 7 days versus the prior 30-day
          baseline, surfacing the drivers whose cards are heating up (or cooling) right now.
          Tap any driver to see their full investment guide and live auctions.
        </p>
      </section>

      <div className="flex gap-3 pt-2">
        <Link
          to="/auctions"
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl"
        >
          Live Auctions
        </Link>
        <Link
          to="/drivers"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl"
        >
          All Drivers
        </Link>
      </div>
    </article>
  )
}
