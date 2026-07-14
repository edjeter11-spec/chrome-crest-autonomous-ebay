import { useEffect, useState } from 'react'
import { upscaleEbayImage } from '../lib/imageUrl'
import CardImagePlaceholder from './CardImagePlaceholder'

// Card image with three upgrades baked in:
//   1. Auto-upscales eBay CDN URLs to a higher-res variant (s-l500 by default).
//   2. Shows a skeleton (`bg-gray-800 animate-pulse`) while loading.
//   3. Falls back to a clean F1-themed placeholder on error / missing src.
//
// Drop-in replacement for any small/medium card thumbnail.
export default function CardImage({
  src,
  alt = '',
  className = '',
  // Tailwind aspect-ratio fallback when a placeholder is shown standalone
  aspect = '3/4',
  // Pixel size hint for eBay upscaling. 300 is enough for every list/thumbnail
  // use across the app (largest is ~200px tile in ParallelLanding, smallest is
  // 32px in GradedTracker). Modal hero shots explicitly pass size={800}.
  size = 300,
  // Driver context drives the placeholder label + accent
  driverName,
  teamColor,
  // 'lazy' (default) or 'eager' for above-the-fold hero shots
  loading = 'lazy',
  // 'cover' (default — crop to fill) or 'contain' (fit, letterbox)
  fit = 'cover',
  // Optional inline styles forwarded onto the rendered <img> / placeholder
  style,
  // Extra padding around the image when using contain fit (e.g. 'p-3')
  imgClassName = '',
}) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Retry counter: a transient CDN error / burst throttle used to mark the
  // image failed FOREVER (the intermittent "no image after reload" bug).
  // Now we retry twice — with a cache-busting param so a poisoned edge
  // response doesn't just replay — before giving up to the placeholder.
  const [attempt, setAttempt] = useState(0)
  const upscaled = src ? upscaleEbayImage(src, size) : ''

  // Reset loading/error state when src changes — important for lists that
  // recycle the same DOM node across rows.
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
    setAttempt(0)
  }, [upscaled])

  const retryOrFail = () => {
    if (attempt < 2) {
      setAttempt(a => a + 1)
      setLoaded(false)
    } else {
      setFailed(true)
    }
  }

  // Max-wait timer per attempt: if the image doesn't fire onLoad OR onError
  // within 10s (was 3s — too aggressive on slow eBay CDN), retry/fail so
  // genuinely dead URLs can't hold an infinite skeleton.
  useEffect(() => {
    if (!upscaled || loaded || failed) return
    const id = setTimeout(retryOrFail, 10000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upscaled, loaded, failed, attempt])

  const displaySrc = attempt > 0
    ? `${upscaled}${upscaled.includes('?') ? '&' : '?'}retry=${attempt}`
    : upscaled

  if (!upscaled || failed) {
    return (
      <div
        className={className}
        style={{ aspectRatio: aspect, ...style }}
      >
        <CardImagePlaceholder driverName={driverName} teamColor={teamColor} />
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {!loaded && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse" aria-hidden="true" />
      )}
      <img
        key={attempt}
        src={displaySrc}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={retryOrFail}
        className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
      />
    </div>
  )
}
