-- RLS policies and table privileges.
--
-- Defense in depth: table grants are minimal AND RLS is enabled on every table.
-- anon gets nothing. profiles / task_status_history have no write policies and no write
-- grants; tasks has no DELETE grant (soft delete via delete_task()).

-- Reset Supabase default privileges, then grant back only what is needed.
-- Function EXECUTE is granted to PUBLIC by default; the schema-less form removes that default
-- for every future function created by postgres in any schema.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.objects to authenticated;
grant select, insert, update on public.tasks to authenticated;   -- no DELETE
grant select on public.task_status_history to authenticated;

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;

-- profiles: own row; managers see everyone; executors additionally see managers (task
-- authors / history changed_by are always managers) but cannot enumerate other executors.
-- No write policies at all.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or role = 'manager'
    or (select public.is_manager())
  );

-- objects: manager full access; executor sees only objects with one of their live tasks.
create policy objects_select on public.objects
  for select to authenticated
  using (
    (select public.is_manager())
    or exists (
      select 1 from public.tasks t
      where t.object_id = objects.id
        and t.assignee_id = (select auth.uid())
        and t.deleted_at is null
    )
  );
create policy objects_insert on public.objects
  for insert to authenticated with check ((select public.is_manager()));
create policy objects_update on public.objects
  for update to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
-- FK tasks.object_id ON DELETE RESTRICT blocks deleting objects that have any task.
create policy objects_delete on public.objects
  for delete to authenticated using ((select public.is_manager()));

-- tasks: manager sees/edits all live tasks; executor reads only own live tasks, never writes.
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and ((select public.is_manager()) or assignee_id = (select auth.uid()))
  );
create policy tasks_insert on public.tasks
  for insert to authenticated with check ((select public.is_manager()));
create policy tasks_update on public.tasks
  for update to authenticated
  using (deleted_at is null and (select public.is_manager()))
  with check ((select public.is_manager()));

-- task_status_history: visible iff the task is visible (the subquery is itself subject to
-- tasks RLS for the caller). No write policies.
create policy history_select on public.task_status_history
  for select to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_status_history.task_id)
  );
