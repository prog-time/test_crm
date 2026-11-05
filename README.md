# test_crm

Mini CRM frontend: Vite + React + TypeScript, Mantine, react-router, TanStack Query, Supabase.

## Quick start

Requires Node 20 (`nvm use`).

```bash
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Scripts

- `npm run dev` - dev server
- `npm run build` - typecheck + production build
- `npm run lint` - eslint
- `npm run typecheck` - `tsc --noEmit`

Supabase CLI is a devDependency: `npx supabase <command>`. Migrations live in `supabase/migrations/`.

## Database

Schema, RLS, triggers and RPCs live in `supabase/migrations/`; pgTAP tests in `supabase/tests/`. Requires Docker.

```bash
npx supabase start          # start the local stack (first run pulls images)
npx supabase db reset       # recreate the DB and apply all migrations
npx supabase test db        # run pgTAP tests (supabase/tests/*.sql)
npx supabase gen types typescript --local > src/types/database.ts   # regenerate types
npx supabase stop           # stop the stack
```

Access rules (RLS), the status transition matrix and history immutability are enforced in the database. Public sign-up is disabled (`[auth] enable_signup = false`); users are created by an admin. Every new `auth.users` row gets an `executor` profile (never trusting metadata for the role, never copying the email); managers are promoted by SQL.

- Status changes go only through `change_task_status(p_task_id, p_new_status, p_comment)`, soft deletes through `delete_task(p_task_id)`.
- Helpers: `app_role()` (caller's role) and `is_manager()`.
- Profiles: a user sees their own row; managers see all; executors also see managers (task authors).
- Error codes: `42501` access denied / task not found (deliberately generic), `CR001` invalid transition, `CR002` comment required, `CR003` task accepted (locked), `CR004` invalid assignee. Length limits violate check constraints (`23514`).

### Seeding

Seeds run as `postgres` without a JWT, and the DB deliberately rejects task creation/status changes when `auth.uid()` is NULL. The supported approach is to impersonate users inside the seed and use the normal API paths, so triggers and history stay consistent:

```sql
-- create users in auth.users (profile rows appear via trigger), then promote the manager:
update public.profiles set role = 'manager' where id = '<manager-uuid>';

select set_config('request.jwt.claims', '{"sub":"<manager-uuid>","role":"authenticated"}', true);
insert into public.objects (name) values ('Object 1');                 -- created_by = manager
insert into public.tasks (object_id, title, assignee_id) values (...); -- history: null -> new

select set_config('request.jwt.claims', '{"sub":"<executor-uuid>","role":"authenticated"}', true);
select public.change_task_status('<task-uuid>', 'in_progress', null);
```

Do not relax the `auth.uid()` checks for seeding. Tests assert only on rows they create, so a future `seed.sql` does not break them.
