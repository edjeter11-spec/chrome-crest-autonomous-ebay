import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, supabaseReady } from './supabase'

const AuthCtx = createContext({ user: null, loading: true, signOut: () => {} })

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseReady) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user || null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null)
    })
    return () => sub?.subscription?.unsubscribe()
  }, [])

  const signOut = async () => {
    if (supabaseReady) await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <AuthCtx.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
