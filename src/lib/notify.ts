import { notifications } from '@mantine/notifications'
import { getErrorMessage } from './errors'

export function notifyError(error: unknown) {
  notifications.show({ color: 'red', title: 'Ошибка', message: getErrorMessage(error) })
}

export function notifySuccess(message: string) {
  notifications.show({ color: 'green', message })
}
