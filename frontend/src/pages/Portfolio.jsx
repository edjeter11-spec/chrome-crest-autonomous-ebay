import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Package, Pencil, Trash2, X, Check } from 'lucide-react'
import StatCard from '../components/StatCard'
import { swrFetch } from '../lib/cache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function PnlCell({ value, pct }) {
  const positive = value >= 0
  const color = positive ? 'text-green-400' : 'text-red-400'
  return (
    <div className={`text-right ${color}`}>
      <div className="font-semibold">{positive ? '+' : ''}${value.toFixed(2)}</div>
      <div className="text-[10px] opacity-70">{positive ? '+' : ''}{pct.toFixed(1)}%</div>
    </div>
  )
}

function EditRow({ item, onSave, onCancel }) {
  const [qty, setQty] = useState(item.quantity || 1)
  const [price, setPrice] = useState(item.purchase_price || 0)
  const [notes, setNotes] = useState(item.notes || '')

  const save = async () => {
    await fetch(`${API}/api/portfolio/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: Number(qty), purchase_price: Number(price), notes }),
    })
    onSave()
  }

  return (
    <tr className="bg-gray-800/40">
      <td><div className="w-9 h-11 rounded-lg bg-gray-800 flex items-center justify-center text-base">🏎</div></td>
      <td><div className="font-semibold text-white text-sm">{item.card?.driver_name}</div></td>
      <td className="text-gray-500 text-xs">{item.card?.parallel}</td>
      <td className="text-xs text-gray-400">{item.card?.grade}</td>
      <td className="text-right">
        <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
          className="w-14 bg-gray-700 text-white text-xs rounded px-2 py-1 text-right border border-gray-600" />
      </td>
      <td className="text-right">
        <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
          className="w-20 bg-gray-700 text-white text-xs rounded px-2 py-1 text-right border border-gray-600" />
      </td>
      <td className="text-right text-green-400">${item.current_value?.toFixed(2)}</td>
      <td>
        <div className="flex items-center justify-end gap-1">
          <button onClick={save} className="p-1 text-green-400 hover:text-green-300"><Check size={13} /></button>
          <button onClick={onCancel} className="p-1 text-gray-500 hover:text-gray-300"><X size={13} /></button>
        </div>
      </td>
      <td></td>
    </tr>
  )
}

export default function Portfolio() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const load = () => swrFetch(`${API}/api/portfolio`, d => { setItems(d.items || d || []); setLoading(false) })

  useEffect(() => { load() }, [])

  const deleteItem = async (id) => {
    if (!confirm('Remove this holding?')) return
    setItems(prev => prev.filter(i => i.id !== id))
    await fetch(`${API}/api/portfolio/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const totalCost = items.reduce((s, i) => s + (i.purchase_price * (i.quantity || 1)), 0)
  const totalValue = items.reduce((s, i) => s + (i.current_value * (i.quantity || 1)), 0)
  const totalPnl = totalValue - totalCost
  const pnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0
  const totalCards = items.reduce((s, i) => s + (i.quantity || 1), 0)

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="page-title">Portfolio</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Cost" value={loading ? null : `$${totalCost.toFixed(0)}`} icon={DollarSign} color="blue" />
        <StatCard label="Current Value" value={loading ? null : `$${totalValue.toFixed(0)}`} icon={TrendingUp} color="green" />
        <StatCard
          label="Total P&L"
          value={loading ? null : `${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(0)}`}
          sub={`${pnlPct.toFixed(1)}%`}
          icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
          color={totalPnl >= 0 ? 'green' : 'red'}
        />
        <StatCard label="Cards Owned" value={loading ? null : totalCards} icon={Package} color="purple" />
      </div>

      {loading ? (
        <div className="panel h-64 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-20 text-gray-600">
          <Package size={36} className="mb-4 opacity-20" />
          <p className="text-sm font-medium">No holdings yet</p>
          <p className="text-xs mt-1 text-gray-700">Add cards from the Auctions page</p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-800/60 flex items-center justify-between">
            <h2 className="font-bold text-white text-sm">Holdings</h2>
            <span className="text-xs text-gray-500">{items.length} positions · {totalCards} cards</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr>
                  <th className="w-12"></th>
                  <th>Driver</th>
                  <th>Parallel</th>
                  <th>Grade</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">P&L</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  if (editing === item.id) {
                    return <EditRow key={item.id} item={item} onSave={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
                  }
                  const cost = item.purchase_price * (item.quantity || 1)
                  const val = item.current_value * (item.quantity || 1)
                  const pnl = val - cost
                  const pct = cost > 0 ? pnl / cost * 100 : 0
                  return (
                    <tr key={item.id} className="group">
                      <td>
                        <div className="w-9 h-11 rounded-lg bg-gray-800 flex items-center justify-center text-base">🏎</div>
                      </td>
                      <td>
                        <div className="font-semibold text-white">{item.card?.driver_name}</div>
                        {item.notes && <div className="text-[10px] text-gray-600 truncate max-w-[120px]">{item.notes}</div>}
                      </td>
                      <td className="text-gray-500 text-xs">{item.card?.parallel || '—'}</td>
                      <td>
                        {item.card?.grade && item.card.grade !== 'Raw' ? (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400 border border-yellow-800/30">
                            {item.card.grade}
                          </span>
                        ) : <span className="text-xs text-gray-600">{item.card?.grade || '—'}</span>}
                      </td>
                      <td className="text-right font-medium">{item.quantity || 1}</td>
                      <td className="text-right text-gray-300">${item.purchase_price?.toFixed(2)}</td>
                      <td className="text-right text-green-400 font-medium">${item.current_value?.toFixed(2)}</td>
                      <td><PnlCell value={pnl} pct={pct} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditing(item.id)} className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors">
                            <Pencil size={11} />
                          </button>
                          <button onClick={() => deleteItem(item.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
