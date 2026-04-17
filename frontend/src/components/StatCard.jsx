export default function StatCard({ label, value, sub, color = 'blue', icon: Icon }) {
  const schemes = {
    blue:   { icon: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
    green:  { icon: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
    red:    { icon: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
    yellow: { icon: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
    purple: { icon: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  }
  const s = schemes[color] || schemes.blue

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800/80 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${s.bg} border ${s.border}`}>
            <Icon size={14} className={s.icon} />
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-black text-white tracking-tight leading-none">
          {value ?? <span className="skeleton inline-block w-16 h-7 rounded" />}
        </div>
        {sub && <div className="text-xs text-gray-500 mt-1 font-medium">{sub}</div>}
      </div>
    </div>
  )
}
