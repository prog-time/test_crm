import { Select, Stack, Textarea, TextInput } from '@mantine/core'
import { useExecutors } from '../hooks/queries'
import type { TaskFormValues, TaskFormErrors } from '../lib/taskForm'

interface Props {
  values: TaskFormValues
  onChange: (values: TaskFormValues) => void
  errors: TaskFormErrors | null
  /** when provided, shows an object selector (task edit) */
  objects?: { id: string; name: string }[]
}

export function TaskFormFields({ values, onChange, errors, objects }: Props) {
  const executors = useExecutors(true)
  return (
    <Stack>
      <TextInput
        label="Название"
        required
        value={values.title}
        onChange={(e) => onChange({ ...values, title: e.currentTarget.value })}
        error={errors?.title}
      />
      <Textarea
        label="Описание"
        autosize
        minRows={3}
        value={values.description}
        onChange={(e) => onChange({ ...values, description: e.currentTarget.value })}
        error={errors?.description}
      />
      {objects && (
        <Select
          label="Объект"
          required
          allowDeselect={false}
          data={objects.map((o) => ({ value: o.id, label: o.name }))}
          value={values.objectId ?? null}
          onChange={(v) => onChange({ ...values, objectId: v })}
          error={errors?.object}
        />
      )}
      <Select
        label="Исполнитель"
        required
        allowDeselect={false}
        placeholder={executors.isPending ? 'Загрузка…' : 'Выберите исполнителя'}
        data={(executors.data ?? []).map((e) => ({ value: e.id, label: e.full_name }))}
        value={values.assigneeId}
        onChange={(v) => onChange({ ...values, assigneeId: v })}
        error={errors?.assignee ?? (executors.error ? 'Не удалось загрузить исполнителей' : null)}
        searchable
        nothingFoundMessage="Исполнители не найдены"
      />
    </Stack>
  )
}
