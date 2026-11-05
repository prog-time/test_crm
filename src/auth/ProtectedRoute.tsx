import { Alert, Button, Center, Container, Loader, Stack } from '@mantine/core'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { UserRole } from '../lib/taskActions'
import { homePath, useAuth } from './useAuth'

interface Props {
  /** If set, other roles are redirected to their own start screen. */
  roles?: UserRole[]
}

export function ProtectedRoute({ roles }: Props) {
  const { status, profile, signOut } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <Center h="100vh">
        <Loader aria-label="Загрузка" />
      </Center>
    )
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!profile) {
    return (
      <Container size="xs" py="xl">
        <Stack>
          <Alert color="red" title="Профиль не найден">
            Не удалось загрузить профиль пользователя. Войдите заново или обратитесь к администратору.
          </Alert>
          <Button variant="light" onClick={() => void signOut()}>
            Выйти
          </Button>
        </Stack>
      </Container>
    )
  }
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to={homePath(profile.role)} replace />
  }
  return <Outlet />
}
