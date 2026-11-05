import { Badge } from '@mantine/core'
import { STATUS_LABELS, type TaskStatus } from '../lib/taskActions'

const COLORS: Record<TaskStatus, string> = {
  new: 'gray',
  in_progress: 'blue',
  review: 'yellow',
  accepted: 'green',
  rework: 'orange',
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge color={COLORS[status]}>{STATUS_LABELS[status]}</Badge>
}
