import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Terms() {
  useEffect(() => {
    document.title = 'Terms of Service — F1 Card Vault'
  }, [])

  const lastUpdated = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-3xl mx-auto space-y-5 p-2">
      <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1 w-fit">
        <ArrowLeft size={12} /> Home
      </Link>

      <div className="panel p-6 space-y-5">
        <header>
          <h1 className="text-3xl font-black text-white">Terms of Service</h1>
          <p className="text-sm text-gray-400 mt-1">Last updated: {lastUpdated}</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">1. Use at your own risk</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            F1 Card Vault is provided as-is for informational purposes. All prices, verdicts,
            medians, and AI-generated grades are estimates derived from public data. Nothing on
            this site is investment advice, and you are solely responsible for your buying,
            selling, grading, and bidding decisions.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">2. eBay affiliate disclosure</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            F1 Card Vault is a participant in the eBay Partner Network. We may earn a commission
            when you click through a link on this site and complete a qualifying purchase on eBay.
            This does not change the price you pay, and it does not influence the medians,
            verdicts, or recommendations shown.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">3. No warranty</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            The service is provided "as is" and "as available" without warranty of any kind,
            express or implied, including but not limited to merchantability, fitness for a
            particular purpose, data accuracy, or uninterrupted availability. We make no guarantee
            that listings, sold comps, or grades are complete or error-free.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">4. Not affiliated with Topps, Fanatics, or F1</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            F1 Card Vault is an independent project. We are not affiliated with, endorsed by, or
            sponsored by Topps, Fanatics, Formula 1, FIA, or any team, sponsor, or driver. All
            trademarks and logos are the property of their respective owners.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">5. Limitation of liability</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            To the fullest extent permitted by law, F1 Card Vault and its operators are not liable
            for any direct, indirect, incidental, or consequential losses arising from your use of
            the service, including but not limited to missed bids, purchases made at a loss, or
            grading outcomes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">6. Changes</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            We may update these terms at any time. Continued use of the service after a change
            means you accept the updated terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">7. Contact</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Questions about these terms? Email{' '}
            <a className="text-red-400 hover:underline" href="mailto:edjeter11@gmail.com">
              edjeter11@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  )
}
