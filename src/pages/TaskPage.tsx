import { useState } from 'react'
import { Alert, Anchor, Button, Card, Group, Modal, Stack, Text, Timeline, Title } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { QueryState } from '../components/QueryState'
import { ReworkModal } from '../components/ReworkModal'
import { StatusBadge } from '../components/StatusBadge'
import { TaskFormFields } from '../components/TaskFormFields'
import { validateTaskForm, type TaskFormValues } from '../lib/taskForm'
import {
  useChangeTaskStatus,
  useDeleteTask,
  useObjects,
  useTask,
  useTaskHistory,
  useUpdateTask,
} from '../hooks/queries'
import { formatDateTime, NO_VALUE } from '../lib/format'
import { notifySuccess } from '../lib/notify'
import { getAvailableActions, STATUS_LABELS, TRANSITION_ACTIONS, type TaskStatus } from '../lib/taskActions'

// The actor's profile may be invisible to the viewer; executor-side transitions are made by the assignee.
function fallbackActor(from: TaskStatus | null, to: TaskStatus): string {
  const executorSide =
    ((from === 'new' || from === 'rework') && to === 'in_progress') || (from === 'in_progress' && to === 'review')
  return executorSide ? 'Исполнитель' : NO_VALUE
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text component="div">{children}</Text>
    </div>
  )
}

interface EditTask {
  id: string
  title: string
  description: string | null
  object_id: string
  assignee_id: string
}

export function EditTaskModal({ task, onClose }: { task: EditTask; onClose: () => void }) {
  const update = useUpdateTask(task.id)
  const objects = useObjects()
  const [values, setValues] = useState<TaskFormValues>({
    title: task.title,
    description: task.description ?? '',
    assigneeId: task.assignee_id,
    objectId: task.object_id,
  })
  const [submitted, setSubmitted] = useState(false)
  const errors = validateTaskForm(values, true)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (errors.title || errors.description || errors.assignee || errors.object) return
    update.mutate(
      {
        title: values.title.trim(),
        description: values.description.trim() || null,
        assignee_id: values.assigneeId!,
        object_id: values.objectId!,
      },
      {
        onSuccess: () => {
          notifySuccess('Задача сохранена')
          onClose()
        },
      },
    )
  }

  return (
    <Modal opened onClose={onClose} title="Редактировать задачу">
      <form onSubmit={handleSubmit} noValidate>
        <Stack>
          <TaskFormFields
            values={values}
            onChange={setValues}
            errors={submitted ? errors : null}
            objects={objects.data ?? []}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={update.isPending}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

export function TaskPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile, session } = useAuth()
  const task = useTask(id)
  const history = useTaskHistory(id)
  const changeStatus = useChangeTaskStatus(id ?? '')
  const deleteTask = useDeleteTask(id ?? '')
  const [reworkOpen, setReworkOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <Stack>
      <QueryState isPending={task.isPending} error={task.error}>
        {!task.data || !profile ? (
          <Stack align="flex-start">
            <Alert color="gray" title="Задача не найдена или нет доступа" />
            <Anchor component={Link} to="/">
              На главную
            </Anchor>
          </Stack>
        ) : (
          (() => {
            const t = task.data
            const actions = getAvailableActions(profile.role, t.status, t.assignee_id === session?.user.id)
            return (
              <>
                <Anchor component={Link} to={`/objects/${t.object_id}`} size="sm">
                  ← К объекту
                </Anchor>
                <Group justify="space-between" align="flex-start">
                  <Title order={2}>{t.title}</Title>
                  <StatusBadge status={t.status} />
                </Group>

                {actions.length > 0 && (
                  <Group aria-label="Действия">
                    {actions.map((action) => {
                      const transition = TRANSITION_ACTIONS[action]
                      if (transition) {
                        return (
                          <Button
                            key={action}
                            color={action === 'rework' ? 'orange' : undefined}
                            variant={action === 'rework' ? 'light' : 'filled'}
                            loading={changeStatus.isPending && !transition.requiresComment}
                            disabled={changeStatus.isPending}
                            onClick={() => {
                              if (transition.requiresComment) setReworkOpen(true)
                              else
                                changeStatus.mutate(
                                  { status: transition.to },
                                  { onSuccess: () => notifySuccess(`Статус: ${STATUS_LABELS[transition.to]}`) },
                                )
                            }}
                          >
                            {transition.label}
                          </Button>
                        )
                      }
                      if (action === 'edit')
                        return (
                          <Button key={action} variant="default" onClick={() => setEditOpen(true)}>
                            Редактировать
                          </Button>
                        )
                      return (
                        <Button key={action} color="red" variant="light" onClick={() => setDeleteOpen(true)}>
                          Удалить
                        </Button>
                      )
                    })}
                  </Group>
                )}

                <Card withBorder>
                  <Stack gap="sm">
                    <Field label="Описание">{t.description || NO_VALUE}</Field>
                    <Group grow align="flex-start">
                      <Field label="Объект">
                        <Anchor component={Link} to={`/objects/${t.object_id}`}>
                          {t.object?.name ?? NO_VALUE}
                        </Anchor>
                      </Field>
                      <Field label="Исполнитель">{t.assignee?.full_name ?? NO_VALUE}</Field>
                      <Field label="Автор">{t.author?.full_name ?? NO_VALUE}</Field>
                      <Field label="Создана">{formatDateTime(t.created_at)}</Field>
                    </Group>
                  </Stack>
                </Card>

                <Title order={3}>История статусов</Title>
                <QueryState isPending={history.isPending} error={history.error}>
                  {history.data?.length ? (
                    <Timeline bulletSize={14} active={history.data.length - 1}>
                      {history.data.map((h) => (
                        <Timeline.Item
                          key={h.id}
                          title={
                            h.from_status
                              ? `${STATUS_LABELS[h.from_status]} → ${STATUS_LABELS[h.to_status]}`
                              : `Создана: ${STATUS_LABELS[h.to_status]}`
                          }
                        >
                          <Text size="sm" c="dimmed">
                            {h.actor?.full_name ?? fallbackActor(h.from_status, h.to_status)} · {formatDateTime(h.created_at)}
                          </Text>
                          {h.comment && <Text size="sm">{h.comment}</Text>}
                        </Timeline.Item>
                      ))}
                    </Timeline>
                  ) : (
                    <Text c="dimmed">История пуста.</Text>
                  )}
                </QueryState>

                <ReworkModal
                  opened={reworkOpen}
                  loading={changeStatus.isPending}
                  onClose={() => setReworkOpen(false)}
                  onSubmit={(comment) =>
                    changeStatus.mutate(
                      { status: 'rework', comment },
                      {
                        onSuccess: () => {
                          setReworkOpen(false)
                          notifySuccess('Задача возвращена на доработку')
                        },
                      },
                    )
                  }
                />
                {editOpen && <EditTaskModal task={t} onClose={() => setEditOpen(false)} />}
                <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)} title="Удалить задачу?">
                  <Stack>
                    <Text>Задача «{t.title}» будет удалена.</Text>
                    <Group justify="flex-end">
                      <Button variant="default" onClick={() => setDeleteOpen(false)}>
                        Отмена
                      </Button>
                      <Button
                        color="red"
                        loading={deleteTask.isPending}
                        onClick={() =>
                          deleteTask.mutate(undefined, {
                            onSuccess: () => {
                              notifySuccess('Задача удалена')
                              void navigate(`/objects/${t.object_id}`, { replace: true })
                              qc.removeQueries({ queryKey: ['tasks', 'detail', t.id] })
                              qc.removeQueries({ queryKey: ['tasks', 'history', t.id] })
                            },
                          })
                        }
                      >
                        Удалить
                      </Button>
                    </Group>
                  </Stack>
                </Modal>
              </>
            )
          })()
        )}
      </QueryState>
    </Stack>
  )
}
