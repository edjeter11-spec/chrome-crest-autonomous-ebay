import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ArrowRight, Sparkles, Flame, Bell } from 'lucide-react'
import { useAuth } from '../lib/auth'

const STORAGE_KEY = 'cc_onboarding_v2_dismissed'

const STEPS = [
  {
    icon: Sparkles,
    title: 'Welcome to F1 Card Vault',
    body: 'The fastest way to track every 2025 Topps Chrome F1 card. Live auctions, sold comps, and PSA pop — all in one place.',
    cta: 'Show me around',
  },
  {
    icon: Flame,
    title: 'See live deals',
    body: 'Live Auctions ending soon are flagged with snipe scores. Filter by driver, parallel, or print run.',
    cta: 'Open Live Auctions',
    href: '/auctions',
  },
  {
    icon: Bell,
    title: 'Set your first alert',
    body: 'Get notified when a card hits your target price. Set up Sniper rules in 30 seconds.',
    cta: 'Go to Sniper',
    href: '/sniper',
  },
]

export default function OnboardingTour() {
  const [step, setStep] = useState(0)
  const [show, setShow] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY)
      if (dismissed) return
      // Returning signed-in users skip the tour entirely
      if (user) return
      // Only show on home page on first ever visit
      if (window.location.pathname === '/') {
        // Slight delay so dashboard has time to render first
        const t = setTimeout(() => setShow(true), 800)
        return () => clearTimeout(t)
      }
    } catch {}
  }, [user])

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())) } catch {}
    setShow(false)
  }

  const next = () => {
    const current = STEPS[step]
    if (current.href) navigate(current.href)
    if (step >= STEPS.length - 1) { dismiss(); return }
    setStep(step + 1)
  }

  if (!show) return null

  const s = STEPS[step]
  const Icon = s.icon

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-gray-500 hover:text-white p-2 rounded-lg hover:bg-gray-800"
          aria-label="Skip tour"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center">
            <Icon size={24} className="text-red-400" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Step {step + 1} of {STEPS.length}
            </div>
            <h3 className="text-lg font-black text-white mt-0.5">{s.title}</h3>
          </div>
        </div>

        <p className="text-gray-300 text-sm leading-relaxed mb-5">{s.body}</p>

        <div className="flex gap-2">
          <button
            onClick={next}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm"
          >
            {s.cta} <ArrowRight size={14} />
          </button>
          <button
            onClick={dismiss}
            className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold rounded-xl text-sm"
          >
            Skip
          </button>
        </div>

        <div className="flex justify-center gap-1.5 mt-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${i === step ? 'w-8 bg-red-500' : 'w-1.5 bg-gray-700'}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
