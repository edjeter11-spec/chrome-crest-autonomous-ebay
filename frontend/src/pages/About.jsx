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
