import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Gavel, Tag, Users, Briefcase, Heart, TrendingUp,
  Bell, BarChart3, Wifi, WifiOff, AlertCircle, ChevronLeft, Menu, X, Zap, Shield,
  Database, BellRing, HelpCircle
} from 'lucide-react'
import { pushSupported, isSubscribed, subscribePush, unsubscribePush } from '../lib/push'
import Tutorial from './Tutorial'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/graded', label: 'Graded Tracker', icon: Shield },
  { to: '/auctions', label: 'Live Auctions', icon: Gavel },
  { to: '/bin', label: 'Buy It Now', icon: Tag },
  { to: '/sales', label: 'Sales Database', icon: Database },
  { to: '/drivers', label: 'Drivers', icon: Users },
  { to: '/graded-cards', label: 'Card Catalog', icon: Shield },
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [snipeCount, setSnipeCount] = useState(0)
  const [pushState, setPushState] = useState('idle') // idle | subscribed | busy | unsupported
  const [showTutorial, setShowTutorial] = useState(false)
  const location = useLocation()

  // Push subscription state
  useEffect(() => {
    if (!pushSupported()) { setPushState('unsupported'); return }
    isSubscribed().then(on => setPushState(on ? 'subscribed' : 'idle')).catch(() => setPushState('idle'))
  }, [])

  // First-visit tutorial
  useEffect(() => {
    try {
      if (!localStorage.getItem('cc_tutorial_seen')) setShowTutorial(true)
    } catch {}
  }, [])

  const togglePush = async () => {
    setPushState('busy')
    try {
      if (await isSubscribed()) {
        await unsubscribePush()
        setPushState('idle')
      } else {
        await subscribePush()
        setPushState('subscribed')
      }
    } catch (e) {
      alert('Push notification error: ' + (e?.message || 'unknown'))
      setPushState('idle')
    }
  }

  const dismissTutorial = () => {
    try { localStorage.setItem('cc_tutorial_seen', '1') } catch {}
    setShowTutorial(false)
  }

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Lock body scroll when drawer open
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  useEffect(() => {
    let ws
    let retryTimer
    let bannerTimer
    let closed = false
    const seenAlerts = new Set()

    function connect() {
      if (closed) return
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

  // Shared sidebar contents (used by both desktop aside and mobile drawer)
  const SidebarContent = ({ mobile = false }) => (
    <>
      {/* Logo */}
      <div className={`flex items-center ${collapsed && !mobile ? 'justify-center' : 'justify-between'} px-3 py-4 border-b border-gray-800/60`}>
        {(!collapsed || mobile) && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
              <span className="text-white text-xs font-black tracking-tight">F1</span>
            </div>
            <div>
              <div className="font-black text-white text-sm leading-none tracking-tight">F1 Card Hub</div>
              <div className="text-[10px] text-gray-500 mt-0.5 font-medium">Topps Chrome F1 Tracker</div>
            </div>
          </div>
        )}
        {collapsed && !mobile && (
          <div className="w-8 h-8 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
            <span className="text-white text-xs font-black">F1</span>
          </div>
        )}
        {mobile ? (
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`${collapsed ? 'hidden' : 'flex'} p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors`}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* eBay status */}
      {(!collapsed || mobile) && (
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
            onClick={() => mobile && setMobileOpen(false)}
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
                {(!collapsed || mobile) && <span className="flex-1 truncate">{label}</span>}
                {(!collapsed || mobile) && label === 'Live Auctions' && snipeCount > 0 && (
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
        {/* Push notifications button */}
        {pushState !== 'unsupported' && (!collapsed || mobile) && (
          <button
            onClick={togglePush}
            disabled={pushState === 'busy'}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              pushState === 'subscribed'
                ? 'bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50'
                : 'bg-gray-800/60 text-gray-400 hover:text-white border border-gray-700/40 hover:bg-gray-800'
            }`}
          >
            <BellRing size={12} />
            {pushState === 'subscribed' ? 'Push enabled' : pushState === 'busy' ? '…' : 'Enable push alerts'}
          </button>
        )}
        {(!collapsed || mobile) && (
          <div className="flex items-center gap-2 px-1">
            <div className={`w-1.5 h-1.5 rounded-full ${wsColor} ${wsStatus !== 'disconnected' ? 'animate-pulse' : ''}`} />
            <span className="text-[10px] text-gray-600 capitalize font-medium">{wsStatus}</span>
          </div>
        )}
        {collapsed && !mobile && (
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex justify-center p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Menu size={14} />
          </button>
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex ${collapsed ? 'w-14' : 'w-[220px]'} flex-col bg-gray-900/95 border-r border-gray-800/60 transition-all duration-200 shrink-0 backdrop-blur-sm`}>
        <SidebarContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-[260px] max-w-[80vw] bg-gray-900 border-r border-gray-800/60 z-50 flex flex-col transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <SidebarContent mobile />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar — adds safe-area inset so the hamburger sits below the iOS status bar / Android notch */}
        <div
          className="md:hidden flex items-center justify-between px-3 py-2.5 border-b border-gray-800/60 bg-gray-900 shrink-0"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)' }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-300 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-red-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-[10px] font-black">F1</span>
            </div>
            <span className="font-black text-white text-sm tracking-tight">F1 Card Hub</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800/60">
            <div className={`w-1.5 h-1.5 rounded-full ${wsColor} ${wsStatus !== 'disconnected' ? 'animate-pulse' : ''}`} />
            {snipeCount > 0 && (
              <span className="text-[10px] font-black text-red-400">{snipeCount}</span>
            )}
          </div>
        </div>

        {/* Snipe alert banner */}
        {liveAlerts.length > 0 && wsStatus === 'connected' && (
          <div className="bg-red-600 px-3 md:px-4 py-2.5 flex items-center gap-2 md:gap-3 border-b border-red-500/50 z-30 shadow-lg">
            <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <AlertCircle size={12} className="text-white" />
            </div>
            <span className="text-xs md:text-sm font-semibold text-white truncate flex-1">{liveAlerts[0].message}</span>
            <span className="text-[10px] md:text-xs bg-red-500/80 px-2 py-0.5 rounded-lg uppercase font-black tracking-wide text-white shrink-0">
              {liveAlerts[0].urgency}
            </span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-3 md:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {showTutorial && <Tutorial onClose={dismissTutorial} />}

      {!showTutorial && (
        <button
          onClick={() => setShowTutorial(true)}
          className="fixed top-3 right-3 md:top-4 md:right-4 z-40 w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700/50 flex items-center justify-center backdrop-blur-sm shadow-lg"
          aria-label="Help"
          title="Show tutorial"
        >
          <HelpCircle size={16} />
        </button>
      )}
    </div>
  )
}
