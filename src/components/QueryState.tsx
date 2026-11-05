import { Alert, Center, Loader } from '@mantine/core'
import type { ReactNode } from 'react'
import { getErrorMessage } from '../lib/errors'

interface Props {
  isPending: boolean
  error: unknown
  children: ReactNode
}

/** Shows loading / error states; renders children once data is ready. */
export function QueryState({ isPending, error, children }: Props) {
  if (isPending) {
    return (
      <Center py="xl">
        <Loader aria-label="Загрузка" />
      </Center>
    )
  }
  if (error) {
    return (
      <Alert color="red" title="Не удалось загрузить данные">
        {getErrorMessage(error)}
      </Alert>
    )
  }
  return <>{children}</>
}
