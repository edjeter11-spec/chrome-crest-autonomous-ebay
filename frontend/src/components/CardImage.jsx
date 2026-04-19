import { useState } from 'react'
import { ImageOff } from 'lucide-react'

// Image with automatic fallback to a muted placeholder on load error.
// Replaces scattered `<img onError={...}>` patterns across pages.
export default function CardImage({ src, alt = '', className = '', aspect = '3/4' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        className={`${className} bg-gray-800/60 border border-gray-800 flex items-center justify-center text-gray-700`}
        style={{ aspectRatio: aspect }}
      >
        <ImageOff size={18} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}
