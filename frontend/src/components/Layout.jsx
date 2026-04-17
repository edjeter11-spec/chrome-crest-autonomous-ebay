import { Outlet, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Gavel, Tag, Users, Briefcase, Heart, TrendingUp,
  Bell, BarChart3, Wifi, WifiOff, AlertCircle, ChevronLeft, Menu, Zap, Shield,
  Database
} from 'lucide-react'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/auctions', label: 'Live Auctions', icon: Gavel },
  { to: '/bin', label: 'Buy It Now', icon: Tag },
  { to: '/graded', label: 'Graded Cards', icon: Shield },
  { to: '/sales', label: 'Sales Database', icon: Database },
  { to: '/drivers', label: 'Drivers', icon: Users },
  { to: '/psa', label: 'PSA Population', icon: Shield },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/price-history', label: 'Price History', icon: TrendingUp },
  { to: '/alerts', label: 'Alerts', icon: Bell },
]

export default function Layout() {
  const [wsStatus, setWsStatus] = useState('connecting')
  const [ebayConnected, setEbayConnected] = useState(false)
  const [liveAlerts, setLiveAlerts] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const [snipeCount, setSnipeCount] = useState(0)

  useEffect(() => {
    let ws
    let retryTimer
    let bannerTimer
    let closed = false
    // Track which alert messages we've already shown, so repeat pushes from the
    // backend don't re-trigger the banner and cause "flashing".
    const seenAlerts = new Set()

    function connect() {
      if (closed) return
      // If VITE_API_URL is set (prod), derive WS host from it. Otherwise fall back
      // to same-host dev default on port 8000.
      const apiUrl = import.meta.env.VITE_API_URL || ''
      let wsUrl
      if (apiUrl) {
        wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const host = window.location.hostname
        const port = import.meta.env.VITE_API_PORT || '8000'
        wsUrl = `${proto}://${host}:${port}/ws`
      }

      try { ws = new WebSocket(wsUrl) } catch { setWsStatus('error'); return }

      ws.onopen = () => setWsStatus('connected')
      ws.onclose = () => {
        setWsStatus('disconnected')
        // Back off to 10s so we don't hammer unreachable backends on Vercel.
        if (!closed) retryTimer = setTimeout(connect, 10000)
      }
      ws.onerror = () => setWsStatus('error')
      ws.onmessage = (e) => {
        let msg
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg.type === 'auction_update') {
          setEbayConnected(msg.ebay_connected || false)
          const snipes = msg.data?.filter(a => a.snipe_eligible) || []
          setSnipeCount(snipes.length)

          // Only surface alerts we haven't shown yet in this session.
          const fresh = (msg.alerts || []).filter(a => a && a.message && !seenAlerts.has(a.message))
          if (fresh.length) {
            fresh.forEach(a => seenAlerts.add(a.message))
            setLiveAlerts(fresh.slice(0, 3))
            clearTimeout(bannerTimer)
            bannerTimer = setTimeout(() => setLiveAlerts([]), 12000)
          }
        }
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      clearTimeout(bannerTimer)
      ws?.close()
    }
  }, [])

  const wsColor = wsStatus === 'connected' ? 'bg-green-400' : wsStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-500'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-14' : 'w-[220px]'} flex flex-col bg-gray-900/95 border-r border-gray-800/60 transition-all duration-200 shrink-0 backdrop-blur-sm`}>

        {/* Logo */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 py-4 border-b border-gray-800/60`}>
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
                <span className="text-white text-xs font-black tracking-tight">F1</span>
              </div>
              <div>
                <div className="font-black text-white text-sm leading-none tracking-tight">Chrome Crest</div>
                <div className="text-[10px] text-gray-500 mt-0.5 font-medium">eBay Sniping Platform</div>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
              <span className="text-white text-xs font-black">F1</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`${collapsed ? 'hidden' : 'flex'} p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors`}
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* eBay status */}
        {!collapsed && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-gray-800/60 border border-gray-700/40 flex items-center gap-2">
            {ebayConnected
              ? <Wifi size={11} className="text-green-400 shrink-0" />
              : <WifiOff size={11} className="text-gray-500 shrink-0" />}
            <span className={`text-xs font-medium ${ebayConnected ? 'text-green-400' : 'text-gray-500'}`}>
              {ebayConnected ? 'Live eBay Data' : 'Simulated Data'}
            </span>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative ${
                  isActive
                    ? 'bg-red-600/15 text-red-400 border border-red-600/20'
                    : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} className="shrink-0" />
                  {!collapsed && <span className="flex-1 truncate">{label}</span>}
                  {!collapsed && label === 'Live Auctions' && snipeCount > 0 && (
                    <span className="bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5 font-black flex items-center gap-0.5">
                      <Zap size={8} fill="white" />{snipeCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* WS + collapse toggle at bottom */}
        <div className="px-3 py-3 border-t border-gray-800/60 space-y-2">
          {!collapsed && (
            <div className="flex items-center gap-2 px-1">
              <div className={`w-1.5 h-1.5 rounded-full ${wsColor} ${wsStatus !== 'disconnected' ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] text-gray-600 capitalize font-medium">{wsStatus}</span>
            </div>
          )}
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="w-full flex justify-center p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
            >
              <Menu size={14} />
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Snipe alert banner — only show when WS is connected to prevent stale flashing */}
        {liveAlerts.length > 0 && wsStatus === 'connected' && (
          <div className="bg-red-600/95 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3 border-b border-red-500/50 z-50 shadow-lg">
            <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <AlertCircle size={12} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white truncate flex-1">{liveAlerts[0].message}</span>
            <span className="text-xs bg-red-500/80 px-2.5 py-0.5 rounded-lg uppercase font-black tracking-wide text-white">
              {liveAlerts[0].urgency}
            </span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
