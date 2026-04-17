import { useState, useEffect } from 'react'
import { Heart, Trash2, Zap } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Very High', 'Must Have']
const PRIORITY_STYLES = [
  '',
  'text-gray-400 bg-gray-800/60',
  'text-blue-400 bg-blue-900/20',
  'text-yellow-400 bg-yellow-900/20',
  'text-orange-400 bg-orange-900/20',
  'text-red-400 bg-red-900/20',
]

export default function Wishlist() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    swrFetch(`${API}/api/wishlist`, d => { setItems(d.items || d || []); setLoading(false) })
  }, [])

  const removeItem = async (id) => {
    await fetch(`${API}/api/wishlist/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const toggleAutoSnipe = async (id, current) => {
    await fetch(`${API}/api/wishlist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_snipe: !current })
    })
    setItems(prev => prev.map(i => i.id === id ? { ...i, auto_snipe: !current } : i))
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Wishlist</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading
              ? <span className="skeleton inline-block w-16 h-3.5 rounded" />
              : <span><span className="text-white font-semibold">{items.length}</span> tracked cards</span>
            }
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array(5).fill(0).map((_, i) => <div key={i} className="h-14 panel animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-20 text-gray-600">
          <Heart size={36} className="mb-4 opacity-20" />
          <p className="text-sm font-medium">No items in your wishlist</p>
          <p className="text-xs mt-1 text-gray-700">Add cards from the Auctions page to track them</p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full data-table">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>Driver</th>
                <th>Parallel · Grade</th>
                <th className="text-right">Max Price</th>
                <th className="text-center">Priority</th>
                <th className="text-center">Auto-Snipe</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>
                    <div className="w-9 h-11 rounded-lg bg-gray-800 flex items-center justify-center text-base">🏎</div>
                  </td>
                  <td>
                    <div className="font-semibold text-white">
                      {item.card?.driver_name || <span className="skeleton inline-block w-24 h-3.5 rounded" />}
                    </div>
                  </td>
                  <td>
                    <div className="text-xs text-gray-400">
                      {item.card?.parallel
                        ? <><span className="font-medium">{item.card.parallel}</span> · {item.card.grade}</>
                        : <span className="skeleton inline-block w-28 h-3 rounded" />
                      }
                    </div>
                  </td>
                  <td className="text-right">
                    <span className="font-bold text-green-400">
                      {item.max_price ? `$${item.max_price.toFixed(2)}` : <span className="skeleton inline-block w-12 h-3.5 rounded" />}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${PRIORITY_STYLES[item.priority] || ''}`}>
                      {PRIORITY_LABELS[item.priority] || item.priority}
                    </span>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleAutoSnipe(item.id, item.auto_snipe)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold mx-auto transition-colors ${
                        item.auto_snipe
                          ? 'bg-red-600/20 text-red-400 border border-red-600/30'
                          : 'bg-gray-800/60 text-gray-500 border border-gray-700/30 hover:text-gray-300'
                      }`}
                    >
                      <Zap size={9} /> {item.auto_snipe ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
