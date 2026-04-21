import { Outlet, NavLink, useLocation, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Gavel, Tag, Users, Briefcase, Heart, TrendingUp,
  Bell, BarChart3, Wifi, WifiOff, AlertCircle, ChevronLeft, Menu, X, Zap, Shield,
  Database, BellRing, HelpCircle, ListChecks, Package, Sparkles, User, ShieldAlert, Scale, Sunrise, Camera,
  ArrowLeftRight, Calculator, Sun, Moon, Target
} from 'lucide-react'
import { pushSupported, isSubscribed, subscribePush, unsubscribePush } from '../lib/push'
import Tutorial from './Tutorial'
import { useAuth } from '../lib/auth'
import { LogIn, LogOut } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/today', label: 'Today', icon: Sunrise },
  { to: '/auctions', label: 'Live Auctions', icon: Gavel },
  { to: '/bin', label: 'Buy It Now', icon: Tag },
  { to: '/sales', label: 'Sales', icon: Database },
  { to: '/drivers', label: 'Drivers', icon: Users },
  { to: '/graded', label: 'Graded', icon: Shield },
  { to: '/my-cards', label: 'My Cards', icon: Camera },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/wishlist', label: 'Watchlist', icon: Heart },
  { to: '/grade', label: 'AI Grader', icon: Sparkles },
  { to: '/arbitrage', label: 'Arbitrage', icon: ArrowLeftRight },
  { to: '/grade-profit', label: 'Grade Profit', icon: Calculator },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/sniper', label: 'Sniper', icon: Target },
]

// Mobile bottom tab bar — 5 most-used
const MOBILE_TABS = [
  { to: '/', label: 'Home', icon: LayoutDashboard, exact: true },
  { to: '/auctions', label: 'Deals', icon: Gavel },
  { to: '/sales', label: 'Sales', icon: Database },
  { to: '/portfolio', label: 'Mine', icon: Briefcase },
  { to: '/grade', label: 'AI', icon: Sparkles },
]

export default function Layout() {
  const [wsStatus, setWsStatus] = useState('connecting')
  const [ebayConnected, setEbayConnected] = useState(false)
  const [liveAlerts, setLiveAlerts] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [snipeCount, setSnipeCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [pushState, setPushState] = useState('idle') // idle | subscribed | busy | unsupported
  const [showTutorial, setShowTutorial] = useState(false)
  const [logoOk, setLogoOk] = useState(true)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cc_theme') || 'dark' } catch { return 'dark' }
  })
  useEffect(() => {
    try { localStorage.setItem('cc_theme', theme) } catch {}
    if (theme === 'light') document.body.classList.add('light')
    else document.body.classList.remove('light')
  }, [theme])
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const location = useLocation()
  const { user, signOut } = useAuth()

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

  // Today unread count — polls every 2 minutes
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || ''
    const fetchCount = () => {
      let since
      try {
        since = localStorage.getItem('cc_last_today_visit') || new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      } catch {
        since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      }
      fetch(`${apiUrl}/api/today/count?since=${encodeURIComponent(since)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.total != null) setTodayCount(d.total) })
        .catch(() => {})
    }
    fetchCount()
    const onRead = () => setTodayCount(0)
    window.addEventListener('cc-today-read', onRead)
    const id = setInterval(fetchCount, 120_000)
    return () => { clearInterval(id); window.removeEventListener('cc-today-read', onRead) }
  }, [])

  const togglePush = async () => {
    setPushState('busy')
    // Safety reset: if state is still 'busy' after 10s (permission prompt hung / denied silently),
    // force back to idle so the button becomes usable again.
    const safety = setTimeout(() => {
      setPushState(s => s === 'busy' ? 'idle' : s)
    }, 10000)
    try {
      // Check current browser permission up-front — if already denied, don't even try to subscribe
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        alert('Notifications are blocked in your browser settings. Enable them to receive push alerts.')
        setPushState('idle')
        return
      }
      if (await isSubscribed()) {
        await unsubscribePush()
        setPushState('idle')
      } else {
        await subscribePush()
        // If permission ended up denied after prompt, surface as idle
        if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          setPushState('idle')
        } else {
          setPushState('subscribed')
        }
      }
    } catch (e) {
      alert('Push notification error: ' + (e?.message || 'unknown'))
      setPushState('idle')
    } finally {
      clearTimeout(safety)
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
        wsUrl = `${proto}://${window.location.host}/ws`
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
            {logoOk ? (
              <img src="/logo.jpg" alt="F1 Card Hub" className="w-8 h-8 rounded-xl object-cover shadow-lg shadow-red-900/40" onError={() => setLogoOk(false)} />
            ) : (
              <div className="w-8 h-8 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
                <span className="text-white text-xs font-black">F1</span>
              </div>
            )}
            <div>
              <div className="font-black text-white text-sm leading-none tracking-tight">F1 Card Hub</div>
              <div className="text-[10px] text-gray-500 mt-0.5 font-medium">Topps Chrome F1 Tracker</div>
            </div>
          </div>
        )}
        {collapsed && !mobile && (
          logoOk ? (
            <img src="/logo.jpg" alt="F1 Card Hub" className="w-8 h-8 rounded-xl object-cover shadow-lg shadow-red-900/40" onError={() => setLogoOk(false)} />
          ) : (
            <div className="w-8 h-8 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40">
              <span className="text-white text-xs font-black">F1</span>
            </div>
          )
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

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.filter(({ to }) => user || !['/my-cards', '/portfolio', '/wishlist', '/sniper'].includes(to)).map(({ to, label, icon: Icon, exact }) => (
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
                {(!collapsed || mobile) && label === 'Today' && todayCount > 0 && (
                  <span className="bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5 font-black flex items-center gap-0.5">
                    🔔 {todayCount > 99 ? '99+' : todayCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Auth + push at bottom */}
      <div className="px-3 py-3 border-t border-gray-800/60 space-y-2">
        {(!collapsed || mobile) && (
          user ? (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/60">
              <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                {(user.email || '?')[0].toUpperCase()}
              </div>
              <span className="text-[11px] text-gray-300 truncate flex-1">{user.email}</span>
              <button onClick={signOut} title="Sign out" className="text-gray-500 hover:text-red-400">
                <LogOut size={12} />
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-red-600/10 border border-red-600/30 text-red-400 hover:bg-red-600/20 text-[11px] font-semibold">
              <LogIn size={12} /> Sign in / Create account
            </NavLink>
          )
        )}
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
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-800/60 text-gray-400 hover:text-white border border-gray-700/40 hover:bg-gray-800 transition-colors"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
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
            {logoOk ? (
              <img src="/logo.jpg" alt="F1 Card Hub" className="w-6 h-6 rounded-lg object-cover" onError={() => setLogoOk(false)} />
            ) : (
              <div className="w-6 h-6 bg-red-600 rounded-lg flex items-center justify-center">
                <span className="text-white text-[9px] font-black">F1</span>
              </div>
            )}
            <span className="font-black text-white text-sm tracking-tight">F1 Card Hub</span>
          </div>
          {snipeCount > 0 ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600/20">
              <Zap size={10} className="text-red-400" fill="currentColor" />
              <span className="text-[10px] font-black text-red-400">{snipeCount}</span>
            </div>
          ) : <div className="w-8" />}
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

        <main className="flex-1 overflow-y-auto p-3 md:p-6 overflow-x-hidden pb-20 md:pb-6">
          <Outlet />
          {/* FTC-required affiliate disclosure */}
          <div className="max-w-6xl mx-auto mt-10 pt-6 border-t border-gray-800/60">
            <p className="text-[10px] text-gray-600 leading-relaxed">
              <strong className="text-gray-500">Disclosure:</strong> As an eBay Partner, F1 Card Hub may be compensated
              when you make a qualifying purchase after clicking a link on this site. This does not affect the price
              you pay. Median prices and verdicts are computed from public sale data and are not investment advice.
            </p>
            <p className="text-[10px] text-gray-500 mt-2">
              <Link to="/about" className="text-gray-500 hover:underline">About</Link>
              {' · '}
              <a href="mailto:edjeter11@gmail.com" className="text-gray-500 hover:underline">Contact</a>
            </p>
          </div>
        </main>

        {/* Mobile bottom tab bar */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800/80 flex items-center justify-around px-1"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {MOBILE_TABS.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 min-h-[56px] justify-center transition-colors ${
                  isActive ? 'text-red-400' : 'text-gray-500 hover:text-gray-300'
                }`
              }
            >
              <Icon size={20} />
              <span className="text-[10px] font-semibold">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {showTutorial && <Tutorial onClose={dismissTutorial} />}

      {!showTutorial && <TopRightMenu user={user} signOut={signOut} onHelp={() => setShowTutorial(true)} />}
    </div>
  )
}

function TopRightMenu({ user, signOut, onHelp }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  if (user) {
    return (
      <div className="fixed top-3 right-3 md:top-4 md:right-4 z-40">
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
          className="w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700/50 flex items-center justify-center backdrop-blur-sm shadow-lg"
          aria-label="Account menu"
          aria-haspopup="true"
          aria-expanded={open}
          title={user.email || 'Account'}
        >
          <User size={16} />
        </button>
        {open && (
          <div
            className="absolute right-0 mt-1 w-44 rounded-xl bg-gray-900 border border-gray-700/60 shadow-xl py-1 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 text-[11px] text-gray-500 border-b border-gray-800 truncate">{user.email || 'Signed in'}</div>
            <Link to="/my-cards" onClick={() => setOpen(false)} className="block px-3 py-2 text-gray-300 hover:bg-gray-800">My Cards</Link>
            <Link to="/portfolio" onClick={() => setOpen(false)} className="block px-3 py-2 text-gray-300 hover:bg-gray-800">Portfolio</Link>
            <button
              onClick={() => { setOpen(false); onHelp() }}
              className="w-full text-left px-3 py-2 text-gray-300 hover:bg-gray-800"
            >Tutorial</button>
            <button
              onClick={() => { setOpen(false); signOut?.() }}
              className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-900/30 border-t border-gray-800"
            >Sign out</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed top-3 right-3 md:top-4 md:right-4 z-40 flex items-center gap-2">
      <Link
        to="/login"
        className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-600/20 text-red-300 border border-red-600/40 hover:bg-red-600/30"
      >Sign in</Link>
      <button
        onClick={onHelp}
        className="w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700/50 flex items-center justify-center backdrop-blur-sm shadow-lg"
        aria-label="Help"
        title="Show tutorial"
      >
        <HelpCircle size={16} />
      </button>
    </div>
  )
}
