import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage, getErrorMessage } from './errors'

describe('getErrorMessage', () => {
  it.each([
    ['42501', 'Недостаточно прав'],
    ['CR001', 'переход статуса недопустим'],
    ['CR002', 'нужен комментарий'],
    ['CR003', 'принята и не может быть изменена'],
    ['CR004', 'Исполнитель'],
    ['23514', 'длину полей'],
    ['23503', 'связаны задачи'],
  ])('maps %s', (code, fragment) => {
    expect(getErrorMessage({ code, message: 'raw db message' })).toContain(fragment)
  })

  it('never leaks the raw message for unknown codes', () => {
    expect(getErrorMessage({ code: 'XX999', message: 'secret internals' })).toBe(
      'Не удалось выполнить действие. Попробуйте ещё раз.',
    )
  })

  it('handles network errors and non-objects', () => {
    expect(getErrorMessage(new TypeError('Failed to fetch'))).toContain('Нет соединения')
    expect(getErrorMessage(null)).toContain('Не удалось')
    expect(getErrorMessage('boom')).toContain('Не удалось')
  })
})

describe('getAuthErrorMessage', () => {
  it('explains wrong credentials', () => {
    expect(getAuthErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Неверный email или пароль.',
    )
    expect(getAuthErrorMessage({ message: 'Invalid login credentials' })).toBe('Неверный email или пароль.')
  })

  it('explains rate limiting', () => {
    expect(getAuthErrorMessage({ code: 'over_request_rate_limit' })).toContain('Слишком много попыток')
  })
})
