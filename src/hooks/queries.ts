import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TaskStatus } from '../lib/taskActions'

// Invalid uuid in the URL -> 22P02; treat it like "not found".
function isNotFoundCode(error: { code?: string }) {
  return error.code === '22P02'
}

const TASK_SELECT = `*,
  object:objects(id, name),
  assignee:profiles!tasks_assignee_id_fkey(id, full_name),
  author:profiles!tasks_author_id_fkey(id, full_name)`

// ---------- queries ----------

export function useObjects() {
  return useQuery({
    queryKey: ['objects', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('objects').select('*').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useObject(id: string | undefined) {
  return useQuery({
    queryKey: ['objects', 'detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('objects').select('*').eq('id', id!).maybeSingle()
      if (error) {
        if (isNotFoundCode(error)) return null
        throw error
      }
      return data
    },
  })
}

export interface TaskListFilter {
  objectId?: string
  assigneeId?: string
  status?: TaskStatus
}

export function useTasks(filter: TaskListFilter) {
  return useQuery({
    queryKey: ['tasks', 'list', filter],
    queryFn: async () => {
      let query = supabase.from('tasks').select(TASK_SELECT)
      if (filter.objectId) query = query.eq('object_id', filter.objectId)
      if (filter.assigneeId) query = query.eq('assignee_id', filter.assigneeId)
      if (filter.status) query = query.eq('status', filter.status)
      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/** Resolves to null when the task does not exist, is soft-deleted or is invisible (RLS). */
export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['tasks', 'detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select(TASK_SELECT).eq('id', id!).maybeSingle()
      if (error) {
        if (isNotFoundCode(error)) return null
        throw error
      }
      return data
    },
  })
}

export function useTaskHistory(taskId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', 'history', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_status_history')
        .select('*, actor:profiles!task_status_history_changed_by_fkey(id, full_name)')
        .eq('task_id', taskId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

/** Managers only (executors cannot see other executors). */
export function useExecutors(enabled: boolean) {
  return useQuery({
    queryKey: ['executors'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'executor')
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

// ---------- mutations (errors are reported centrally by the QueryClient's MutationCache) ----------

export function useSaveObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; address: string | null }) => {
      const { id, ...values } = input
      const req = id
        ? supabase.from('objects').update(values).eq('id', id)
        : supabase.from('objects').insert(values)
      const { data, error } = await req.select('id')
      if (error) throw error
      if (!data.length) throw { code: '42501', message: 'No rows affected' }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function useDeleteObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('objects').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data.length) throw { code: '42501', message: 'No rows affected' }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export interface TaskInput {
  title: string
  description: string | null
  object_id: string
  assignee_id: string
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: TaskInput & { author_id: string }) => {
      const { error } = await supabase.from('tasks').insert(input)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: TaskInput) => {
      const { data, error } = await supabase.from('tasks').update(input).eq('id', taskId).select('id')
      if (error) throw error
      if (!data.length) throw { code: '42501', message: 'No rows affected' }
    },
    // object card task lists live under ['tasks'], so ['objects'] needs no invalidation
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useChangeTaskStatus(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { status: TaskStatus; comment?: string }) => {
      const { error } = await supabase.rpc('change_task_status', {
        p_task_id: taskId,
        p_new_status: input.status,
        p_comment: input.comment,
      })
      if (error) throw error
    },
    // refreshes task detail, lists and history without a page reload; also after errors
    // (CR001/42501) so a stale card is corrected
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteTask(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_task', { p_task_id: taskId })
      if (error) throw error
    },
    // detail/history are removed by the caller after navigating away (avoids a "not found" flash)
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
        qc.invalidateQueries({ queryKey: ['objects'] }),
      ]),
  })
}

