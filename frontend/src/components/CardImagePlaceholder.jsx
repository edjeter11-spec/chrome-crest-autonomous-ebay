// F1-themed fallback shown when a card image is missing or fails to load.
// Pure SVG — no extra network requests, scales to any container, and reads
// the driver's last name (or any short label) so the user still gets context.

const DEFAULT_TEAM_COLOR = '#1f2937' // gray-800

function lastName(name) {
  if (!name || typeof name !== 'string') return 'F1'
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1].toUpperCase()
}

export default function CardImagePlaceholder({
  driverName,
  teamColor,
  className = '',
  // Tailwind size hint for the centered label; callers can override.
  labelClassName = 'text-xs font-black tracking-widest',
}) {
  const accent = teamColor || DEFAULT_TEAM_COLOR
  const label = lastName(driverName)

  return (
    <div
      className={`relative w-full h-full overflow-hidden flex items-center justify-center ${className}`}
      style={{
        background: `linear-gradient(145deg, #0b0b0f 0%, ${accent}33 60%, #0b0b0f 100%)`,
      }}
      aria-label={driverName ? `${driverName} card image unavailable` : 'Card image unavailable'}
    >
      {/* Card silhouette + checkered-flag motif (single inline SVG, no requests) */}
      <svg
        viewBox="0 0 120 168"
        className="absolute inset-0 w-full h-full opacity-25"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id="ccp-checker" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#ffffff" fillOpacity="0.18" />
            <rect x="6" y="6" width="6" height="6" fill="#ffffff" fillOpacity="0.18" />
          </pattern>
          <linearGradient id="ccp-edge" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.7" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {/* Card silhouette */}
        <rect x="10" y="10" width="100" height="148" rx="8" ry="8"
          fill="none" stroke="url(#ccp-edge)" strokeWidth="1.5" />
        {/* Checker strip across the bottom */}
        <rect x="10" y="138" width="100" height="20" fill="url(#ccp-checker)" />
      </svg>

      {/* Accent corner bar — borrows team color */}
      <div
        className="absolute top-0 left-0 h-1 w-full opacity-80"
        style={{ backgroundColor: accent }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center px-2 text-center">
        <div className="text-2xl mb-1 opacity-40 select-none" aria-hidden="true">
          {/* F1 car glyph */}
          🏎
        </div>
        <div className={`text-gray-300/80 uppercase ${labelClassName}`}>
          {label}
        </div>
        <div className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-wider">
          No image
        </div>
      </div>
    </div>
  )
}
