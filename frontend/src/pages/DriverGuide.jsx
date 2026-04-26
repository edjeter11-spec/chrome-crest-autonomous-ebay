import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { TrendingUp, TrendingDown } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function DriverGuide() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/seo/driver-guide/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))

    // SEO meta
    const driver = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    document.title = `Investing in ${driver} 2025 Topps Chrome F1 Cards — Prices, Trends, Buy Guide | F1 Card Vault`
    const desc = `Complete 2025 Topps Chrome ${driver} card investment guide. Live prices, 30/90-day trends, all parallels, top sales, and buy recommendations. Always updated.`
    let m = document.querySelector('meta[name="description"]')
    if (!m) {
      m = document.createElement('meta')
      m.name = 'description'
      document.head.appendChild(m)
    }
    m.content = desc
  }, [slug])

  if (loading) return <div className="p-6 text-gray-500">Loading guide…</div>
  if (!data || data.error) return <div className="p-6 text-gray-500">Driver not found.</div>

  const driver = data.driver
  const trend = data.stats.trend

  return (
    <article className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-3xl md:text-4xl font-black text-white">
          Investing in {driver} 2025 Topps Chrome F1 Cards
        </h1>
        <p className="text-gray-400 mt-2">
          Updated daily — track every parallel, all comp data, and live auction prices for {driver}.
        </p>
        {data.team && (
          <p className="text-sm text-gray-500 mt-1">
            Team: <span className="text-gray-300">{data.team}</span>
            {data.is_rookie && <span className="ml-2 px-2 py-0.5 rounded bg-amber-900/40 border border-amber-700 text-amber-300 text-[10px] uppercase tracking-wide">Rookie</span>}
          </p>
        )}
      </header>

      <section>
        <h2 className="text-xl font-bold text-white mb-3">90-Day Market Snapshot</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Sales (30d)" value={data.stats.sales_30d || 0} />
          <Stat label="Sales (90d)" value={data.stats.sales_90d || 0} />
          <Stat
            label="Median (30d)"
            value={data.stats.median_30d ? `$${data.stats.median_30d.toFixed(0)}` : '—'}
          />
          <Stat
            label="Median (90d)"
            value={data.stats.median_90d ? `$${data.stats.median_90d.toFixed(0)}` : '—'}
          />
        </div>
        {trend && (
          <div
            className={`mt-3 p-3 rounded-xl ${
              trend.direction === 'up'
                ? 'bg-emerald-900/30 border border-emerald-700'
                : 'bg-red-900/30 border border-red-700'
            }`}
          >
            {trend.direction === 'up' ? (
              <TrendingUp className="inline mr-2" size={16} />
            ) : (
              <TrendingDown className="inline mr-2" size={16} />
            )}
            <strong>
              {driver} cards are {trend.direction} {trend.pct}%
            </strong>{' '}
            over the last 30 days vs the 90-day baseline.
          </div>
        )}
      </section>

      {data.top_sale && (
        <section>
          <h2 className="text-xl font-bold text-white mb-3">Top Recent Sale</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-amber-400 text-2xl font-black">
              ${data.top_sale.price?.toFixed(0)}
            </div>
            <div className="text-sm text-gray-300 mt-1">{data.top_sale.title}</div>
          </div>
        </section>
      )}

      {data.parallels && data.parallels.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-white mb-3">Available Parallels</h2>
          <div className="flex flex-wrap gap-2">
            {data.parallels.map((p) => (
              <span
                key={p}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-sm"
              >
                {p}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold text-white mb-3">How to Invest in {driver} Cards</h2>
        <p className="text-gray-300 leading-relaxed">
          {driver}'s 2025 Topps Chrome cards are tracked across {data.stats.sales_90d || 0} sales in
          the last 90 days. The market shows a median raw card price of{' '}
          {data.stats.median_90d ? `$${data.stats.median_90d.toFixed(0)}` : '—'}, with rare
          parallels (Gold /50, Red /5, autographs) commanding significant premiums. For long-term
          holds, focus on numbered parallels under /99 print run. For flipping, watch for STRONG
          BUY listings ending in the next hour on our live auctions feed.
        </p>
      </section>

      <div className="flex gap-3 pt-6 border-t border-gray-800">
        <Link
          to={`/drivers?name=${encodeURIComponent(driver)}`}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl"
        >
          See Full {driver} Profile
        </Link>
        <Link
          to="/auctions"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl"
        >
          Live Auctions
        </Link>
      </div>
    </article>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-black text-white mt-1">{value}</div>
    </div>
  )
}
