import { useState, useEffect, useCallback } from 'react'
import { Camera, Trash2, Plus, Sparkles } from 'lucide-react'
import { supabase, supabaseReady } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import ScanCardModal from '../components/ScanCardModal'
import TopPicks from '../components/TopPicks'

export default function MyCards() {
  const { user } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const load = useCallback(async () => {
    if (!supabaseReady || !user) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('user_portfolio')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error) setCards(data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const remove = async (id) => {
    if (!confirm('Delete this card?')) return
    await supabase.from('user_portfolio').delete().eq('id', id)
    load()
  }

  const totalValue = cards.reduce((s, c) => s + (Number(c.current_value || c.purchase_price) || 0), 0)
  const totalCost = cards.reduce((s, c) => s + (Number(c.purchase_price) || 0), 0)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white">My Cards</h1>
          <p className="text-gray-500 text-xs mt-1">Your personal scanned F1 collection</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg"
        >
          <Camera size={16} /> Scan new card
        </button>
      </div>

      <TopPicks />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Cards" value={cards.length} />
        <Stat label="Total cost" value={`$${totalCost.toFixed(0)}`} />
        <Stat label="Est. value" value={`$${totalValue.toFixed(0)}`} />
        <Stat label="Profit" value={`$${(totalValue - totalCost).toFixed(0)}`}
              color={totalValue >= totalCost ? 'text-green-400' : 'text-red-400'} />
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading…</div>}

      {!loading && cards.length === 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-8 text-center">
          <Sparkles size={32} className="text-purple-400 mx-auto mb-3" />
          <h3 className="text-white font-bold mb-1">Scan your first card</h3>
          <p className="text-gray-500 text-xs mb-4">Take a photo — AI will detect the driver, parallel, and predict a grade.</p>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2.5 rounded-xl inline-flex items-center gap-2"
          >
            <Camera size={14} /> Scan card
          </button>
        </div>
      )}

      {!loading && cards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {cards.map(c => (
            <div key={c.id} className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
              {c.photo_url ? (
                <img src={c.photo_url} alt="" className="w-full aspect-[3/4] object-cover" />
              ) : (
                <div className="w-full aspect-[3/4] bg-gray-800 flex items-center justify-center">
                  <Camera size={32} className="text-gray-700" />
                </div>
              )}
              <div className="p-2.5 space-y-1">
                <div className="text-xs font-bold text-white truncate">{c.driver_name || 'Unknown'}</div>
                <div className="text-[10px] text-gray-500 truncate">
                  {[c.parallel, c.card_number, c.grade].filter(Boolean).join(' · ')}
                </div>
                {c.purchase_price != null && (
                  <div className="text-[10px] text-gray-400">Paid ${Number(c.purchase_price).toFixed(0)}</div>
                )}
                <button
                  onClick={() => remove(c.id)}
                  className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 pt-1"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ScanCardModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={load} />
    </div>
  )
}

function Stat({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-3">
      <div className="text-[10px] text-gray-500 uppercase font-semibold">{label}</div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
    </div>
  )
}
