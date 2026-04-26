import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { ExternalLink, Search, X, DollarSign, TrendingUp, Package } from 'lucide-react'
import { swrFetch } from '../lib/cache'
import { ebayAffiliateUrl } from '../lib/ebay'
import AuctionCard from '../components/AuctionCard'
import Breadcrumbs from '../components/Breadcrumbs'
import LoadingSpinner from '../components/LoadingSpinner'

const API = import.meta.env.VITE_API_URL || ''

export default function ParallelLanding() {
  const { parallel: parallelSlug } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Filters from query params
  const [driverFilter, setDriverFilter] = useState(searchParams.get('driver') || '')
  const [gradeFilter, setGradeFilter] = useState(searchParams.get('grade') || '')
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'price_low')

  // Data
  const { data, isLoading, error } = swrFetch(
    `${API}/api/seo/parallel/${parallelSlug}`
  )

  const cards = data?.cards || []
  const priceStats = data?.price_stats || {}
  const uniqueDrivers = data?.unique_drivers || []
  const uniqueGrades = data?.unique_grades || []
  const parallelName = data?.parallel || parallelSlug?.replace(/-/g, ' ')

  // Filter and sort
  const filtered = cards.filter(c => {
    if (driverFilter && c.driver_slug !== driverFilter.toLowerCase().replace(' ', '-')) return false
    if (gradeFilter && c.grade !== gradeFilter) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const aPrice = a.current_price || 0
    const bPrice = b.current_price || 0
    switch (sortBy) {
      case 'price_low':
        return aPrice - bPrice
      case 'price_high':
        return bPrice - aPrice
      case 'title':
        return (a.title || '').localeCompare(b.title || '')
      case 'newest':
        return new Date(b.created_at) - new Date(a.created_at)
      default:
        return 0
    }
  })

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    if (driverFilter) params.set('driver', driverFilter)
    if (gradeFilter) params.set('grade', gradeFilter)
    if (sortBy !== 'price_low') params.set('sort', sortBy)
    setSearchParams(params)
  }, [driverFilter, gradeFilter, sortBy, setSearchParams])

  // SEO metadata
  useEffect(() => {
    const title = `${parallelName} F1 Cards - Prices & Comps | F1 Card Vault`
    const description = `Shop ${parallelName} trading cards. ${sorted.length} listings. Lowest: $${priceStats.lowest?.toFixed(2) || 'N/A'}, Avg: $${priceStats.average?.toFixed(2) || 'N/A'}.`

    document.title = title
    const metaDesc = document.querySelector('meta[name="description"]')
    if (metaDesc) metaDesc.setAttribute('content', description)
  }, [parallelName, sorted.length, priceStats])

  if (isLoading) return <LoadingSpinner />
  if (error) return (
    <div className="p-6 text-center text-red-400">
      Error loading parallel: {error.message}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900">
      <Breadcrumbs items={[
        { label: 'Home', href: '/' },
        { label: 'Parallels', href: '#' },
        { label: parallelName },
      ]} />

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">{parallelName} Cards</h1>
          <p className="text-gray-400 mb-6">
            {sorted.length} active listing{sorted.length !== 1 ? 's' : ''} • {uniqueDrivers.length} driver{uniqueDrivers.length !== 1 ? 's' : ''}
          </p>

          {/* Price Stats */}
          {priceStats.lowest !== null && (
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="text-xs text-gray-400 mb-1 flex items-center gap-2">
                  <DollarSign size={14} />
                  LOWEST
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  ${priceStats.lowest?.toFixed(2) || 'N/A'}
                </div>
              </div>

              <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="text-xs text-gray-400 mb-1 flex items-center gap-2">
                  <TrendingUp size={14} />
                  AVERAGE
                </div>
                <div className="text-2xl font-bold text-blue-400">
                  ${priceStats.average?.toFixed(2) || 'N/A'}
                </div>
              </div>

              <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="text-xs text-gray-400 mb-1 flex items-center gap-2">
                  <Package size={14} />
                  HIGHEST
                </div>
                <div className="text-2xl font-bold text-orange-400">
                  ${priceStats.highest?.toFixed(2) || 'N/A'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-4">Filters</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Driver Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Driver</label>
              <select
                value={driverFilter}
                onChange={e => setDriverFilter(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              >
                <option value="">All Drivers</option>
                {uniqueDrivers.map(d => (
                  <option key={d} value={d.toLowerCase().replace(' ', '-')}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Grade Filter */}
            {uniqueGrades.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Grade</label>
                <select
                  value={gradeFilter}
                  onChange={e => setGradeFilter(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                >
                  <option value="">All Grades</option>
                  {uniqueGrades.map(g => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Sort By</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              >
                <option value="price_low">Price: Low → High</option>
                <option value="price_high">Price: High → Low</option>
                <option value="title">Title A → Z</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>

          {/* Reset Filters */}
          {(driverFilter || gradeFilter || sortBy !== 'price_low') && (
            <button
              onClick={() => {
                setDriverFilter('')
                setGradeFilter('')
                setSortBy('price_low')
              }}
              className="mt-4 text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1"
            >
              <X size={14} />
              Reset Filters
            </button>
          )}
        </div>

        {/* Cards Grid */}
        {sorted.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-4">No cards found matching your filters.</p>
            <button
              onClick={() => {
                setDriverFilter('')
                setGradeFilter('')
                setSortBy('price_low')
              }}
              className="text-blue-400 hover:text-blue-300 text-sm font-medium"
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sorted.map(card => (
              <div
                key={card.id}
                className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden hover:border-gray-500 transition-colors"
              >
                {/* Card Image */}
                {card.image_url && (
                  <div className="aspect-square bg-gray-700 overflow-hidden">
                    <img
                      src={card.image_url}
                      alt={card.title}
                      className="w-full h-full object-cover"
                      onError={e => {
                        e.target.style.display = 'none'
                      }}
                    />
                  </div>
                )}

                {/* Card Details */}
                <div className="p-4">
                  <p className="text-xs text-gray-400 mb-1">
                    {card.driver}
                  </p>

                  <h3 className="text-sm font-semibold text-white mb-2 line-clamp-2">
                    {card.title}
                  </h3>

                  {/* Grade Badge */}
                  {card.grade && (
                    <div className="inline-block bg-yellow-500/20 text-yellow-300 text-xs px-2 py-1 rounded mb-3">
                      {card.grade}
                    </div>
                  )}

                  {/* Price */}
                  <div className="mb-4">
                    <div className="text-2xl font-bold text-emerald-400">
                      ${card.current_price?.toFixed(2) || 'TBD'}
                    </div>
                    {card.buy_now_price && (
                      <div className="text-xs text-gray-400">
                        Buy Now: ${card.buy_now_price.toFixed(2)}
                      </div>
                    )}
                  </div>

                  {/* View on eBay Button */}
                  <a
                    href={ebayAffiliateUrl(card.ebay_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded text-sm transition-colors"
                  >
                    <ExternalLink size={14} />
                    View on eBay
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
