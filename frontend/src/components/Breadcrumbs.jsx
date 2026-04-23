import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

/**
 * Breadcrumbs
 * props:
 *   items: [{ label: 'Home', to: '/' }, { label: 'Drivers', to: '/drivers' }, { label: 'Verstappen' }]
 *   Last item is rendered as plain text (current page).
 *   On mobile, middle items collapse to "..." with tap-to-expand.
 */
export default function Breadcrumbs({ items = [] }) {
  const [expanded, setExpanded] = useState(false)

  if (!items || items.length === 0) return null

  const last = items[items.length - 1]
  const middle = items.slice(0, -1)
  const shouldCollapseMobile = items.length > 2

  const Separator = () => (
    <ChevronRight size={12} className="text-gray-600 shrink-0" aria-hidden="true" />
  )

  const renderCrumb = (item, isLast) => {
    if (isLast || !item.to) {
      return (
        <span
          key={item.label}
          className="text-gray-200 font-semibold truncate max-w-[50vw]"
          aria-current={isLast ? 'page' : undefined}
        >
          {item.label}
        </span>
      )
    }
    return (
      <Link
        key={item.label}
        to={item.to}
        className="text-gray-400 hover:text-white transition-colors"
      >
        {item.label}
      </Link>
    )
  }

  return (
    <nav aria-label="Breadcrumb" className="text-xs mb-3">
      {/* Desktop / tablet: full breadcrumb trail */}
      <ol className="hidden sm:flex items-center gap-1.5 flex-wrap">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {renderCrumb(item, isLast)}
              {!isLast && <Separator />}
            </li>
          )
        })}
      </ol>

      {/* Mobile: collapse middle crumbs behind "..." */}
      <ol className="flex sm:hidden items-center gap-1.5 flex-wrap">
        {shouldCollapseMobile && !expanded ? (
          <>
            <li className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-gray-400 hover:text-white transition-colors font-semibold px-1"
                aria-label="Show full breadcrumb trail"
              >
                ...
              </button>
              <Separator />
            </li>
            <li>{renderCrumb(last, true)}</li>
          </>
        ) : (
          items.map((item, i) => {
            const isLast = i === items.length - 1
            return (
              <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
                {renderCrumb(item, isLast)}
                {!isLast && <Separator />}
              </li>
            )
          })
        )}
        {shouldCollapseMobile && expanded && middle.length > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[10px] text-gray-500 hover:text-gray-300 ml-1"
              aria-label="Collapse breadcrumb trail"
            >
              collapse
            </button>
          </li>
        )}
      </ol>
    </nav>
  )
}
