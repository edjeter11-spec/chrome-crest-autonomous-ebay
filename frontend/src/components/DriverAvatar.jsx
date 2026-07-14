import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

/**
 * Driver headshot with retry + initials fallback.
 *
 * The old inline <img onError={hide}> pattern left a blank circle forever if
 * the first request hit a cold /api/drivers/photo function or a transient
 * network error. This retries twice (cache-busting so a CDN-cached 404
 * doesn't defeat the retry), then falls back to the driver's initials
 * instead of an empty hole.
 */
export default function DriverAvatar({ name, className = '', style, alt, loading = 'lazy' }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setAttempt(0)
    setFailed(false)
  }, [name])

  const initials = (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  if (!name || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-800 text-gray-400 font-black select-none ${className}`}
        style={style}
        role="img"
        aria-label={alt ?? name ?? 'driver'}
      >
        {initials || '?'}
      </div>
    )
  }

  const src =
    `${API}/api/drivers/photo?name=${encodeURIComponent(name)}` +
    (attempt > 0 ? `&r=${attempt}` : '')

  return (
    <img
      key={attempt}
      src={src}
      alt={alt ?? name}
      className={className}
      style={style}
      loading={loading}
      decoding="async"
      onError={() => {
        if (attempt < 2) {
          setTimeout(() => setAttempt(a => a + 1), 600 * (attempt + 1))
        } else {
          setFailed(true)
        }
      }}
    />
  )
}
