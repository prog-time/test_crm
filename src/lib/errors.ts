const CODE_MESSAGES: Record<string, string> = {
  '42501': 'Недостаточно прав или объект не найден.',
  CR001: 'Такой переход статуса недопустим.',
  CR002: 'Для возврата на доработку нужен комментарий.',
  CR003: 'Задача принята и не может быть изменена.',
  CR004: 'Исполнителем может быть только пользователь с ролью «Исполнитель».',
  '23514': 'Значение слишком длинное или пустое. Проверьте длину полей.',
  '23503': 'Нельзя удалить: с объектом связаны задачи.',
  '22P02': 'Некорректный идентификатор.',
}

const FALLBACK = 'Не удалось выполнить действие. Попробуйте ещё раз.'

interface ErrorLike {
  code?: unknown
  message?: unknown
}

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const { code } = error as ErrorLike
    if (typeof code === 'string' && code) return code
  }
  return undefined
}

/** Maps a PostgREST / RPC error to a clear Russian message. */
export function getErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  const message = typeof error === 'object' && error !== null ? (error as ErrorLike).message : undefined
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Нет соединения с сервером. Проверьте интернет.'
  }
  return FALLBACK
}

/** Maps a sign-in error to a clear Russian message. */
export function getAuthErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  const message = typeof error === 'object' && error !== null ? String((error as ErrorLike).message ?? '') : ''
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'Неверный email или пароль.'
  }
  if (code === 'over_request_rate_limit' || /rate limit/i.test(message)) {
    return 'Слишком много попыток. Подождите немного и повторите.'
  }
  return getErrorMessage(error)
}
