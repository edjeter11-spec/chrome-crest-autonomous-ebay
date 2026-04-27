import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function About() {
  useEffect(() => {
    document.title = 'About — F1 Card Vault'
  }, [])

  const lastUpdated = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-3xl mx-auto space-y-5 p-2">
      <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1 w-fit">
        <ArrowLeft size={12} /> Home
      </Link>

      <div className="panel p-6 space-y-5">
        <header>
          <h1 className="text-3xl font-black text-white">About F1 Card Vault</h1>
          <p className="text-sm text-gray-400 mt-1">
            Live tracker for 2025 Topps Chrome Formula 1 cards
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">What it does</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Live eBay auctions, sold-price medians, AI grader, STRONG BUY verdicts.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">Data sources</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            eBay public listings (scraped every hour), SportsCardsPro, and user-submitted scans.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white">How we source data</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Every number on this site traces back to a real, public data source. Here's exactly how
            each feed works:
          </p>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                <strong className="text-white">Live auction data:</strong> eBay Browse API,
                refreshed every 5 minutes. We pull active auctions and Buy-It-Now listings directly
                from eBay's official API using OAuth 2.0 credentials.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                <strong className="text-white">Recent sales:</strong> 130point HTML scraper, every
                10 minutes. We pull the most recent sold prices so medians reflect what cards are
                actually selling for right now — not month-old list prices.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                <strong className="text-white">PSA population data:</strong> Manual research and
                scraping from the PSA public database. Used to gauge scarcity for PSA 10 pop reports
                across every parallel we track.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-red-500 font-black shrink-0">•</span>
              <span>
                <strong className="text-white">Data transparency:</strong> All prices are real eBay
                sales. Median calculations use the last 90 days of confirmed recent sales — nothing
                simulated, nothing projected.
              </span>
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">Disclaimer</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Prices are informational, not investment advice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">Affiliate disclosure</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            As an eBay Partner, F1 Card Vault may be compensated when you make a qualifying purchase
            after clicking a link on this site. This does not affect the price you pay. Median
            prices and verdicts are computed from public sale data and are not investment advice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">Contact</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Questions? Email{' '}
            <a className="text-red-400 hover:underline" href="mailto:edjeter11@gmail.com">
              edjeter11@gmail.com
            </a>
          </p>
        </section>

        <footer className="pt-4 border-t border-gray-800/60">
          <p className="text-[11px] text-gray-500">Last updated: {lastUpdated}</p>
        </footer>
      </div>
    </div>
  )
}
