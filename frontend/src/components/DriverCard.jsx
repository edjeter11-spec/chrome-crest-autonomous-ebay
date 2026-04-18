import { useState, useEffect } from 'react'
import { Trophy } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const proxyImg = (url) => {
  if (!url) return ''
  if (url.includes('i.ebayimg.com')) return url
  return `${API}/api/proxy/image?url=${encodeURIComponent(url)}`
}

const TIER_STYLES = {
  S: 'bg-yellow-500 text-black',
  A: 'bg-blue-600 text-white',
  B: 'bg-green-700 text-white',
  C: 'bg-gray-600 text-white',
}

export default function DriverCard({ driver, onClick }) {
  const tier = driver.investment_score >= 90 ? 'S' : driver.investment_score >= 80 ? 'A' : driver.investment_score >= 65 ? 'B' : 'C'
  const teamColor = driver.team_color || '#666'
  const photoUrl = driver.image_url && !driver.image_url.includes('placehold.co')
    ? driver.image_url : null

  return (
    <div
      className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden card-hover cursor-pointer"
      style={{ borderTopColor: teamColor, borderTopWidth: 3 }}
      onClick={() => onClick?.(driver)}
    >
      {/* Driver headshot */}
      {photoUrl && !photoUrl.includes('placehold.co') && (
        <div className="relative h-36 overflow-hidden"
          style={{ background: `linear-gradient(135deg, #111 0%, ${teamColor}33 100%)` }}>
          <img
            src={proxyImg(photoUrl)}
            alt={driver.driver_name}
            className="w-full h-full object-cover object-top"
            onError={e => { e.target.style.display = 'none' }}
          />
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(180deg, transparent 50%, rgba(17,17,17,0.95) 100%)' }} />
          <span className={`absolute top-2 right-2 text-xs font-black px-2 py-0.5 rounded ${TIER_STYLES[tier]}`}>{tier}</span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-white text-sm">{driver.driver_name}</h3>
            <p className="text-xs text-gray-400">{driver.team}</p>
          </div>
          {(!photoUrl || photoUrl.includes('placehold.co')) && (
            <span className={`text-xs font-black px-2 py-0.5 rounded ${TIER_STYLES[tier]}`}>{tier}</span>
          )}
        </div>

        {/* Score bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Investment Score</span>
            <span className="text-white font-bold">{driver.investment_score?.toFixed(0)}</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${driver.investment_score}%`, backgroundColor: teamColor }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-sm font-bold text-white">{driver.championships || 0}</div>
            <div className="text-xs text-gray-600 flex items-center justify-center gap-0.5"><Trophy size={9} />WDC</div>
          </div>
          <div>
            <div className="text-sm font-bold text-white">{driver.career_wins || 0}</div>
            <div className="text-xs text-gray-600">Wins</div>
          </div>
          <div>
            <div className="text-sm font-bold text-white">#{driver.card_number || '—'}</div>
            <div className="text-xs text-gray-600">Card #</div>
          </div>
        </div>

        {driver.base_value && (
          <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between items-center">
            <span className="text-xs text-gray-500">Base value</span>
            <span className="text-sm font-bold text-green-400">${driver.base_value?.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
