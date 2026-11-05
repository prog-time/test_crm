import { useState } from 'react'
import { Button, Group, Modal, Stack, Textarea } from '@mantine/core'

interface Props {
  opened: boolean
  loading?: boolean
  onClose: () => void
  onSubmit: (comment: string) => void
}

export const MAX_COMMENT_LENGTH = 2000

export function ReworkModal({ opened, loading = false, onClose, onSubmit }: Props) {
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = comment.trim()
  const error = !trimmed
    ? 'Укажите комментарий: что нужно доработать'
    : comment.length > MAX_COMMENT_LENGTH
      ? `Не более ${MAX_COMMENT_LENGTH} символов`
      : null

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (error) return
    onSubmit(trimmed)
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Вернуть на доработку">
      <form onSubmit={handleSubmit} noValidate>
        <Stack>
          <Textarea
            label="Комментарий"
            description="Обязателен: исполнитель увидит его в истории"
            required
            autosize
            minRows={3}
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            error={touched ? error : null}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={loading}>
              Вернуть на доработку
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
