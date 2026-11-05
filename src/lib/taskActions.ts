import type { Enums } from '../types/database'

export type TaskStatus = Enums<'task_status'>
export type UserRole = Enums<'user_role'>

export const TASK_STATUSES: readonly TaskStatus[] = ['new', 'in_progress', 'review', 'accepted', 'rework']

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  manager: 'Постановщик',
  executor: 'Исполнитель',
}

export type TaskAction = 'start' | 'send_to_review' | 'accept' | 'rework' | 'edit' | 'delete'

export interface TransitionMeta {
  to: TaskStatus
  label: string
  requiresComment: boolean
}

/** Status transitions triggered by actions (the rest of TaskAction are non-status actions). */
export const TRANSITION_ACTIONS: Partial<Record<TaskAction, TransitionMeta>> = {
  start: { to: 'in_progress', label: 'Взять в работу', requiresComment: false },
  send_to_review: { to: 'review', label: 'Отправить на проверку', requiresComment: false },
  accept: { to: 'accepted', label: 'Принять', requiresComment: false },
  rework: { to: 'rework', label: 'На доработку', requiresComment: true },
}

/**
 * The single place where the UI decides which buttons to show. It mirrors the DB rules
 * (`_check_status_transition`, tasks RLS/triggers); the database stays the source of truth.
 *
 * - new / rework -> in_progress, in_progress -> review: the assigned executor only
 * - review -> accepted / rework: a manager (rework needs a comment)
 * - a manager may edit/delete a task while it is not accepted
 */
export function getAvailableActions(role: UserRole, status: TaskStatus, isAssignee: boolean): TaskAction[] {
  if (role === 'executor') {
    if (!isAssignee) return []
    if (status === 'new' || status === 'rework') return ['start']
    if (status === 'in_progress') return ['send_to_review']
    return []
  }
  if (status === 'accepted') return []
  const actions: TaskAction[] = status === 'review' ? ['accept', 'rework'] : []
  actions.push('edit', 'delete')
  return actions
}
