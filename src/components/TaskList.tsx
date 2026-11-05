import { Table, Text, Anchor } from '@mantine/core'
import { Link } from 'react-router-dom'
import { formatDateTime, NO_VALUE } from '../lib/format'
import type { TaskStatus } from '../lib/taskActions'
import { StatusBadge } from './StatusBadge'

export interface TaskRow {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  object: { id: string; name: string } | null
  assignee: { id: string; full_name: string } | null
}

interface Props {
  tasks: TaskRow[]
  showObject?: boolean
  showAssignee?: boolean
  emptyText?: string
}

export function TaskList({ tasks, showObject = false, showAssignee = false, emptyText = 'Задач нет.' }: Props) {
  if (tasks.length === 0) return <Text c="dimmed">{emptyText}</Text>
  return (
    <Table.ScrollContainer minWidth={500}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Задача</Table.Th>
            {showObject && <Table.Th>Объект</Table.Th>}
            {showAssignee && <Table.Th>Исполнитель</Table.Th>}
            <Table.Th>Статус</Table.Th>
            <Table.Th>Создана</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tasks.map((task) => (
            <Table.Tr key={task.id}>
              <Table.Td>
                <Anchor component={Link} to={`/tasks/${task.id}`}>
                  {task.title}
                </Anchor>
              </Table.Td>
              {showObject && <Table.Td>{task.object?.name ?? NO_VALUE}</Table.Td>}
              {showAssignee && <Table.Td>{task.assignee?.full_name ?? NO_VALUE}</Table.Td>}
              <Table.Td>
                <StatusBadge status={task.status} />
              </Table.Td>
              <Table.Td>{formatDateTime(task.created_at)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
