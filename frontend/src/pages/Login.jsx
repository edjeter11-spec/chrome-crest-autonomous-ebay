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
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Check your email to confirm your account.')
      }
    } catch (err) {
      setMsg(err.message || 'Error')
    } finally {
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
