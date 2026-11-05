import { useState } from 'react'
import { Anchor, Button, Group, Modal, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { QueryState } from '../components/QueryState'
import { useDeleteObject, useObjects, useSaveObject } from '../hooks/queries'
import { NO_VALUE } from '../lib/format'
import { notifySuccess } from '../lib/notify'
import type { Tables } from '../types/database'

type ObjectRow = Tables<'objects'>

function ObjectFormModal({ target, onClose }: { target: ObjectRow | 'new'; onClose: () => void }) {
  const save = useSaveObject()
  const existing = target === 'new' ? null : target
  const [name, setName] = useState(existing?.name ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [touched, setTouched] = useState(false)
  const nameError = !name.trim() ? 'Укажите название' : name.length > 200 ? 'Не более 200 символов' : null
  const addressError = address.length > 500 ? 'Не более 500 символов' : null

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (nameError || addressError) return
    save.mutate(
      { id: existing?.id, name: name.trim(), address: address.trim() || null },
      {
        onSuccess: () => {
          notifySuccess(existing ? 'Объект сохранён' : 'Объект создан')
          onClose()
        },
      },
    )
  }

  return (
    <Modal opened onClose={onClose} title={existing ? 'Редактировать объект' : 'Новый объект'}>
      <form onSubmit={handleSubmit} noValidate>
        <Stack>
          <TextInput
            label="Название"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={touched ? nameError : null}
            data-autofocus
          />
          <Textarea
            label="Адрес"
            autosize
            minRows={2}
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
            error={touched ? addressError : null}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={save.isPending}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

function DeleteObjectModal({ target, onClose }: { target: ObjectRow; onClose: () => void }) {
  const del = useDeleteObject()
  return (
    <Modal opened onClose={onClose} title="Удалить объект?">
      <Stack>
        <Text>
          Объект «{target.name}» будет удалён. Если у объекта есть задачи, удалить его не получится.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button
            color="red"
            loading={del.isPending}
            onClick={() =>
              del.mutate(target.id, {
                onSuccess: () => {
                  notifySuccess('Объект удалён')
                  onClose()
                },
                // error is shown by the global handler; keep the dialog open
              })
            }
          >
            Удалить
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export function ObjectsPage() {
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager'
  const objects = useObjects()
  const [editing, setEditing] = useState<ObjectRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ObjectRow | null>(null)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Объекты</Title>
        {isManager && <Button onClick={() => setEditing('new')}>Создать объект</Button>}
      </Group>
      <QueryState isPending={objects.isPending} error={objects.error}>
        {objects.data?.length === 0 ? (
          <Text c="dimmed">
            {isManager ? 'Объектов пока нет. Создайте первый.' : 'У вас пока нет задач ни на одном объекте.'}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={500}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Название</Table.Th>
                  <Table.Th>Адрес</Table.Th>
                  {isManager && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {objects.data?.map((obj) => (
                  <Table.Tr key={obj.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/objects/${obj.id}`}>
                        {obj.name}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{obj.address || NO_VALUE}</Table.Td>
                    {isManager && (
                      <Table.Td>
                        <Group gap="xs" justify="flex-end" wrap="nowrap">
                          <Button size="compact-sm" variant="light" onClick={() => setEditing(obj)}>
                            Изменить
                          </Button>
                          <Button size="compact-sm" variant="light" color="red" onClick={() => setDeleting(obj)}>
                            Удалить
                          </Button>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </QueryState>
      {isManager && editing && (
        <ObjectFormModal key={editing === 'new' ? 'new' : editing.id} target={editing} onClose={() => setEditing(null)} />
      )}
      {isManager && deleting && <DeleteObjectModal target={deleting} onClose={() => setDeleting(null)} />}
    </Stack>
  )
}
