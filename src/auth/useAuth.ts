import { useContext } from 'react'
import { AuthContext, type AuthState } from './context'

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** Start screen per role. */
export function homePath(role: 'manager' | 'executor'): string {
  return role === 'executor' ? '/my-tasks' : '/objects'
}
