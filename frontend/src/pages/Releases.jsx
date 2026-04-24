import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, Bell } from 'lucide-react'

const RELEASES = [
  {
    name: '2025 Topps Chrome Formula 1',
    date: 'Jan 2025',
    status: 'released',
    url: 'https://www.topps.com/pages/formula-1',
    description: 'Flagship chrome set. Base refractors, Neon Nations, Helix, Debut Showcase, Penned In autos. The benchmark 2025 F1 release.',
    priceRange: 'Hobby box ~$130 · Mega ~$40 · Blaster ~$30',
  },
  {
    name: '2025 Topps Chrome F1 Sapphire Edition',
    date: 'Q4 2025',
    status: 'upcoming',
    url: 'https://www.topps.com/pages/formula-1',
    description: 'Online-exclusive sapphire-finish parallels. Limited-window drop, notoriously thin print runs on color parallels.',
    priceRange: 'Hobby box ~$280-$340 · colors /75, /50, /25, /10, 1/1',
  },
  {
    name: '2025 Topps Chrome F1 Black',
    date: 'TBA',
    status: 'upcoming',
    url: 'https://www.topps.com/pages/formula-1',
    description: 'Premium all-auto configuration. Every pack = hit. Black-bordered parallels, on-card autos.',
    priceRange: 'Hobby box ~$400-$600 (projected)',
  },
  {
    name: '2025 Topps Chrome F1 Dynasty',
    date: 'TBA',
    status: 'upcoming',
    url: 'https://www.topps.com/pages/formula-1',
    description: 'Ultra-premium hit-per-pack product. Patch autos, 1/1 printing plates, pristine on-card signatures.',
    priceRange: 'Case-hit territory · $800-$1,500+ per box (projected)',
  },
  {
    name: '2026 Topps Chrome F1',
    date: 'TBA',
    status: 'upcoming',
    url: 'https://www.topps.com/pages/formula-1',
    description: 'Next flagship cycle. Expect fresh rookies, new parallels, and a reset on the base chrome checklist.',
    priceRange: 'TBD',
  },
]

function StatusBadge({ status }) {
  if (status === 'released') {
    return (
      <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider bg-green-700 text-white">
        Released
      </span>
    )
  }
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider bg-yellow-700 text-white">
      Upcoming
    </span>
  )
}

export default function Releases() {
  useEffect(() => {
    document.title = '2025-2026 Topps Chrome F1 Release Calendar — F1 Card Vault'
  }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-5 p-2">
      <Link to="/" className="text-xs text-gray-400 hover:text-white flex items-center gap-1 w-fit">
        <ArrowLeft size={12} /> Home
      </Link>

      <div className="panel p-6 space-y-5">
        <header>
          <h1 className="text-3xl font-black text-white flex items-center gap-2">
            <Calendar size={22} className="text-red-500" />
            Release Calendar
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            2025-2026 Topps Chrome Formula 1 releases — dates, products, expected price ranges.
          </p>
        </header>

        <Link
          to="/alerts"
          className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Bell size={14} /> Get release-day alert
        </Link>

        <div className="space-y-3">
          {RELEASES.map(r => (
            <article
              key={r.name}
              className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-2 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-base font-black text-white leading-tight">{r.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-gray-500 font-mono">{r.date}</span>
                  </div>
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-semibold"
                >
                  topps.com <ExternalLink size={10} />
                </a>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{r.description}</p>
              <p className="text-xs text-gray-500 font-mono">{r.priceRange}</p>
            </article>
          ))}
        </div>

        <p className="text-[11px] text-gray-600 leading-relaxed pt-2 border-t border-gray-800">
          Dates and configurations are based on public Topps announcements and historical release patterns.
          "TBA" dates will update as Topps confirms. Price ranges are projections based on prior-year comps.
        </p>
      </div>
    </div>
  )
}
