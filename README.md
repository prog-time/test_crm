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
- `npm run typecheck` - `tsc --noEmit` (app, `vite.config.ts` and `scripts/`)
- `npm run security-check` - proves the database rejects forbidden actions (see "Проверка безопасности")

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

## Проверка безопасности

`npm run security-check` (`scripts/security-check.ts`) заходит в Supabase **только с anon key** под реальными учётками (email + пароль) и проверяет, что база сама отклоняет запрещённые действия в обход интерфейса. `service_role` не используется и не должен появляться в коде или `.env`.

Скрипт предназначен для **локального стека или отдельных учёток проверки**, не для боевых данных: он сам создаёт данные с префиксом `[security-check] <время запуска>`, в конце мягко удаляет (`delete_task`), что разрешено. Задачи в статусе `accepted` заблокированы базой намеренно, поэтому **после каждого прогона остаются** одна задача `accepted` и два объекта с этим префиксом.

### Локальные учётки

Нужны 4 пользователя: два постановщика (второй нужен для проверки «исполнитель = другой постановщик») и два исполнителя. Для локального стека их создаёт `supabase/local/check-users.sql` (только локально: пароли в файле открытые dev-значения; файл лежит вне `supabase/migrations` и не является `seed.sql`, поэтому `db reset` и деплой его не трогают). Скрипт идемпотентен: пишет в `auth.users` и `auth.identities`, затем повышает двух до `manager`.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/local/check-users.sql
```

Пользователи: `check-manager@example.test` / `check-manager-pass`, `check-manager2@example.test` / `check-manager2-pass`, `check-executor-a@example.test` / `check-executor-a-pass`, `check-executor-b@example.test` / `check-executor-b-pass`.

### Запуск

Заполните в `.env` (ключи есть в `.env.example`; `CHECK_SUPABASE_URL` и `CHECK_SUPABASE_ANON_KEY` по умолчанию берутся из `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; anon key локального стека: `npx supabase status -o env`):

```
CHECK_MANAGER_EMAIL / CHECK_MANAGER_PASSWORD
CHECK_MANAGER2_EMAIL / CHECK_MANAGER2_PASSWORD
CHECK_EXECUTOR_A_EMAIL / CHECK_EXECUTOR_A_PASSWORD
CHECK_EXECUTOR_B_EMAIL / CHECK_EXECUTOR_B_PASSWORD
```

```bash
npm run security-check
```

Каждая проверка печатает `PASS` или `FAIL` с причиной (код ошибки или `0 rows`) и, где это применимо, перепроверяет, что состояние не изменилось. Код выхода `0`, если все проверки прошли; при любом `FAIL` или ошибке подготовки (не вошли, неверная роль учётки) код ненулевой.

### Что проверяется

- Исполнитель A не видит и не меняет задачу исполнителя B (SELECT и UPDATE дают 0 строк, RPC даёт `42501`), не видит её объект и историю.
- Недопустимые переходы статуса: `new -> review`, `new -> accepted` (`CR001`), `review -> accepted` исполнителем (`42501`), `rework` без комментария или с пробелами (`CR002`); прямой UPDATE `status` отклоняется.
- `task_status_history`: INSERT, UPDATE и DELETE отклонены для исполнителя и постановщика.
- Исполнитель не может сделать себя `manager` в `profiles`; постановщик не может сделать прямой DELETE из `tasks`.
- Задача в `accepted`: смена названия и `delete_task` отклоняются (`CR003`).
- Исполнитель на задаче другого постановщика: INSERT и UPDATE с `assignee_id` другого постановщика отклоняются (`CR004`).
- Дополнительно: исполнитель не создаёт задачи, не видит профили других исполнителей; анонимный клиент ничего не получает из `tasks`, `objects`, `profiles`, `task_status_history` и не вызывает RPC.

Запуск в CI не предусмотрен (нужен живой проект Supabase и секреты).
