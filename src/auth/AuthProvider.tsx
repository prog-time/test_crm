import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [initialized, setInitialized] = useState(false)
  const prevUserId = useRef<string | undefined>(undefined)

  useEffect(() => {
    // Keep the callback synchronous: calling supabase from inside it can deadlock the auth lock.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // never leak cached data between users (sign-out or switching accounts)
      if (event === 'SIGNED_OUT' || (prevUserId.current && next?.user.id !== prevUserId.current)) {
        queryClient.clear()
      }
      prevUserId.current = next?.user.id
      setSession(next)
      setInitialized(true)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId!).single()
      if (error) throw error
      return data
    },
  })

  const value = useMemo<AuthState>(() => {
    let status: AuthState['status']
    if (!initialized) status = 'loading'
    else if (!session) status = 'unauthenticated'
    else if (profileQuery.isPending) status = 'loading'
    else status = 'authenticated'
    return {
      status,
      session,
      profile: session ? (profileQuery.data ?? null) : null,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }
  }, [initialized, session, profileQuery.isPending, profileQuery.data])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
