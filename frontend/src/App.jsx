import { lazy, Suspense, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Auctions from './pages/Auctions'
import BuyItNow from './pages/BuyItNow'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './lib/auth'

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
const Portfolio = lazy(() => import('./pages/Portfolio'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const AlertsPage = lazy(() => import('./pages/Alerts'))
const Drivers = lazy(() => import('./pages/Drivers'))
const GradedTracker = lazy(() => import('./pages/GradedTracker'))
const SalesDatabase = lazy(() => import('./pages/SalesDatabase'))
const GradePredictor = lazy(() => import('./pages/GradePredictor'))
const SharedWatchlist = lazy(() => import('./pages/SharedWatchlist'))
const EmbedPrice = lazy(() => import('./pages/EmbedPrice'))
const CardPage = lazy(() => import('./pages/CardPage'))
const Compare = lazy(() => import('./pages/Compare'))
const MyCards = lazy(() => import('./pages/MyCards'))
const About = lazy(() => import('./pages/About'))
const Arbitrage = lazy(() => import('./pages/Arbitrage'))
const GradeProfit = lazy(() => import('./pages/GradeProfit'))
const Sniper = lazy(() => import('./pages/Sniper'))

const PageFallback = () => (
  <div className="p-6 text-gray-500 text-sm">Loading…</div>
)

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
    <BrowserRouter>
      <Routes>
        {/* Standalone routes — no layout chrome */}
        <Route path="/share/watchlist/:token" element={<Suspense fallback={<PageFallback />}><SharedWatchlist /></Suspense>} />
        <Route path="/embed/price" element={<Suspense fallback={<PageFallback />}><EmbedPrice /></Suspense>} />

        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="login" element={<Login />} />
          <Route path="auctions" element={<Auctions />} />
          <Route path="bin" element={<BuyItNow />} />
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
          <Route path="arbitrage" element={<Suspense fallback={<PageFallback />}><Arbitrage /></Suspense>} />
          <Route path="grade-profit" element={<Navigate to="/arbitrage?tab=grade" replace />} />
          <Route path="sniper" element={<Suspense fallback={<PageFallback />}><Sniper /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  )
}
