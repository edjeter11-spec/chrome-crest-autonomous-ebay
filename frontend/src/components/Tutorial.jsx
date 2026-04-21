import { useState, useMemo } from 'react'
import { X, Gavel, Tag, Database, Users, Share, Smartphone, Target, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

const CARDS = [
  { icon: Gavel,    title: 'Live Auctions',    body: 'Ending soon. Watch countdowns, snipe scores, and place bids.',     to: '/auctions',  color: 'text-red-400' },
  { icon: Tag,      title: 'Buy It Now',       body: 'Fixed-price listings with price filters and instant purchase.',     to: '/bin',       color: 'text-green-400' },
  { icon: Database, title: 'Sold Database',    body: 'Every sold comp, filterable by driver, parallel, grade.',           to: '/sales',     color: 'text-blue-400' },
  { icon: Users,    title: 'Driver Profiles',  body: 'Tap any driver for 90-day price charts and top sales.',             to: '/drivers',   color: 'text-purple-400' },
  { icon: Target,   title: 'Snipe Alerts',     body: 'Set price rules — get push notifications when a listing matches.',  to: '/sniper',    color: 'text-orange-400' },
  { icon: Sparkles, title: 'Scan & Track',     body: 'Snap a card, AI identifies it, we track comps in My Cards.',        to: '/portfolio', color: 'text-pink-400' },
]

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

function InstallStep({ platform }) {
  if (platform === 'ios') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Smartphone size={14} className="text-cyan-400" /> Install on iPhone
        </div>
        <ol className="text-xs text-gray-300 space-y-1.5 list-decimal pl-5">
          <li>Tap the <Share size={11} className="inline text-cyan-400" /> <span className="font-semibold">Share</span> button at the bottom of Safari.</li>
          <li>Scroll and tap <span className="font-semibold text-white">Add to Home Screen</span>.</li>
          <li>Tap <span className="font-semibold text-white">Add</span> — F1 Card Hub opens full-screen like an app, with push-alert support.</li>
        </ol>
      </div>
    )
  }
  if (platform === 'android') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Smartphone size={14} className="text-green-400" /> Install on Android
        </div>
        <ol className="text-xs text-gray-300 space-y-1.5 list-decimal pl-5">
          <li>Open the Chrome menu (three dots, top-right).</li>
          <li>Tap <span className="font-semibold text-white">Install app</span> or <span className="font-semibold text-white">Add to Home screen</span>.</li>
          <li>Confirm — the app launches full-screen and can push snipe alerts.</li>
        </ol>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-white font-bold text-sm">
        <Smartphone size={14} className="text-cyan-400" /> Install as an app
      </div>
      <p className="text-xs text-gray-400">
        On your phone, open this page in Safari (iPhone) or Chrome (Android), then use <span className="font-semibold text-white">Share → Add to Home Screen</span> (iOS) or the browser menu → <span className="font-semibold text-white">Install app</span> (Android). Full-screen, fast, push-notifiable.
      </p>
    </div>
  )
}

export default function Tutorial({ onClose }) {
  const [step, setStep] = useState(0)
  const platform = useMemo(detectPlatform, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700/60 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60 sticky top-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-white font-black text-lg tracking-tight">
              {step === 0 ? 'Welcome to F1 Card Hub' : 'Install on your phone'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === 0 ? 'Six things to know' : 'Turn this into a real app — takes 5 seconds'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {step === 0 && (
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
        )}

        {step === 1 && (
          <div className="p-5 space-y-4">
            <div className="bg-gradient-to-br from-cyan-900/30 to-indigo-900/20 border border-cyan-700/40 rounded-xl p-4">
              <InstallStep platform={platform} />
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              Push notifications — including snipe alerts — only work after you install. Mobile browsers block web-push on regular tabs (iOS Safari requires the home-screen install specifically).
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-gray-800/60 flex items-center justify-between text-xs sticky bottom-0 bg-gray-900">
          <span className="text-gray-500">
            {step === 0
              ? <>Tap the <span className="text-white font-semibold">?</span> bubble anytime to see this again</>
              : <button onClick={() => setStep(0)} className="text-gray-400 hover:text-white">← Back</button>}
          </span>
          {step === 0 ? (
            <button onClick={() => setStep(1)} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg">
              Install on phone →
            </button>
          ) : (
            <button onClick={onClose} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg">
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
