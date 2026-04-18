import { X, Gavel, Tag, Database, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

const CARDS = [
  { icon: Gavel,    title: 'Live Auctions',    body: 'Ending soon. Watch countdowns, snipe scores, and place bids.', to: '/auctions', color: 'text-red-400' },
  { icon: Tag,      title: 'Buy It Now',       body: 'Fixed-price listings with price filters and instant purchase.', to: '/bin',       color: 'text-green-400' },
  { icon: Database, title: 'Sold Database',    body: 'Every sold comp, filterable by driver, parallel, grade.',       to: '/sales',     color: 'text-blue-400' },
  { icon: Users,    title: 'Driver Profiles',  body: 'Tap any driver for 90-day price charts and top sales.',         to: '/drivers',   color: 'text-purple-400' },
]

export default function Tutorial({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700/60 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60">
          <div>
            <h2 className="text-white font-black text-lg tracking-tight">Welcome to Chrome Crest</h2>
            <p className="text-xs text-gray-500 mt-0.5">Four quick spots to know</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-5">
          {CARDS.map(({ icon: Icon, title, body, to, color }) => (
            <Link
              key={to}
              to={to}
              onClick={onClose}
              className="group bg-gray-800/50 hover:bg-gray-800 border border-gray-700/40 hover:border-gray-600 rounded-xl p-4 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`shrink-0 w-9 h-9 rounded-lg bg-gray-900 flex items-center justify-center ${color}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-white text-sm group-hover:text-white">{title}</div>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">{body}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-800/60 flex items-center justify-between text-xs">
          <span className="text-gray-500">Tap the <span className="text-white font-semibold">?</span> bubble anytime to see this again</span>
          <button onClick={onClose} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
