const formatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function formatDateTime(iso: string): string {
  return formatter.format(new Date(iso))
}

export const NO_VALUE = '—'
