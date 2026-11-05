-- Helpers, task triggers and RPCs.
--
-- Security model for status changes
-- ---------------------------------
-- tasks.status can only change through change_task_status(). The RPC raises the
-- transaction-local flag `app.status_change = 'on'`, which the BEFORE UPDATE trigger
-- requires. The flag alone is NOT trusted, though: the trigger re-validates every
-- transition itself (matrix + role + assignee + mandatory rework comment, via
-- _check_status_transition) and writes the history row itself. So even a forged flag
-- cannot skip a check or produce a status change without a history row. In practice a
-- client cannot set it anyway: PostgREST exposes only the RPCs granted below and no
-- set_config(); and the flag is reset to 'off' by the RPC right after the UPDATE.
-- Same pattern for `app.task_delete` (soft delete), re-checked with is_manager().
--
-- All SECURITY DEFINER functions use `set search_path = ''` and qualified names.
-- Visibility leaks: RPCs answer with one generic error (42501) both for a missing task
-- and for a task the caller may not see.

-- ---------------------------------------------------------------------------
-- Helpers (used by RLS, so executable by authenticated)
-- ---------------------------------------------------------------------------
create function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role = 'manager' from public.profiles p where p.id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Internal validators (not callable by API roles)
-- ---------------------------------------------------------------------------
create function public._assert_assignee_is_executor(p_assignee uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_assignee is null then
    raise exception 'Assignee is required' using errcode = 'CR004';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_assignee and p.role = 'executor'
  ) then
    raise exception 'Assignee must be a user with the executor role' using errcode = 'CR004';
  end if;
end;
$$;

-- Status transition matrix (single source of truth):
--   new         -> in_progress  executor, assigned to the task
--   rework      -> in_progress  executor, assigned to the task
--   in_progress -> review       executor, assigned to the task
--   review      -> accepted     manager
--   review      -> rework       manager, comment required
create function public._check_status_transition(
  p_old public.task_status,
  p_new public.task_status,
  p_role public.user_role,
  p_is_assignee boolean,
  p_comment text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_required public.user_role;
begin
  v_required := case
    when p_old in ('new', 'rework') and p_new = 'in_progress' then 'executor'::public.user_role
    when p_old = 'in_progress' and p_new = 'review' then 'executor'::public.user_role
    when p_old = 'review' and p_new in ('accepted', 'rework') then 'manager'::public.user_role
    else null
  end;

  if v_required is null then
    raise exception 'Transition from % to % is not allowed', p_old, p_new using errcode = 'CR001';
  end if;

  if p_role is distinct from v_required then
    raise exception 'Your role is not allowed to move a task from % to %', p_old, p_new
      using errcode = '42501';
  end if;

  if v_required = 'executor' and not coalesce(p_is_assignee, false) then
    raise exception 'Only the assigned executor can move this task from % to %', p_old, p_new
      using errcode = '42501';
  end if;

  if p_new = 'rework' and nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception 'A comment is required when sending a task to rework' using errcode = 'CR002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers on tasks
-- ---------------------------------------------------------------------------
create function public.tasks_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_manager() then
    raise exception 'Only a manager can create tasks' using errcode = '42501';
  end if;

  perform public._assert_assignee_is_executor(new.assignee_id);

  -- Server-controlled fields: whatever the client sent is overwritten.
  new.status := 'new';
  new.author_id := v_uid;
  new.created_at := now();
  new.updated_at := now();
  new.deleted_at := null;
  new.deleted_by := null;
  return new;
end;
$$;

-- History row "null -> new". AFTER INSERT (not BEFORE) because the history FK needs the
-- task row to exist already.
create function public.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_status_history (task_id, from_status, to_status, changed_by, comment)
  values (new.id, null, new.status, new.author_id, null);
  return new;
end;
$$;

create function public.tasks_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_comment text;
begin
  if new.id is distinct from old.id then
    raise exception 'Task id cannot be changed' using errcode = '42501';
  end if;

  if old.status = 'accepted' then
    raise exception 'Task is accepted and cannot be modified' using errcode = 'CR003';
  end if;

  if new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'author_id and created_at cannot be changed' using errcode = '42501';
  end if;

  if new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by then
    if current_setting('app.task_delete', true) is distinct from 'on' or not public.is_manager() then
      raise exception 'Tasks can only be deleted via delete_task()' using errcode = '42501';
    end if;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    perform public._assert_assignee_is_executor(new.assignee_id);
  end if;

  if new.status is distinct from old.status then
    if current_setting('app.status_change', true) is distinct from 'on' then
      raise exception 'Task status can only be changed via change_task_status()'
        using errcode = '42501';
    end if;

    v_comment := nullif(btrim(coalesce(current_setting('app.status_comment', true), '')), '');

    -- Re-validate even when the flag is on (see header): the flag is not a trusted bypass.
    perform public._check_status_transition(
      old.status, new.status, public.app_role(), old.assignee_id = v_uid, v_comment
    );

    insert into public.task_status_history (task_id, from_status, to_status, changed_by, comment)
    values (old.id, old.status, new.status, v_uid, v_comment);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_before_insert before insert on public.tasks
  for each row execute function public.tasks_before_insert();
create trigger tasks_after_insert after insert on public.tasks
  for each row execute function public.tasks_after_insert();
create trigger tasks_before_update before update on public.tasks
  for each row execute function public.tasks_before_update();

-- ---------------------------------------------------------------------------
-- RPC: change_task_status
-- ---------------------------------------------------------------------------
create function public.change_task_status(
  p_task_id uuid,
  p_new_status public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_new_status is null then
    raise exception 'New status is required' using errcode = 'CR001';
  end if;

  -- Lock only rows the caller may see; invisible and missing tasks are indistinguishable.
  select t.* into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.deleted_at is null
    and (public.is_manager() or t.assignee_id = v_uid)
  for update;

  if not found then
    raise exception 'Task not found or access denied' using errcode = '42501';
  end if;

  if v_task.status = p_new_status then
    raise exception 'Task is already in status %', p_new_status using errcode = 'CR001';
  end if;

  perform set_config('app.status_change', 'on', true);
  perform set_config('app.status_comment', coalesce(p_comment, ''), true);

  update public.tasks set status = p_new_status where id = v_task.id
  returning * into v_task;

  perform set_config('app.status_change', 'off', true);
  perform set_config('app.status_comment', '', true);

  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: delete_task (soft delete, manager only)
-- ---------------------------------------------------------------------------
create function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not public.is_manager() then
    raise exception 'Only a manager can delete tasks' using errcode = '42501';
  end if;

  select t.id into v_id
  from public.tasks t
  where t.id = p_task_id and t.deleted_at is null
  for update;

  if not found then
    raise exception 'Task not found or access denied' using errcode = '42501';
  end if;

  perform set_config('app.task_delete', 'on', true);

  -- Rejected by tasks_before_update (CR003) when the task is accepted.
  update public.tasks set deleted_at = now(), deleted_by = v_uid where id = v_id;

  perform set_config('app.task_delete', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.app_role() from public, anon;
revoke execute on function public.is_manager() from public, anon;
revoke execute on function public._assert_assignee_is_executor(uuid) from public, anon, authenticated;
revoke execute on function public._check_status_transition(public.task_status, public.task_status, public.user_role, boolean, text) from public, anon, authenticated;
revoke execute on function public.tasks_before_insert() from public, anon, authenticated;
revoke execute on function public.tasks_after_insert() from public, anon, authenticated;
revoke execute on function public.tasks_before_update() from public, anon, authenticated;
revoke execute on function public.change_task_status(uuid, public.task_status, text) from public, anon;
revoke execute on function public.delete_task(uuid) from public, anon;

grant execute on function public.app_role() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
