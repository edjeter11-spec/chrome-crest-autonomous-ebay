/**
 * Brand logo, inline SVG — replaces the old fuzzy /logo.png raster.
 * Vector = crisp at every size, themeable, zero image request.
 *
 *   <LogoMark size={36} />   bare shield (collapsed sidebar, favicons, tight spots)
 *   <Logo />                 full lockup: shield + "F1 CARD VAULT" + caption
 *   <Logo compact />         one-line lockup for the mobile topbar
 */

const SHIELD_PATH = 'M24 3 L42 8.5 V25.5 C42 35.5 34.5 42.3 24 45.5 C13.5 42.3 6 35.5 6 25.5 V8.5 Z'

export function LogoMark({ size = 40, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="f1cv-shield-grad" x1="6" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f87171" />
          <stop offset="1" stopColor="#991b1b" />
        </linearGradient>
      </defs>
      <path d={SHIELD_PATH} fill="#0d1220" stroke="url(#f1cv-shield-grad)" strokeWidth="2.6" />
      <text
        x="24" y="26.5" textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontWeight="900" fontStyle="italic" fontSize="16.5" fill="#ffffff"
      >
        F1
      </text>
      {/* checkered-flag strip */}
      <g fill="#ef4444">
        <rect x="14" y="31" width="4" height="4" rx="0.5" />
        <rect x="22" y="31" width="4" height="4" rx="0.5" />
        <rect x="30" y="31" width="4" height="4" rx="0.5" />
      </g>
      <g fill="#4b5563">
        <rect x="18" y="31" width="4" height="4" rx="0.5" />
        <rect x="26" y="31" width="4" height="4" rx="0.5" />
      </g>
    </svg>
  )
}

function Wordmark({ textSize = 'text-lg' }) {
  return (
    <span className={`font-black ${textSize} tracking-tight leading-none whitespace-nowrap`}>
      <span className="italic text-red-500">F1</span>{' '}
      <span className="text-white light:text-gray-900">CARD VAULT</span>
    </span>
  )
}

export default function Logo({ size = 44, compact = false, caption = true, className = '' }) {
  if (compact) {
    return (
      <span className={`flex items-center gap-2 ${className}`}>
        <LogoMark size={size} />
        <Wordmark textSize="text-sm" />
      </span>
    )
  }
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="flex flex-col gap-1">
        <Wordmark />
        {caption && (
          <span className="text-[9px] text-gray-500 font-semibold tracking-[0.14em] uppercase light:text-gray-600 leading-none">
            Topps Chrome F1 Tracker
          </span>
        )}
      </span>
    </span>
  )
}
