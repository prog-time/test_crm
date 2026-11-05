// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updates: { table: string; payload: unknown }[] = []

vi.mock('../lib/supabase', () => {
  function builder(table: string) {
    const rows: Record<string, unknown[]> = {
      profiles: [{ id: 'exec-1', full_name: 'Иван' }],
      objects: [{ id: 'obj-1', name: 'Объект 1' }],
    }
    const b: Record<string, unknown> = {
      update: (payload: unknown) => {
        updates.push({ table, payload })
        rows[table] = [{ id: 'task-1' }]
        return b
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null }),
    }
    for (const m of ['select', 'eq', 'order']) b[m] = () => b
    return b
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

import { EditTaskModal } from './TaskPage'

const task = {
  id: 'task-1',
  title: 'Заголовок',
  description: null,
  object_id: 'obj-1',
  assignee_id: 'exec-1',
}

describe('EditTaskModal', () => {
  beforeEach(() => {
    updates.length = 0
  })

  it('sends only title/description/assignee_id/object_id', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <EditTaskModal task={task} onClose={onClose} />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    )
    const title = await screen.findByLabelText(/Название/)
    await user.clear(title)
    await user.type(title, '  Новое название ')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0].table).toBe('tasks')
    expect(updates[0].payload).toEqual({
      title: 'Новое название',
      description: null,
      assignee_id: 'exec-1',
      object_id: 'obj-1',
    })
    expect(Object.keys(updates[0].payload as object).sort()).toEqual([
      'assignee_id',
      'description',
      'object_id',
      'title',
    ])
  })
})
