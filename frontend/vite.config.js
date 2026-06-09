import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import fs from 'fs'
import path from 'path'

const ROUTES = [
  { path: '/', title: 'F1 Card Vault — Live Topps F1 Card Tracker', desc: '3,000+ sold prices, ending-soonest auctions, PSA graded comps. Verstappen, Hamilton, Antonelli — every driver, every parallel.' },
  { path: '/auctions', title: 'Live F1 Auctions Ending Soonest — F1 Card Vault', desc: 'Live eBay auctions for 2025 Topps Chrome Formula 1 cards. Snipe-eligible flagged, STRONG_BUY verdicts, ending in next 24h.' },
  { path: '/bin', title: 'F1 Card Buy It Now — F1 Card Vault', desc: 'Fixed-price 2025 Topps Chrome F1 cards on eBay. Filter by driver, parallel, grade, price.' },
  { path: '/sales', title: 'F1 Sales Database — 29,000+ Sold Prices — F1 Card Vault', desc: 'Filterable database of every 2025 Topps Chrome F1 sale. Driver, parallel, grade, date filters. CSV export.' },
  { path: '/drivers', title: 'F1 Driver Profiles & Top-10 Indices — F1 Card Vault', desc: 'Driver-by-driver cards: form score, race results, top-10 index (S&P-style), market makers ≥$200.' },
  { path: '/sniper', title: 'Snipe F1 Cards — Auto-bid Setup — F1 Card Vault', desc: 'Set max bids on F1 cards. Auto-snipe when listings drop below your number. Powered by real eBay data.' },
  { path: '/portfolio', title: 'Track Your F1 Card Portfolio — F1 Card Vault', desc: 'Track cost basis, P&L, and sell recommendations for your 2025 Topps Chrome F1 collection.' },
  { path: '/wishlist', title: 'F1 Card Wishlist & Price Alerts — F1 Card Vault', desc: 'Add cards you want — get pinged the moment one drops below your max price.' },
  { path: '/graded', title: 'PSA / BGS Graded F1 Card Tracker — F1 Card Vault', desc: 'Graded comp tracker for 2025 Topps Chrome F1. PSA 10 / 9 medians, grade-premium calc, recent sales.' },
  { path: '/grade', title: 'AI Card Grade Predictor — F1 Card Vault', desc: 'Upload a card photo. Claude predicts likely PSA grade based on visible condition.' },
  { path: '/compare', title: 'Compare F1 Cards Side-by-Side — F1 Card Vault', desc: 'Compare any two 2025 Topps Chrome F1 cards: price history, parallel premiums, grade values.' },
  { path: '/how-we-score', title: 'How We Score F1 Card Auctions — F1 Card Vault', desc: 'Methodology behind STRONG_BUY, GOOD_BUY, FAIR, OVERPRICED, PASS verdicts. 90-day median + comp count.' },
  { path: '/about', title: 'About F1 Card Vault', desc: 'Built by F1 fans, for F1 fans. Live eBay data, real-time prices, no hype.' },
  { path: '/faq', title: 'FAQ — F1 Card Vault', desc: 'Common questions about price tracking, alerts, snipes, and auctions.' },
]

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function perRouteHtml() {
  return {
    name: 'per-route-html',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(process.cwd(), 'dist')
      const indexPath = path.join(dist, 'index.html')
      if (!fs.existsSync(indexPath)) return
      const template = fs.readFileSync(indexPath, 'utf-8')
      for (const r of ROUTES) {
        if (r.path === '/') continue
        const title = escapeHtml(r.title)
        const desc = escapeHtml(r.desc)
        const url = `https://www.f1cardvault.com${r.path}`
        let html = template
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        html = html.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${desc}"`)
        html = html.replace(/property="og:title" content="[^"]*"/, `property="og:title" content="${title}"`)
        html = html.replace(/property="og:description" content="[^"]*"/, `property="og:description" content="${desc}"`)
        html = html.replace(/property="og:url" content="[^"]*"/, `property="og:url" content="${url}"`)
        // og:image absolute URL — social crawlers (FB/LinkedIn/Discord) require absolute.
        // Until per-route OG images are generated, every route points at the same
        // /og-image.png. To add a per-route image later: extend the ROUTES entry with
        // `og: '/og-sales.png'` (or similar) and replace the path below with `r.og || '/og-image.png'`.
        html = html.replace(/property="og:image" content="[^"]*"/, `property="og:image" content="https://www.f1cardvault.com/og-image.png"`)
        html = html.replace(/name="twitter:image" content="[^"]*"/, `name="twitter:image" content="https://www.f1cardvault.com/og-image.png"`)
        html = html.replace(/name="twitter:title" content="[^"]*"/, `name="twitter:title" content="${title}"`)
        html = html.replace(/name="twitter:description" content="[^"]*"/, `name="twitter:description" content="${desc}"`)
        html = html.replace(/name="twitter:url" content="[^"]*"/, `name="twitter:url" content="${url}"`)
        const outDir = path.join(dist, r.path.slice(1))
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'index.html'), html)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({ org: 'f1cardvault', project: 'f1cardvault', authToken: process.env.SENTRY_AUTH_TOKEN }),
    perRouteHtml(),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Only force-split react itself. Letting Rollup auto-chunk the rest
        // means recharts goes only into the chunks that actually import it
        // (Drivers, GradedTracker, AffiliateROI, Indices) — not preloaded
        // on /bin, /sales, etc. The previous 'charts' manualChunk was 548KB
        // and got modulepreloaded everywhere via <link rel="modulepreload">,
        // and on slow networks would race React's hydration → React error
        // #426 (Suspense interrupted). Removing the manual split fixes that
        // AND reduces total transfer on chart-free pages.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        }
      }
    }
  }
})
