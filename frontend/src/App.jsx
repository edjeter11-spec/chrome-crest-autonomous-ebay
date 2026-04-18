import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Auctions from './pages/Auctions'
import BuyItNow from './pages/BuyItNow'

// Lazy-loaded pages (code-split to keep initial bundle lean)
const Portfolio = lazy(() => import('./pages/Portfolio'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const PriceHistory = lazy(() => import('./pages/PriceHistory'))
const AlertsPage = lazy(() => import('./pages/Alerts'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Drivers = lazy(() => import('./pages/Drivers'))
const PSA = lazy(() => import('./pages/PSA'))
const GradedCards = lazy(() => import('./pages/GradedCards'))
const GradedTracker = lazy(() => import('./pages/GradedTracker'))
const SalesDatabase = lazy(() => import('./pages/SalesDatabase'))
const Checklist = lazy(() => import('./pages/Checklist'))
const SealedEV = lazy(() => import('./pages/SealedEV'))
const GradePredictor = lazy(() => import('./pages/GradePredictor'))
const SharedWatchlist = lazy(() => import('./pages/SharedWatchlist'))
const EmbedPrice = lazy(() => import('./pages/EmbedPrice'))

const PageFallback = () => (
  <div className="p-6 text-gray-500 text-sm">Loading…</div>
)

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Standalone routes — no layout chrome */}
        <Route path="/share/watchlist/:token" element={<Suspense fallback={<PageFallback />}><SharedWatchlist /></Suspense>} />
        <Route path="/embed/price" element={<Suspense fallback={<PageFallback />}><EmbedPrice /></Suspense>} />

        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="auctions" element={<Auctions />} />
          <Route path="bin" element={<BuyItNow />} />
          <Route path="drivers" element={<Suspense fallback={<PageFallback />}><Drivers /></Suspense>} />
          <Route path="portfolio" element={<Suspense fallback={<PageFallback />}><Portfolio /></Suspense>} />
          <Route path="wishlist" element={<Suspense fallback={<PageFallback />}><Wishlist /></Suspense>} />
          <Route path="price-history" element={<Suspense fallback={<PageFallback />}><PriceHistory /></Suspense>} />
          <Route path="alerts" element={<Suspense fallback={<PageFallback />}><AlertsPage /></Suspense>} />
          <Route path="analytics" element={<Suspense fallback={<PageFallback />}><Analytics /></Suspense>} />
          <Route path="psa" element={<Suspense fallback={<PageFallback />}><GradedTracker /></Suspense>} />
          <Route path="graded" element={<Suspense fallback={<PageFallback />}><GradedTracker /></Suspense>} />
          <Route path="graded-cards" element={<Suspense fallback={<PageFallback />}><GradedCards /></Suspense>} />
          <Route path="sales" element={<Suspense fallback={<PageFallback />}><SalesDatabase /></Suspense>} />
          <Route path="checklist" element={<Suspense fallback={<PageFallback />}><Checklist /></Suspense>} />
          <Route path="sealed" element={<Suspense fallback={<PageFallback />}><SealedEV /></Suspense>} />
          <Route path="grade" element={<Suspense fallback={<PageFallback />}><GradePredictor /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
