// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReworkModal } from './ReworkModal'

function setup() {
  const onSubmit = vi.fn()
  render(
    <MantineProvider>
      <ReworkModal opened onClose={() => {}} onSubmit={onSubmit} />
    </MantineProvider>,
  )
  return { onSubmit, user: userEvent.setup() }
}

describe('ReworkModal', () => {
  it('does not submit an empty comment', async () => {
    const { onSubmit, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText(/Укажите комментарий/)).toBeInTheDocument()
  })

  it('does not submit a whitespace-only comment', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/Комментарий/), '   ')
    await user.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed comment', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/Комментарий/), '  Переделать шов ')
    await user.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    expect(onSubmit).toHaveBeenCalledWith('Переделать шов')
  })
})
