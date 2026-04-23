import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Privacy() {
  useEffect(() => {
    document.title = 'Privacy Policy — F1 Card Vault'
  }, [])

  const lastUpdated = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-3xl mx-auto space-y-5 p-2">
      <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1 w-fit">
        <ArrowLeft size={12} /> Home
      </Link>

      <div className="panel p-6 space-y-5">
        <header>
          <h1 className="text-3xl font-black text-white">Privacy Policy</h1>
          <p className="text-sm text-gray-400 mt-1">Last updated: {lastUpdated}</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">1. What we store</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            F1 Card Vault stores a minimal amount of data. Preferences like theme, watchlist,
            tutorial-seen state, and snipe rule drafts live in your browser's localStorage. That
            data never leaves your device unless you sign in.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">2. Authentication (Supabase)</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            When you sign in, we use Supabase Auth to manage your account. Supabase stores your
            email, a hashed password (or OAuth token from your provider), and a session token.
            Your portfolio, watchlist, and snipe rules are associated with your user ID in
            Supabase. We never see or store your raw password.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">3. Hosting (Vercel)</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            The site is served from Vercel. Vercel maintains standard web request logs (IP address,
            user-agent, timestamp) for operational and anti-abuse purposes. We do not use these
            logs for profiling or advertising.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">4. No selling, no tracking pixels</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            We do not sell, rent, or trade your data to any third party. We do not run
            advertising trackers, fingerprinting scripts, or third-party analytics pixels on this
            site.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">5. Push notifications</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            If you enable push alerts, your browser generates an anonymous subscription endpoint
            which we store so we can deliver snipe and price-drop notifications. You can revoke
            this at any time from the site or in your browser settings.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">6. GDPR & CCPA</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            If you are located in the EU, UK, or California, you have the right to request access
            to, correction of, or deletion of your personal data. To exercise any of these rights,
            or to opt out of any processing, email{' '}
            <a className="text-red-400 hover:underline" href="mailto:edjeter11@gmail.com">
              edjeter11@gmail.com
            </a>
            . We respond to verified requests within 30 days.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">7. Children</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            F1 Card Vault is not directed at children under 13. We do not knowingly collect data
            from anyone under 13.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">8. Changes</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            We may update this policy occasionally. Material changes will be noted on this page
            with a new "Last updated" date at the top.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-white">9. Contact</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Privacy questions? Email{' '}
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
