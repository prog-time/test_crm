import { describe, expect, it } from 'vitest'
import {
  getAvailableActions,
  STATUS_LABELS,
  TASK_STATUSES,
  TRANSITION_ACTIONS,
  type TaskAction,
  type TaskStatus,
  type UserRole,
} from './taskActions'

// Explicit expectation table, written from the DB matrix (_check_status_transition + tasks triggers):
//   new/rework -> in_progress, in_progress -> review: assigned executor only
//   review -> accepted / rework: any manager; manager edits/deletes while status != accepted
const EXPECTED: Record<UserRole, Record<TaskStatus, { assignee: TaskAction[]; other: TaskAction[] }>> = {
  executor: {
    new: { assignee: ['start'], other: [] },
    in_progress: { assignee: ['send_to_review'], other: [] },
    review: { assignee: [], other: [] },
    accepted: { assignee: [], other: [] },
    rework: { assignee: ['start'], other: [] },
  },
  manager: {
    new: { assignee: ['edit', 'delete'], other: ['edit', 'delete'] },
    in_progress: { assignee: ['edit', 'delete'], other: ['edit', 'delete'] },
    review: { assignee: ['accept', 'rework', 'edit', 'delete'], other: ['accept', 'rework', 'edit', 'delete'] },
    accepted: { assignee: [], other: [] },
    rework: { assignee: ['edit', 'delete'], other: ['edit', 'delete'] },
  },
}

describe('getAvailableActions', () => {
  for (const role of ['executor', 'manager'] as const) {
    for (const status of TASK_STATUSES) {
      for (const isAssignee of [true, false]) {
        it(`${role} / ${status} / assignee=${isAssignee}`, () => {
          const expected = EXPECTED[role][status][isAssignee ? 'assignee' : 'other']
          expect(getAvailableActions(role, status, isAssignee)).toEqual(expected)
        })
      }
    }
  }

  it('covers every role x status x assignee combination', () => {
    expect(TASK_STATUSES).toHaveLength(5)
    expect(Object.keys(EXPECTED.executor).sort()).toEqual([...TASK_STATUSES].sort())
    expect(Object.keys(EXPECTED.manager).sort()).toEqual([...TASK_STATUSES].sort())
  })

  it('maps actions to the target statuses of the DB matrix', () => {
    expect(TRANSITION_ACTIONS.start?.to).toBe('in_progress')
    expect(TRANSITION_ACTIONS.send_to_review?.to).toBe('review')
    expect(TRANSITION_ACTIONS.accept?.to).toBe('accepted')
    expect(TRANSITION_ACTIONS.rework?.to).toBe('rework')
    expect(TRANSITION_ACTIONS.rework?.requiresComment).toBe(true)
  })

  it('has Russian labels for every status', () => {
    expect(STATUS_LABELS).toEqual({
      new: 'Новая',
      in_progress: 'В работе',
      review: 'На проверке',
      accepted: 'Принята',
      rework: 'На доработке',
    })
  })
})
