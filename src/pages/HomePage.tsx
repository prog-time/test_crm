import { Button, Container, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <Container size="sm" py="xl">
      <Stack align="flex-start">
        <Title order={1}>Mini CRM</Title>
        <Text c="dimmed">The app skeleton is up and running.</Text>
        <Button component={Link} to="/missing">
          Check the 404 route
        </Button>
      </Stack>
    </Container>
  )
}
