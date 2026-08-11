import { useEffect, useRef, useState } from 'react'
import { upscaleEbayImage } from '../lib/imageUrl'
import CardImagePlaceholder from './CardImagePlaceholder'

// Request a retina-sharp variant on high-DPR screens (phones are 2-3x).
// Capped at 2x — beyond that the bytes outweigh the visible gain.
const DPR = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1

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
  const imgRef = useRef(null)
  const upscaled = src ? upscaleEbayImage(src, Math.round(size * DPR)) : ''

  // Reset loading/error state when src changes — important for lists that
  // recycle the same DOM node across rows.
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
    setAttempt(0)
  }, [upscaled])

  // Cached images can be `complete` BEFORE React attaches onLoad — the
  // handler then never fires and the card sat invisible (opacity-0 skeleton)
  // forever. That was the "click a card, go back, every image is gone" bug:
  // back-navigation serves all thumbnails from browser cache, so every one
  // of them hit this race at once.
  useEffect(() => {
    const el = imgRef.current
    if (!loaded && el && el.complete && el.naturalWidth > 0) setLoaded(true)
  })

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
  //
  // Hidden tabs don't count: browsers deprioritize/park image loads while a
  // tab is backgrounded but timers keep firing, so switching away for 30s
  // used to burn all 3 attempts and permanently black out the card. Re-arm
  // the full window instead of judging a load the browser never attempted.
  useEffect(() => {
    if (!upscaled || loaded || failed) return
    let id
    const arm = () => {
      id = setTimeout(() => {
        if (typeof document !== 'undefined' && document.hidden) { arm(); return }
        retryOrFail()
      }, 10000)
    }
    arm()
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upscaled, loaded, failed, attempt])

  // Tab-return self-heal: loads aborted while hidden can leave the image
  // stuck (failed, or complete-but-unnoticed since a hidden tab doesn't
  // re-render). On return, mark cached-complete images loaded and give
  // failed ones a fresh set of attempts.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const el = imgRef.current
      if (el && el.complete && el.naturalWidth > 0) {
        setLoaded(true)
      } else if (failed) {
        setFailed(false)
        setLoaded(false)
        setAttempt(0)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [failed])

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
        ref={imgRef}
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
