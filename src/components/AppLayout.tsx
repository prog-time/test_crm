import { AppShell, Badge, Button, Container, Group, Text, Title } from '@mantine/core'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ROLE_LABELS } from '../lib/taskActions'

export function AppLayout() {
  const { profile, signOut } = useAuth()
  const isExecutor = profile?.role === 'executor'

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Title order={4}>Mini CRM</Title>
            <Group component="nav" aria-label="Основная навигация" gap="xs">
              <Button component={NavLink} to="/objects" variant="subtle" size="compact-md">
                Объекты
              </Button>
              {isExecutor && (
                <Button component={NavLink} to="/my-tasks" variant="subtle" size="compact-md">
                  Мои задачи
                </Button>
              )}
            </Group>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" visibleFrom="sm">
              {profile?.full_name}
            </Text>
            {profile && <Badge variant="light">{ROLE_LABELS[profile.role]}</Badge>}
            <Button variant="default" size="compact-md" onClick={() => void signOut()}>
              Выйти
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg">
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}
