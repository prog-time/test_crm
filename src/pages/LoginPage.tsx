import { useState } from 'react'
import { Alert, Button, Container, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { Navigate } from 'react-router-dom'
import { homePath, useAuth } from '../auth/useAuth'
import { getAuthErrorMessage } from '../lib/errors'

export function LoginPage() {
  const { status, profile, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    // no profile: ProtectedRoute shows its error screen with a sign-out button
    return <Navigate to={profile ? homePath(profile.role) : '/'} replace />
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
    } catch (e) {
      setError(getAuthErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container size={420} py={80}>
      <Title order={2} ta="center" mb="lg">
        Вход в Mini CRM
      </Title>
      <Paper withBorder shadow="sm" p="lg" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <TextInput
              label="Email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Пароль"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={submitting}>
              Войти
            </Button>
          </Stack>
        </form>
      </Paper>
    </Container>
  )
}
