export interface TaskFormValues {
  title: string
  description: string
  assigneeId: string | null
  objectId?: string | null
}

export function validateTaskForm(values: TaskFormValues, requireObject = false) {
  return {
    title: !values.title.trim()
      ? 'Укажите название'
      : values.title.length > 200
        ? 'Не более 200 символов'
        : null,
    description: values.description.length > 5000 ? 'Не более 5000 символов' : null,
    assignee: values.assigneeId ? null : 'Выберите исполнителя',
    object: requireObject && !values.objectId ? 'Выберите объект' : null,
  }
}

export type TaskFormErrors = ReturnType<typeof validateTaskForm>
