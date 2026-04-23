/**
 * LoadingSpinner
 * Unified loading indicator matching the app's existing red-spinner pattern.
 *
 * Usage:
 *   <LoadingSpinner />                          // generic spinner
 *   <LoadingSpinner message="Loading auctions…" />  // with text
 *
 * Props:
 *   message?: string  — optional text rendered below the spinner
 *   size?: 'sm' | 'md' | 'lg'  — defaults to 'md'
 *   className?: string  — additional classes for the wrapper
 */
export default function LoadingSpinner({ message, size = 'md', className = '' }) {
  const sizeClass =
    size === 'sm' ? 'w-5 h-5 border-2' :
    size === 'lg' ? 'w-10 h-10 border-[3px]' :
    'w-7 h-7 border-2'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-8 ${className}`}
    >
      <div
        className={`${sizeClass} border-red-600 border-t-transparent rounded-full animate-spin`}
        aria-hidden="true"
      />
      {message && (
        <p className="text-xs text-gray-400 font-medium">{message}</p>
      )}
      <span className="sr-only">{message || 'Loading'}</span>
    </div>
  )
}
