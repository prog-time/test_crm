/**
 * Security check: proves that the database itself (RLS, grants, triggers, RPCs) rejects every
 * forbidden action, even when the UI is bypassed.
 *
 * The script talks to Supabase ONLY with the anon key and real email/password logins of four
 * dedicated check accounts (two managers, two executors). It never uses a service_role key.
 *
 * Run: npm run security-check   (see README, section "Проверка безопасности")
 *
 * It creates its own data (objects/tasks prefixed with "[security-check] <timestamp>"), drives it
 * to the needed states via legal RPC transitions and soft-deletes what is allowed at the end.
 * Tasks that reach `accepted` are locked by design and stay in the database.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.ts'

type Client = SupabaseClient<Database>
type Outcome = {
  data: unknown
  error: { code?: string; message: string } | null
}
type Account = { client: Client; id: string; email: string }

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
try {
  process.loadEnvFile('.env') // Node >= 20.12; real environment variables keep priority
} catch {
  // no .env file: rely on the process environment
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined)
  if (!value) {
    throw new Error(`Missing environment variable ${name}${fallback ? ` (or ${fallback})` : ''}`)
  }
  return value
}

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------
type Result = { name: string; pass: boolean; reason: string }
const results: Result[] = []

function record(name: string, pass: boolean, reason: string): void {
  results.push({ name, pass, reason })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} -- ${reason}`)
}

/**
 * PASS when the database denies the operation: a PostgREST/RPC error (optionally with one of the
 * expected SQLSTATE codes), or - for reads/writes filtered out by RLS - zero returned rows.
 * `verify` then re-checks (through a privileged-enough client) that nothing actually changed;
 * it returns an error message, or null when the state is intact.
 */
async function expectDenied(
  name: string,
  run: () => PromiseLike<Outcome>,
  options: { codes?: string[]; verify?: () => PromiseLike<string | null> } = {},
): Promise<void> {
  let reason: string
  try {
    const { data, error } = await run()
    if (error) {
      if (options.codes && !options.codes.includes(error.code ?? '')) {
        record(
          name,
          false,
          `denied with unexpected code ${error.code ?? '?'} (expected ${options.codes.join('/')}): ${error.message}`,
        )
        return
      }
      reason = `error ${error.code ?? '?'}: ${error.message}`
    } else if (Array.isArray(data) && data.length === 0) {
      if (options.codes) {
        record(name, false, `0 rows, but an error ${options.codes.join('/')} was expected`)
        return
      }
      reason = '0 rows'
    } else {
      record(name, false, `NOT denied, got: ${JSON.stringify(data).slice(0, 200)}`)
      return
    }
  } catch (e) {
    record(name, false, `unexpected exception: ${String(e)}`)
    return
  }

  if (options.verify) {
    const problem = await options.verify()
    if (problem) {
      record(name, false, `denied (${reason}) but state changed: ${problem}`)
      return
    }
    reason += '; state unchanged'
  }
  record(name, true, reason)
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------
// Node 20 has no global WebSocket and supabase-js insists on a realtime transport at construction
// time. The script never uses realtime, so a stub keeps it free of an extra dependency (`ws`).
class NoRealtime {
  constructor() {
    throw new Error('Realtime is not used by the security check')
  }
}

function newClient(url: string, anonKey: string): Client {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: NoRealtime as never },
  })
}

async function login(
  url: string,
  anonKey: string,
  label: string,
  emailVar: string,
  passwordVar: string,
  expectedRole: 'manager' | 'executor',
): Promise<Account> {
  const email = env(emailVar)
  const client = newClient(url, anonKey)
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: env(passwordVar),
  })
  if (error || !data.user) {
    throw new Error(`Login failed for ${label} (${email}): ${error?.message ?? 'no user'}`)
  }
  const { data: role, error: roleError } = await client.rpc('app_role')
  if (roleError || role !== expectedRole) {
    throw new Error(
      `${label} must have role '${expectedRole}', got '${String(role)}' ${roleError?.message ?? ''}`,
    )
  }
  return { client, id: data.user.id, email }
}

function must<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) {
    throw new Error(`Setup failed: ${what}: ${result.error?.message ?? 'no data'}`)
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const url = env('CHECK_SUPABASE_URL', 'VITE_SUPABASE_URL')
  const anonKey = env('CHECK_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  const prefix = `[security-check] ${new Date().toISOString()}`

  console.log(`Target: ${url}`)
  console.log(`Run marker: ${prefix}\n`)

  const m1 = await login(url, anonKey, 'manager 1', 'CHECK_MANAGER_EMAIL', 'CHECK_MANAGER_PASSWORD', 'manager')
  const m2 = await login(url, anonKey, 'manager 2', 'CHECK_MANAGER2_EMAIL', 'CHECK_MANAGER2_PASSWORD', 'manager')
  const a = await login(url, anonKey, 'executor A', 'CHECK_EXECUTOR_A_EMAIL', 'CHECK_EXECUTOR_A_PASSWORD', 'executor')
  const b = await login(url, anonKey, 'executor B', 'CHECK_EXECUTOR_B_EMAIL', 'CHECK_EXECUTOR_B_PASSWORD', 'executor')
  const anon = newClient(url, anonKey)
  const ids = new Set([m1.id, m2.id, a.id, b.id])
  if (ids.size !== 4) throw new Error('The four check accounts must be four different users')

  // --- Test data, created by manager 1 through legal paths --------------------------------
  const objectA = must(
    'create object A',
    await m1.client.from('objects').insert({ name: `${prefix} object A` }).select().single(),
  )
  const objectB = must(
    'create object B',
    await m1.client.from('objects').insert({ name: `${prefix} object B` }).select().single(),
  )
  const createTask = async (title: string, objectId: string, assigneeId: string) =>
    must(
      `create task "${title}"`,
      await m1.client
        .from('tasks')
        .insert({
          title: `${prefix} ${title}`,
          object_id: objectId,
          assignee_id: assigneeId,
          author_id: m1.id,
        })
        .select()
        .single(),
    )
  const move = async (who: Account, taskId: string, status: Database['public']['Enums']['task_status']) =>
    must(
      `move task to ${status}`,
      await who.client.rpc('change_task_status', { p_task_id: taskId, p_new_status: status }),
    )

  const taskNew = await createTask('A new', objectA.id, a.id) // stays `new`
  const taskB = await createTask('B task', objectB.id, b.id) // executor B's task
  const taskReview = await createTask('A review', objectA.id, a.id)
  await move(a, taskReview.id, 'in_progress')
  await move(a, taskReview.id, 'review')
  const taskAccepted = await createTask('A accepted', objectA.id, a.id)
  await move(a, taskAccepted.id, 'in_progress')
  await move(a, taskAccepted.id, 'review')
  await move(m1, taskAccepted.id, 'accepted')

  // --- State probes (done as manager 1, who can see everything) ----------------------------
  const taskField = async <K extends keyof Database['public']['Tables']['tasks']['Row']>(
    id: string,
    field: K,
  ) => {
    const { data, error } = await m1.client.from('tasks').select(field).eq('id', id).maybeSingle()
    if (error) throw new Error(`probe failed: ${error.message}`)
    return data === null ? undefined : (data as unknown as Record<K, unknown>)[field]
  }
  const historyCount = async (taskId: string) => {
    const { count, error } = await m1.client
      .from('task_status_history')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
    if (error) throw new Error(`probe failed: ${error.message}`)
    return count
  }
  const unchanged =
    (id: string, field: 'title' | 'status' | 'assignee_id', expected: unknown) => async () => {
      const actual = await taskField(id, field)
      return actual === expected ? null : `${field} is now ${String(actual)}, expected ${String(expected)}`
    }
  const taskStillExists = (id: string) => async () =>
    (await taskField(id, 'id')) === id ? null : 'task is gone'

  // === Spec checks ==========================================================================
  console.log('--- Executor A vs executor B task ---')
  await expectDenied('executor A SELECT of B task by id', () =>
    a.client.from('tasks').select().eq('id', taskB.id),
  )
  await expectDenied(
    'executor A UPDATE of B task title',
    () => a.client.from('tasks').update({ title: 'hacked' }).eq('id', taskB.id).select(),
    { verify: unchanged(taskB.id, 'title', taskB.title) },
  )
  await expectDenied(
    'executor A change_task_status on B task',
    () => a.client.rpc('change_task_status', { p_task_id: taskB.id, p_new_status: 'in_progress' }),
    { codes: ['42501'], verify: unchanged(taskB.id, 'status', 'new') },
  )

  console.log('\n--- Status transitions ---')
  await expectDenied(
    "executor A change_task_status(new -> 'review')",
    () => a.client.rpc('change_task_status', { p_task_id: taskNew.id, p_new_status: 'review' }),
    { codes: ['CR001'], verify: unchanged(taskNew.id, 'status', 'new') },
  )
  await expectDenied(
    "executor A change_task_status(new -> 'accepted')",
    () => a.client.rpc('change_task_status', { p_task_id: taskNew.id, p_new_status: 'accepted' }),
    { codes: ['CR001'], verify: unchanged(taskNew.id, 'status', 'new') },
  )
  await expectDenied(
    "executor A change_task_status(review -> 'accepted')",
    () => a.client.rpc('change_task_status', { p_task_id: taskReview.id, p_new_status: 'accepted' }),
    { codes: ['42501'], verify: unchanged(taskReview.id, 'status', 'review') },
  )
  await expectDenied(
    "manager change_task_status(review -> 'rework', '') requires a comment",
    () =>
      m1.client.rpc('change_task_status', {
        p_task_id: taskReview.id,
        p_new_status: 'rework',
        p_comment: '',
      }),
    { codes: ['CR002'], verify: unchanged(taskReview.id, 'status', 'review') },
  )
  await expectDenied(
    "manager change_task_status(review -> 'rework', whitespace only)",
    () =>
      m1.client.rpc('change_task_status', {
        p_task_id: taskReview.id,
        p_new_status: 'rework',
        p_comment: '   ',
      }),
    { codes: ['CR002'], verify: unchanged(taskReview.id, 'status', 'review') },
  )
  await expectDenied(
    'executor A direct UPDATE of tasks.status on own task',
    () => a.client.from('tasks').update({ status: 'in_progress' }).eq('id', taskNew.id).select(),
    { verify: unchanged(taskNew.id, 'status', 'new') },
  )

  console.log('\n--- task_status_history is immutable ---')
  const historyBefore = await historyCount(taskNew.id)
  const historyIntact = async () =>
    (await historyCount(taskNew.id)) === historyBefore ? null : 'history row count changed'
  const historyRow = {
    task_id: taskNew.id,
    from_status: 'new' as const,
    to_status: 'accepted' as const,
    comment: 'forged',
  }
  for (const [label, who] of [
    ['executor A', a],
    ['manager', m1],
  ] as const) {
    await expectDenied(
      `${label} INSERT into task_status_history`,
      () => who.client.from('task_status_history').insert({ ...historyRow, changed_by: who.id }).select(),
      { verify: historyIntact },
    )
    await expectDenied(
      `${label} UPDATE of task_status_history`,
      () =>
        who.client
          .from('task_status_history')
          .update({ comment: 'tampered' })
          .eq('task_id', taskNew.id)
          .select(),
      { verify: historyIntact },
    )
    await expectDenied(
      `${label} DELETE from task_status_history`,
      () => who.client.from('task_status_history').delete().eq('task_id', taskNew.id).select(),
      { verify: historyIntact },
    )
  }

  console.log('\n--- Privilege escalation and direct deletes ---')
  await expectDenied(
    "executor A UPDATE own profile role to 'manager'",
    () => a.client.from('profiles').update({ role: 'manager' }).eq('id', a.id).select(),
    {
      verify: async () => {
        const { data } = await a.client.rpc('app_role')
        return data === 'executor' ? null : `role is now ${String(data)}`
      },
    },
  )
  await expectDenied(
    'manager direct DELETE from tasks',
    () => m1.client.from('tasks').delete().eq('id', taskNew.id).select(),
    { verify: taskStillExists(taskNew.id) },
  )

  console.log('\n--- Accepted task is locked ---')
  await expectDenied(
    'manager UPDATE title of accepted task',
    () => m1.client.from('tasks').update({ title: `${prefix} renamed` }).eq('id', taskAccepted.id).select(),
    { codes: ['CR003'], verify: unchanged(taskAccepted.id, 'title', taskAccepted.title) },
  )
  await expectDenied(
    'manager delete_task on accepted task',
    () => m1.client.rpc('delete_task', { p_task_id: taskAccepted.id }),
    { codes: ['CR003'], verify: taskStillExists(taskAccepted.id) },
  )

  console.log('\n--- Assignee must be an executor ---')
  await expectDenied(
    'manager INSERT task with another manager as assignee',
    () =>
      m1.client
        .from('tasks')
        .insert({
          title: `${prefix} bad assignee`,
          object_id: objectA.id,
          assignee_id: m2.id,
          author_id: m1.id,
        })
        .select(),
    { codes: ['CR004'] },
  )
  await expectDenied(
    'manager UPDATE task assignee to another manager',
    () => m1.client.from('tasks').update({ assignee_id: m2.id }).eq('id', taskNew.id).select(),
    { codes: ['CR004'], verify: unchanged(taskNew.id, 'assignee_id', a.id) },
  )

  // === Extra checks =========================================================================
  console.log('\n--- Extra: executor visibility and writes ---')
  await expectDenied('executor A SELECT of B object by id', () =>
    a.client.from('objects').select().eq('id', objectB.id),
  )
  await expectDenied('executor A SELECT of B task history', () =>
    a.client.from('task_status_history').select().eq('task_id', taskB.id),
  )
  await expectDenied(
    'executor A INSERT task',
    () =>
      a.client
        .from('tasks')
        .insert({
          title: `${prefix} by executor`,
          object_id: objectA.id,
          assignee_id: a.id,
          author_id: a.id,
        })
        .select(),
    { codes: ['42501'] },
  )
  await expectDenied('executor A SELECT of executor B profile', () =>
    a.client.from('profiles').select().eq('id', b.id),
  )
  {
    // Whole-table read: A may only see own row and managers, never another executor.
    const { data, error } = await a.client.from('profiles').select('id, role')
    const leaked = (data ?? []).filter((p) => p.role === 'executor' && p.id !== a.id)
    record(
      'executor A profiles list holds no other executor',
      !error && leaked.length === 0,
      error ? error.message : `${data?.length ?? 0} visible profiles, ${leaked.length} foreign executors`,
    )
  }

  console.log('\n--- Extra: anonymous (not logged in) ---')
  for (const table of ['tasks', 'objects', 'profiles', 'task_status_history'] as const) {
    await expectDenied(`anon SELECT from ${table}`, () => anon.from(table).select())
  }
  await expectDenied(
    'anon change_task_status',
    () => anon.rpc('change_task_status', { p_task_id: taskNew.id, p_new_status: 'in_progress' }),
    { verify: unchanged(taskNew.id, 'status', 'new') },
  )
  await expectDenied('anon delete_task', () => anon.rpc('delete_task', { p_task_id: taskNew.id }), {
    verify: taskStillExists(taskNew.id),
  })

  // --- Cleanup: soft-delete everything that may be deleted ----------------------------------
  console.log('\n--- Cleanup ---')
  for (const task of [taskNew, taskB, taskReview]) {
    const { error } = await m1.client.rpc('delete_task', { p_task_id: task.id })
    record(
      `cleanup: soft-delete "${task.title}"`,
      !error,
      error ? error.message : 'deleted',
    )
  }
  console.log(
    `NOTE: task "${taskAccepted.title}" is in 'accepted' and cannot be deleted by design; ` +
      `it and the two "${prefix}" objects stay in the database.`,
  )
}

try {
  await main()
} catch (e) {
  console.error(`\nSETUP ERROR: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
}

const failed = results.filter((r) => !r.pass)
console.log(`\nSummary: ${results.length - failed.length} PASS, ${failed.length} FAIL, ${results.length} total`)
for (const f of failed) console.log(`  FAIL  ${f.name} -- ${f.reason}`)
if (failed.length > 0) process.exitCode = 1
else if (process.exitCode !== 1) console.log('ALL CHECKS PASSED')
