import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase, supabaseReady } from '../lib/supabase'
import { Mail, Lock, LogIn } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()
  const next = new URLSearchParams(loc.search).get('next') || '/portfolio'

  const submit = async (e) => {
    e.preventDefault()
    if (!supabaseReady) { setMsg('Auth not configured'); return }
    setLoading(true); setMsg('')
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        nav(next)
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + next },
        })
        if (error) throw error
        // If the Supabase project has email confirmation OFF, a session is returned immediately.
        if (data?.session) { nav(next); return }
        // Otherwise try a direct sign-in (works when confirm-email is disabled server-side).
        const { error: signErr } = await supabase.auth.signInWithPassword({ email, password })
        if (!signErr) { nav(next); return }
        setMsg('Check your email to confirm your account.')
      }
    } catch (err) {
      setMsg(err.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  const googleSignIn = async () => {
    if (!supabaseReady) { setMsg('Auth not configured'); return }
    setLoading(true); setMsg('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + next },
      })
      if (error) throw error
    } catch (err) {
      setMsg(err.message || 'Error')
      setLoading(false)
    }
  }

  const magicLink = async () => {
    if (!email) { setMsg('Enter your email first'); return }
    if (!supabaseReady) { setMsg('Auth not configured'); return }
    setLoading(true); setMsg('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + next } })
      if (error) throw error
      setMsg('Magic link sent — check your email.')
    } catch (err) {
      setMsg(err.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto mt-8 md:mt-16 px-4">
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg">
            <LogIn size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h1>
            <p className="text-xs text-gray-500">Save your collection across devices</p>
          </div>
        </div>

        <button
          onClick={googleSignIn} disabled={loading} type="button"
          className="w-full bg-white hover:bg-gray-100 text-gray-900 font-bold py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-4"
        >
          <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3 0 5.7 1.1 7.8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.8-2 13.4-5.2l-6.2-5.2C29.1 35.3 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.1 4.1-3.9 5.6l6.2 5.2C41.6 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-gray-400 font-semibold flex items-center gap-1.5"><Mail size={11} /> Email</span>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:border-red-500 focus:outline-none"
              placeholder="you@email.com"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400 font-semibold flex items-center gap-1.5"><Lock size={11} /> Password</span>
            <input
              type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:border-red-500 focus:outline-none"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit" disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? '…' : (mode === 'signin' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <button
          onClick={magicLink} disabled={loading}
          className="mt-3 w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          Email me a magic link
        </button>

        {msg && <div className="mt-3 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800/40 px-3 py-2 rounded-lg">{msg}</div>}

        <div className="mt-4 text-center text-xs text-gray-500">
          {mode === 'signin' ? (
            <>New? <button className="text-red-400 hover:underline" onClick={() => setMode('signup')}>Create an account</button></>
          ) : (
            <>Already have one? <button className="text-red-400 hover:underline" onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </div>
      </div>
    </div>
  )
}
