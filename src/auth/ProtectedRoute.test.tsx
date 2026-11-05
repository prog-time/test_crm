// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AuthState } from './context'

const auth: { current: Partial<AuthState> } = { current: {} }
vi.mock('./useAuth', () => ({
  useAuth: () => auth.current,
  homePath: (role: string) => (role === 'executor' ? '/my-tasks' : '/objects'),
}))

import { ProtectedRoute } from './ProtectedRoute'

function renderAt(path: string, roles?: ('manager' | 'executor')[]) {
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/objects" element={<div>objects page</div>} />
          <Route element={<ProtectedRoute roles={roles} />}>
            <Route path="/secret" element={<div>secret page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )
}

describe('ProtectedRoute', () => {
  it('redirects an unauthenticated user to /login', () => {
    auth.current = { status: 'unauthenticated', profile: null }
    renderAt('/secret')
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('secret page')).toBeNull()
  })

  it('renders children for an authenticated user', () => {
    auth.current = { status: 'authenticated', profile: { role: 'manager' } as AuthState['profile'] }
    renderAt('/secret')
    expect(screen.getByText('secret page')).toBeInTheDocument()
  })

  it('redirects a wrong role to its start screen', () => {
    auth.current = { status: 'authenticated', profile: { role: 'manager' } as AuthState['profile'] }
    renderAt('/secret', ['executor'])
    expect(screen.getByText('objects page')).toBeInTheDocument()
  })
})
