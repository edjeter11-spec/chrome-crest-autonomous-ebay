// Loading skeletons for the dark-theme F1 Card Vault dashboard.
// Color palette mirrors AuctionCard / KpiTile: bg-gray-900 surface,
// bg-gray-800 shimmer blocks, gray-800/80 borders. Use these instead of
// blank divs so cold-start (2-5s) doesn't look broken.

export function SkeletonBox({ className = '' }) {
  return <div className={`bg-gray-800 animate-pulse rounded ${className}`} />
}

// Shaped to match AuctionCard: ~h-44 image area + body with title, chips,
// price, bid count. Same wrapper (bg-gray-900, rounded-2xl, border-gray-800)
// so cards swap in cleanly when data arrives.
export function SkeletonCard() {
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800/80 overflow-hidden flex flex-col">
      {/* Image area */}
      <div className="relative h-44 bg-gray-800 animate-pulse shrink-0" />

      {/* Body */}
      <div className="p-3 flex flex-col gap-2">
        {/* Driver chip line */}
        <div className="flex items-center gap-1.5">
          <SkeletonBox className="w-2 h-2 rounded-full" />
          <SkeletonBox className="h-3 w-24" />
        </div>

        {/* Title — 2 lines */}
        <div className="space-y-1.5 min-h-[2.5rem]">
          <SkeletonBox className="h-3 w-full" />
          <SkeletonBox className="h-3 w-3/4" />
        </div>

        {/* End time + bid count row */}
        <div className="flex items-center justify-between">
          <SkeletonBox className="h-2.5 w-20" />
          <SkeletonBox className="h-4 w-14 rounded-lg" />
        </div>

        {/* Price line */}
        <div className="flex items-baseline gap-2 mt-1">
          <SkeletonBox className="h-6 w-20" />
          <SkeletonBox className="h-3 w-12" />
        </div>

        {/* CTA button placeholder */}
        <SkeletonBox className="h-8 w-full rounded-lg mt-1" />
      </div>
    </div>
  )
}

// Horizontal strip (used by Ending Soonest etc.). Matches the wrapper used in
// Dashboard: w-64 fixed-width snap items.
export function SkeletonCardRow({ count = 6 }) {
  return (
    <div className="flex gap-3 overflow-hidden pb-2 -mx-1 px-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-64 shrink-0">
          <SkeletonCard />
        </div>
      ))}
    </div>
  )
}

// Matches KpiTile dimensions: rounded-xl/2xl border tile with icon row, value
// line, sub line. Lives inside the same grid the real KpiTiles use.
export function SkeletonStat() {
  return (
    <div className="rounded-xl md:rounded-2xl border border-gray-700/50 bg-gray-800/40 p-2 md:p-4">
      <div className="flex items-center gap-1 md:gap-2 mb-1 md:mb-2">
        <SkeletonBox className="w-3 h-3 rounded" />
        <SkeletonBox className="h-2.5 w-14" />
      </div>
      <SkeletonBox className="h-5 md:h-6 w-16" />
      <SkeletonBox className="hidden md:block h-2.5 w-20 mt-1.5" />
    </div>
  )
}
