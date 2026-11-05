-- Mini CRM schema: enums, tables, indexes, profile bootstrap trigger.
--
-- Decisions (recorded from the task's open questions):
--  1. profiles are created by a trigger on auth.users (AFTER INSERT, SECURITY DEFINER).
--     full_name comes from raw_user_meta_data->>'full_name' (trimmed, max 100 chars; fallback
--     'Пользователь'). The email is NEVER copied into profiles (profiles are readable by other users).
--     The role is ALWAYS 'executor': user-controlled metadata is never trusted for roles.
--     Managers are promoted manually by SQL (seed / stage 5).
--  2. A manager may change object_id, title, description and assignee while status <> 'accepted'.
--  3. Reassigning an executor keeps the current status (and is not logged in history).
--
-- Custom SQLSTATE codes used across the schema (the frontend can branch on them):
--   42501  insufficient privilege / task not found or not accessible (generic on purpose)
--   CR001  invalid status transition
--   CR002  comment is required (rework)
--   CR003  task is accepted (or otherwise locked) and cannot be modified
--   CR004  invalid assignee (NULL or not an executor)

create type public.user_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'review', 'accepted', 'rework');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'executor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0 and length(name) <= 200),
  address text check (length(address) <= 500),
  -- RESTRICT (not SET NULL): created_by is immutable, see objects_pin_created_by.
  created_by uuid default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: an object that has (or had, soft-deleted) tasks can never be deleted.
  object_id uuid not null references public.objects (id) on delete restrict,
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  description text check (length(description) <= 5000),
  status public.task_status not null default 'new',
  author_id uuid not null references public.profiles (id) on delete restrict,
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete restrict,
  constraint tasks_deleted_consistency check ((deleted_at is null) = (deleted_by is null))
);

create table public.task_status_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  from_status public.task_status,           -- NULL for the initial "null -> new" row
  to_status public.task_status not null,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  comment text check (length(comment) <= 2000),
  created_at timestamptz not null default now()
);

create index tasks_assignee_id_idx on public.tasks (assignee_id);
create index tasks_object_id_idx on public.tasks (object_id);
create index tasks_author_id_idx on public.tasks (author_id);
create index task_status_history_task_id_idx on public.task_status_history (task_id);
create index task_status_history_changed_by_idx on public.task_status_history (changed_by);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (profiles, objects). tasks has its own trigger.
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger objects_set_updated_at before update on public.objects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile bootstrap: every new auth user gets an 'executor' profile.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 100), ''), 'Пользователь'),
    'executor'  -- never read the role from metadata
  );
  return new;
end;
$$;

-- created_by is forced to auth.uid() on insert and immutable afterwards.
create function public.objects_pin_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger objects_pin_created_by before insert or update on public.objects
  for each row execute function public.objects_pin_created_by();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.objects_pin_created_by() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
