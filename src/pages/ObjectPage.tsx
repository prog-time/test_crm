import { useState } from 'react'
import { Anchor, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { QueryState } from '../components/QueryState'
import { TaskFormFields } from '../components/TaskFormFields'
import { validateTaskForm, type TaskFormValues } from '../lib/taskForm'
import { TaskList } from '../components/TaskList'
import { useCreateTask, useObject, useTasks } from '../hooks/queries'
import { notifySuccess } from '../lib/notify'

const EMPTY_FORM: TaskFormValues = { title: '', description: '', assigneeId: null }

function CreateTaskForm({ objectId, authorId }: { objectId: string; authorId: string }) {
  const create = useCreateTask()
  const [values, setValues] = useState<TaskFormValues>(EMPTY_FORM)
  const [submitted, setSubmitted] = useState(false)
  const errors = validateTaskForm(values)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (errors.title || errors.description || errors.assignee) return
    create.mutate(
      {
        object_id: objectId,
        author_id: authorId, // required by the type; overwritten by the DB trigger

        title: values.title.trim(),
        description: values.description.trim() || null,
        assignee_id: values.assigneeId!,
      },
      {
        onSuccess: () => {
          notifySuccess('Задача создана')
          setValues(EMPTY_FORM)
          setSubmitted(false)
        },
      },
    )
  }

  return (
    <Card withBorder>
      <form onSubmit={handleSubmit} noValidate aria-label="Новая задача">
        <Stack>
          <Title order={4}>Новая задача</Title>
          <TaskFormFields values={values} onChange={setValues} errors={submitted ? errors : null} />
          <Group>
            <Button type="submit" loading={create.isPending}>
              Создать задачу
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  )
}

export function ObjectPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager'
  const object = useObject(id)
  const tasks = useTasks({ objectId: id })

  return (
    <Stack>
      <Anchor component={Link} to="/objects" size="sm">
        ← К объектам
      </Anchor>
      <QueryState isPending={object.isPending} error={object.error}>
        {!object.data ? (
          <Text>Объект не найден или нет доступа.</Text>
        ) : (
          <>
            <Stack gap={4}>
              <Title order={2}>{object.data.name}</Title>
              {object.data.address && <Text c="dimmed">{object.data.address}</Text>}
            </Stack>
            {isManager && profile && <CreateTaskForm objectId={object.data.id} authorId={profile.id} />}
            <Title order={3}>{isManager ? 'Задачи объекта' : 'Мои задачи на объекте'}</Title>
            <QueryState isPending={tasks.isPending} error={tasks.error}>
              <TaskList tasks={tasks.data ?? []} showAssignee={isManager} />
            </QueryState>
          </>
        )}
      </QueryState>
    </Stack>
  )
}
