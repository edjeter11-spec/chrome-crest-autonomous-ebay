import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export function VerdictFeedback({ saleId, verdictKey, onFeedbackSubmitted }) {
  const [feedback, setFeedback] = useState(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (type) => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/verdicts/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          sold_card_id: saleId,
          verdict_key: verdictKey,
          feedback: type,
        }).toString(),
      })
      if (res.ok) {
        setFeedback(type)
        setSubmitted(true)
        if (onFeedbackSubmitted) onFeedbackSubmitted(type)
        setTimeout(() => setSubmitted(false), 2000)
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <span className="text-[10px] text-green-400 font-bold">✓ Thanks!</span>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <button
        disabled={loading}
        onClick={() => handleSubmit('up')}
        className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
          feedback === 'up'
            ? 'bg-green-600/40 text-green-400'
            : 'bg-gray-800 hover:bg-green-600/30 text-gray-500 hover:text-green-400'
        } disabled:opacity-50`}
        title="Was this verdict accurate?"
      >
        <ThumbsUp size={11} />
      </button>
      <button
        disabled={loading}
        onClick={() => handleSubmit('down')}
        className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
          feedback === 'down'
            ? 'bg-red-600/40 text-red-400'
            : 'bg-gray-800 hover:bg-red-600/30 text-gray-500 hover:text-red-400'
        } disabled:opacity-50`}
        title="Did this verdict miss?"
      >
        <ThumbsDown size={11} />
      </button>
    </div>
  )
}
