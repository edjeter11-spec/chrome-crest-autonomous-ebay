import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Auctions from './pages/Auctions'
import Portfolio from './pages/Portfolio'
import Wishlist from './pages/Wishlist'
import PriceHistory from './pages/PriceHistory'
import AlertsPage from './pages/Alerts'
import Analytics from './pages/Analytics'
import Drivers from './pages/Drivers'
import PSA from './pages/PSA'
import BuyItNow from './pages/BuyItNow'
import GradedCards from './pages/GradedCards'
import SalesDatabase from './pages/SalesDatabase'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="auctions" element={<Auctions />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="wishlist" element={<Wishlist />} />
          <Route path="price-history" element={<PriceHistory />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="psa" element={<PSA />} />
          <Route path="bin" element={<BuyItNow />} />
          <Route path="graded" element={<GradedCards />} />
          <Route path="sales" element={<SalesDatabase />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
