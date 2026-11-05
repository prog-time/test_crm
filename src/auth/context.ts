import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Tables } from '../types/database'

export type Profile = Tables<'profiles'>

export interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  session: Session | null
  /** null while loading, when signed out or when the profile could not be loaded */
  profile: Profile | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
