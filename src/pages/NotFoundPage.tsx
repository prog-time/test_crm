import { Button, Container, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <Container size="sm" py="xl">
      <Stack align="flex-start">
        <Title order={1}>404</Title>
        <Text c="dimmed">Page not found.</Text>
        <Button component={Link} to="/" variant="light">
          Back to home
        </Button>
      </Stack>
    </Container>
  )
}
