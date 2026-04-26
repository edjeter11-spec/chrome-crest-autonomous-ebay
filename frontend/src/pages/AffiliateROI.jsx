import { useState, useEffect } from 'react'
import { TrendingUp, DollarSign, Zap, Target, AlertCircle, ChevronRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../lib/auth'

const API = import.meta.env.VITE_API_URL || ''

function StatCard({ icon: Icon, label, value, subtext, trend }) {
  return (
    <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-gray-400 text-xs font-black uppercase mb-1">{label}</div>
          <div className="text-2xl font-black text-white">{value}</div>
          {subtext && <div className="text-xs text-gray-500 mt-1">{subtext}</div>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          trend === 'up' ? 'bg-green-500/20' : 'bg-gray-800'
        }`}>
          <Icon size={18} className={trend === 'up' ? 'text-green-400' : 'text-gray-400'} />
        </div>
      </div>
    </div>
  )
}

function ProUpsellBanner() {
  return (
    <div className="bg-gradient-to-r from-purple-900/40 to-indigo-900/30 border border-purple-700/50 rounded-2xl p-5 mb-6 flex items-start gap-4">
      <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
        <Zap size={20} className="text-purple-300" />
      </div>
      <div className="flex-1">
        <div className="font-black text-white mb-1">Upgrade to Pro for automated buying</div>
        <div className="text-sm text-purple-200/80 mb-3">
          These snipes were opportunities you could have captured automatically with:
        </div>
        <div className="flex flex-col gap-2 text-xs text-purple-300/90 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-purple-400"></div>
            <span>Auto-buy alerts the moment a listing matches your rules</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-purple-400"></div>
            <span>Discord notifications so you never miss an opportunity</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-purple-400"></div>
            <span>Real-time profit tracking as the market moves</span>
          </div>
        </div>
        <button className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-black rounded-lg transition-colors">
          Learn about Pro
        </button>
      </div>
    </div>
  )
}

export default function AffiliateROI() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const headers = {}
        if (user?.access_token) {
          headers['Authorization'] = `Bearer ${user.access_token}`
        }
        const res = await fetch(`${API}/api/affiliate-roi`, { headers })
        if (!res.ok) throw new Error('Failed to load ROI data')
        const json = await res.json()
        setData(json)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [user])

  if (loading) {
    return (
      <div className="p-6 text-gray-500 text-sm">
        <div className="animate-pulse">Loading affiliate ROI data…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-700/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-black text-white text-sm">Error loading data</div>
            <div className="text-xs text-red-300/80 mt-0.5">{error || 'No affiliate data available'}</div>
          </div>
        </div>
      </div>
    )
  }

  const summary = data.summary || {}
  const snipes = data.snipes || []
  const timeline = data.daily_timeline || []

  const formatPrice = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const formatPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-black p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Target size={28} className="text-green-400" />
            <h1 className="text-3xl font-black text-white">Affiliate ROI Dashboard</h1>
          </div>
          <p className="text-gray-400 text-sm">Potential profit from sniper rules matched in the last 30 days</p>
        </div>

        {/* Pro Upsell Banner */}
        <ProUpsellBanner />

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={DollarSign}
            label="Potential Gain"
            value={formatPrice(summary.total_unrealized_gain)}
            subtext={formatPct(summary.percent_roi)}
            trend={summary.percent_roi > 0 ? 'up' : 'down'}
          />
          <StatCard
            icon={Target}
            label="Snipes Matched"
            value={summary.snipes_matched}
            subtext={`${formatPrice(summary.avg_purchase_price)} avg entry`}
          />
          <StatCard
            icon={TrendingUp}
            label="Total Investment"
            value={formatPrice(summary.total_investment)}
            subtext={`${summary.snipes_matched} purchases`}
          />
          <StatCard
            icon={Zap}
            label="ROI %"
            value={formatPct(summary.percent_roi)}
            trend={summary.percent_roi > 0 ? 'up' : 'down'}
          />
        </div>

        {/* Timeline Chart */}
        {timeline.length > 0 && (
          <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-black text-white mb-4">30-Day ROI Timeline</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9ca3af" style={{ fontSize: 12 }} />
                <YAxis stroke="#9ca3af" style={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: 8,
                  }}
                  formatter={(value) => formatPrice(value)}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="cumulative_roi"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ fill: '#10b981', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Snipes Table */}
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-lg font-black text-white">Snipes Captured ({snipes.length})</h2>
          </div>

          {snipes.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-gray-400 text-sm">No snipes matched yet</div>
              <div className="text-xs text-gray-500 mt-2">Create STRONG_BUY sniper rules to start tracking potential gains</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/20">
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-400 uppercase">Card</th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-400 uppercase">Driver</th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-400 uppercase">Rule</th>
                    <th className="px-6 py-3 text-right text-xs font-black text-gray-400 uppercase">Entry</th>
                    <th className="px-6 py-3 text-right text-xs font-black text-gray-400 uppercase">Comp Price</th>
                    <th className="px-6 py-3 text-right text-xs font-black text-gray-400 uppercase">Gain</th>
                    <th className="px-6 py-3 text-right text-xs font-black text-gray-400 uppercase">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {snipes.map((snipe, idx) => (
                    <tr key={idx} className="border-b border-gray-800/40 hover:bg-gray-900/20 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {snipe.card_image && (
                            <img
                              src={snipe.card_image}
                              alt={snipe.driver}
                              className="w-8 h-12 object-cover rounded"
                            />
                          )}
                          <div>
                            <div className="text-xs text-gray-300 truncate max-w-[200px]">{snipe.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{snipe.matched_at?.slice(0, 10)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="text-sm font-semibold text-white">{snipe.driver}</div>
                        <div className="text-xs text-gray-500">{snipe.parallel}</div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="text-xs text-gray-300">{snipe.rule_name}</div>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="text-sm font-semibold text-white">{formatPrice(snipe.entry_price)}</div>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="text-sm font-semibold text-white">{formatPrice(snipe.comp_price)}</div>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className={`text-sm font-semibold ${snipe.gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatPrice(snipe.gain)}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className={`text-sm font-semibold ${snipe.pct_gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatPct(snipe.pct_gain)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        {snipes.length > 0 && (
          <div className="mt-8 text-center p-6 bg-gray-900/20 rounded-xl border border-gray-800">
            <div className="mb-3">
              <div className="text-gray-300 text-sm">
                You missed out on <span className="font-black text-green-400">{formatPrice(summary.total_unrealized_gain)}</span> in potential profit
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Upgrade to Pro to automate these snipes and never miss another opportunity
              </div>
            </div>
            <button className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-black rounded-lg transition-colors">
              Upgrade to Pro
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
