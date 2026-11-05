import { useState } from 'react'
import { Select, Stack, Title } from '@mantine/core'
import { useAuth } from '../auth/useAuth'
import { QueryState } from '../components/QueryState'
import { TaskList } from '../components/TaskList'
import { useTasks } from '../hooks/queries'
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '../lib/taskActions'

const ALL = 'all'
const FILTER_OPTIONS = [
  { value: ALL, label: 'Все статусы' },
  ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
]

export function MyTasksPage() {
  const { profile } = useAuth()
  const [filter, setFilter] = useState<string>(ALL)
  const tasks = useTasks({
    assigneeId: profile?.id,
    status: filter === ALL ? undefined : (filter as TaskStatus),
  })

  return (
    <Stack>
      <Title order={2}>Мои задачи</Title>
      <Select
        label="Статус"
        w={240}
        allowDeselect={false}
        data={FILTER_OPTIONS}
        value={filter}
        onChange={(v) => setFilter(v ?? ALL)}
      />
      <QueryState isPending={tasks.isPending} error={tasks.error}>
        <TaskList
          tasks={tasks.data ?? []}
          showObject
          emptyText={filter === ALL ? 'Задач пока нет.' : 'Нет задач с таким статусом.'}
        />
      </QueryState>
    </Stack>
  )
}
