import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { BarChart3 } from 'lucide-react'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f43f5e','#06b6d4']

const TooltipStyle = { background: '#111827', border: '1px solid #1f2937', color: '#f9fafb', borderRadius: '12px', fontSize: 12 }

export default function Analytics() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    swrFetch(`${API}/api/analytics/full`, d => setData(d), () => setLoading(false))
  }, [])

  const driverData = (data.by_driver || []).slice(0, 10)
  const parallelData = data.by_parallel || []

  const summaryStats = [
    { label: 'Total Cards', value: data.total_cards },
    { label: 'Active Auctions', value: data.active_auctions },
    { label: 'Snipe Targets', value: data.snipe_targets },
    { label: 'Avg Auction Price', value: data.avg_price ? `$${data.avg_price.toFixed(2)}` : null },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-7 h-7 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="page-title">Analytics</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryStats.map(({ label, value }) => (
          <div key={label} className="panel p-4 text-center">
            <div className="text-2xl font-black text-white">
              {value != null ? value : <span className="skeleton inline-block w-10 h-7 rounded" />}
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1.5 font-medium">{label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* By driver */}
        <div className="panel p-5">
          <h3 className="font-bold text-white mb-4 text-sm flex items-center gap-2">
            <BarChart3 size={14} className="text-gray-500" />
            Active Auctions by Driver
          </h3>
          {driverData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={driverData} layout="vertical" margin={{ right: 16 }}>
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="driver" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={90} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" fill="#ef4444" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-700">
              <BarChart3 size={32} className="opacity-20 mb-3" />
              <p className="text-xs">No data yet — sync eBay listings to populate</p>
            </div>
          )}
        </div>

        {/* By parallel */}
        <div className="panel p-5">
          <h3 className="font-bold text-white mb-4 text-sm flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-red-400 to-orange-400" />
            Auctions by Parallel Type
          </h3>
          {parallelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={parallelData}
                  dataKey="count"
                  nameKey="parallel"
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  innerRadius={40}
                  label={({ parallel, percent }) => `${parallel} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {parallelData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-700">
              <div className="w-16 h-16 rounded-full border-4 border-gray-800 opacity-20 mb-3" />
              <p className="text-xs">No parallel data yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
