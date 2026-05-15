import { lazy, Suspense, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import useKeyboardShortcuts from './lib/useKeyboardShortcuts'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import { AuthProvider, useAuth } from './lib/auth'

/**
 * Lazy-import wrapper with chunk-failure recovery.
 *
 * Symptom we're fixing: a user has a tab open across a deploy. New deploy
 * publishes new chunk hashes; the user's bundle still references the old
 * ones. They click a route, the browser fetches an asset that no longer
 * exists, lazy() rejects → React error #426 → ErrorBoundary catches it
 * and the whole app dies.
 *
 * Strategy:
 *   1. retry once after a brief delay (handles transient network blips)
 *   2. if still failing, force a hard reload — that fetches the fresh
 *      index.html which references the new chunk hashes
 *   3. rate-limit reloads via sessionStorage so a genuinely-broken state
 *      (offline / API down) doesn't loop forever
 */
function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      return await factory()
    } catch {
      await new Promise(r => setTimeout(r, 600))
      try {
        return await factory()
      } catch (err2) {
        const RELOAD_KEY = 'cc_chunk_reload_at'
        const last = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10)
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
          location.reload()
          // Stub so React doesn't see a pending rejection while we reload.
          return { default: () => null }
        }
        throw err2
      }
    }
  })
}

// ShortcutsHelp only renders when the user presses '?' — defer it.
const ShortcutsHelp = lazyWithRetry(() => import('./components/ShortcutsHelp'))
// ToastHost is tiny + visible from any action — eager (no Suspense flash on first toast).
import ToastHost from './components/ToastHost'

// Auctions/BuyItNow/Login are not the landing route — lazy-load to drop
// ~30-40KB from the main bundle. Dashboard stays eager since it IS the
// default route and we don't want a Suspense flash on first paint.
const Auctions = lazyWithRetry(() => import('./pages/Auctions'))
const BuyItNow = lazyWithRetry(() => import('./pages/BuyItNow'))
const Login = lazyWithRetry(() => import('./pages/Login'))

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    this.setState({ info })
    try { console.error('[ErrorBoundary]', error, info) } catch {}
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: 'monospace', color: '#f87171', background: '#0b0b0b', minHeight: '100vh' }}>
          <h2 style={{ color: '#fbbf24' }}>App crashed — error details:</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#9ca3af' }}>{this.state.info?.componentStack || ''}</pre>
          <button onClick={() => { this.setState({ error: null, info: null }); location.reload() }} style={{ padding: '8px 16px', marginTop: 12, background: '#374151', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="p-6 text-gray-500 text-sm">Loading…</div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  return children
}

// Lazy-loaded pages (code-split to keep initial bundle lean)
const Portfolio = lazyWithRetry(() => import('./pages/Portfolio'))
const Wishlist = lazyWithRetry(() => import('./pages/Wishlist'))
const AlertsPage = lazyWithRetry(() => import('./pages/Alerts'))
const Drivers = lazyWithRetry(() => import('./pages/Drivers'))
const GradedTracker = lazyWithRetry(() => import('./pages/GradedTracker'))
const SalesDatabase = lazyWithRetry(() => import('./pages/SalesDatabase'))
const GradePredictor = lazyWithRetry(() => import('./pages/GradePredictor'))
const SharedWatchlist = lazyWithRetry(() => import('./pages/SharedWatchlist'))
const EmbedPrice = lazyWithRetry(() => import('./pages/EmbedPrice'))
const CardPage = lazyWithRetry(() => import('./pages/CardPage'))
const Compare = lazyWithRetry(() => import('./pages/Compare'))
const About = lazyWithRetry(() => import('./pages/About'))
const FAQ = lazyWithRetry(() => import('./pages/FAQ'))
const Terms = lazyWithRetry(() => import('./pages/Terms'))
const Privacy = lazyWithRetry(() => import('./pages/Privacy'))
const Arbitrage = lazyWithRetry(() => import('./pages/Arbitrage'))
const GradeProfit = lazyWithRetry(() => import('./pages/GradeProfit'))
const Sniper = lazyWithRetry(() => import('./pages/Sniper'))
const Volatility = lazyWithRetry(() => import('./pages/Volatility'))
const Releases = lazyWithRetry(() => import('./pages/Releases'))
const Indices = lazyWithRetry(() => import('./pages/Indices'))
const DriverGuide = lazyWithRetry(() => import('./pages/DriverGuide'))
const RaceWeekend = lazyWithRetry(() => import('./pages/RaceWeekend'))
const ParallelLanding = lazyWithRetry(() => import('./pages/ParallelLanding'))
const AffiliateROI = lazyWithRetry(() => import('./pages/AffiliateROI'))
const AdminFeedback = lazyWithRetry(() => import('./pages/AdminFeedback'))
const HowWeScore = lazyWithRetry(() => import('./pages/HowWeScore'))

const PageFallback = () => (
  <div className="p-6 text-gray-500 text-sm">Loading…</div>
)

function GlobalShortcuts() {
  const navigate = useNavigate()
  useKeyboardShortcuts(navigate)
  return null
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
    <BrowserRouter>
      <GlobalShortcuts />
      <Suspense fallback={null}><ShortcutsHelp /></Suspense>
      <ToastHost />
      <Routes>
        {/* Standalone routes — no layout chrome */}
        <Route path="/share/watchlist/:token" element={<Suspense fallback={<PageFallback />}><SharedWatchlist /></Suspense>} />
        <Route path="/embed/price" element={<Suspense fallback={<PageFallback />}><EmbedPrice /></Suspense>} />

        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="login" element={<Suspense fallback={<PageFallback />}><Login /></Suspense>} />
          <Route path="auctions" element={<Suspense fallback={<PageFallback />}><Auctions /></Suspense>} />
          <Route path="bin" element={<Suspense fallback={<PageFallback />}><BuyItNow /></Suspense>} />
          <Route path="drivers" element={<Suspense fallback={<PageFallback />}><Drivers /></Suspense>} />
          <Route path="portfolio" element={<RequireAuth><Suspense fallback={<PageFallback />}><Portfolio /></Suspense></RequireAuth>} />
          <Route path="my-cards" element={<Navigate to="/portfolio" replace />} />
          <Route path="wishlist" element={<RequireAuth><Suspense fallback={<PageFallback />}><Wishlist /></Suspense></RequireAuth>} />
          <Route path="alerts" element={<Suspense fallback={<PageFallback />}><AlertsPage /></Suspense>} />
          <Route path="graded" element={<Suspense fallback={<PageFallback />}><GradedTracker /></Suspense>} />
          <Route path="sales" element={<Suspense fallback={<PageFallback />}><SalesDatabase /></Suspense>} />
          <Route path="grade" element={<Suspense fallback={<PageFallback />}><GradePredictor /></Suspense>} />
          <Route path="card/:slug" element={<Suspense fallback={<PageFallback />}><CardPage /></Suspense>} />
          <Route path="compare" element={<Suspense fallback={<PageFallback />}><Compare /></Suspense>} />
          <Route path="about" element={<Suspense fallback={<PageFallback />}><About /></Suspense>} />
          <Route path="faq" element={<Suspense fallback={<PageFallback />}><FAQ /></Suspense>} />
          <Route path="terms" element={<Suspense fallback={<PageFallback />}><Terms /></Suspense>} />
          <Route path="privacy" element={<Suspense fallback={<PageFallback />}><Privacy /></Suspense>} />
          <Route path="arbitrage" element={<Suspense fallback={<PageFallback />}><Arbitrage /></Suspense>} />
          <Route path="grade-profit" element={<Navigate to="/arbitrage?tab=grade" replace />} />
          <Route path="sniper" element={<Suspense fallback={<PageFallback />}><Sniper /></Suspense>} />
          <Route path="volatility" element={<Suspense fallback={<PageFallback />}><Volatility /></Suspense>} />
          <Route path="releases" element={<Suspense fallback={<PageFallback />}><Releases /></Suspense>} />
          <Route path="indices" element={<Suspense fallback={<PageFallback />}><Indices /></Suspense>} />
          <Route path="drivers/:slug/guide" element={<Suspense fallback={<PageFallback />}><DriverGuide /></Suspense>} />
          <Route path="race-weekend" element={<Suspense fallback={<PageFallback />}><RaceWeekend /></Suspense>} />
          <Route path="parallels/:parallel" element={<Suspense fallback={<PageFallback />}><ParallelLanding /></Suspense>} />
          <Route path="affiliate-roi" element={<Suspense fallback={<PageFallback />}><AffiliateROI /></Suspense>} />
          <Route path="admin/feedback" element={<Suspense fallback={<PageFallback />}><AdminFeedback /></Suspense>} />
          <Route path="how-we-score" element={<Suspense fallback={<PageFallback />}><HowWeScore /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  )
}
