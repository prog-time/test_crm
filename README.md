# test_crm: мини-CRM «Объекты и задачи»

Небольшая CRM для строительной компании. Постановщик заводит объекты (стройки) и ставит по ним задачи, исполнители берут задачи в работу и отдают на проверку, постановщик принимает работу или возвращает на доработку. Каждая смена статуса попадает в историю. Права доступа, переходы статусов и неизменяемость истории проверяет сама база данных (RLS, триггеры, RPC), а не только интерфейс.

## Демо

- Приложение: https://<vercel-url>
- Доступы (1 постановщик, 2 исполнителя) передаются отдельно, в сообщении со сдачей. Паролей в репозитории нет.
- Демо-учётки:
  - `manager@test-crm.example`: постановщик (Иван Петров);
  - `executor1@test-crm.example`: исполнитель (Алексей Смирнов);
  - `executor2@test-crm.example`: исполнитель (Мария Козлова).
- В базе 3 объекта и 9 задач во всех пяти статусах, включая задачу, которая прошла цикл доработки (см. «Демо-данные»).

## Стек

- Фронтенд: Vite, React 19, TypeScript, Mantine 9, react-router 7, TanStack Query 5.
- Бэкенд: Supabase (Postgres 17, Auth, PostgREST). Отдельного сервера нет: вся логика доступа живёт в миграциях.
- Тесты: vitest + Testing Library (фронтенд), pgTAP (база), `scripts/security-check.ts` (проверка безопасности против живого Supabase).
- Хостинг: Vercel (фронтенд), облачный проект Supabase (база и авторизация).

## Быстрый старт локально

Нужны: Node 20 (`.nvmrc`; `engines`: `>=20.19`), Docker (для локального Supabase), клиент `psql`. Supabase CLI ставится как devDependency и вызывается через `npx supabase`.

```bash
nvm use                      # Node 20 из .nvmrc
npm ci                       # зависимости строго по package-lock.json
npx supabase start           # локальный стек; первый запуск скачивает образы
npx supabase db reset        # пересоздать базу и применить все миграции
# демо-пользователи (только локально, открытые dev-пароли) и демо-данные:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/local/demo-users.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed.sql
cp .env.example .env         # заполнить VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm run dev
```

Значения для `.env` локального стека: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY` = `ANON_KEY` из `npx supabase status -o env`. Без этих двух переменных приложение не стартует и сообщает об этом.

Локальные пароли демо-учёток лежат в `supabase/local/demo-users.sql`. Это публичные dev-значения, к облачному демо они не подходят.

Прочие команды Supabase CLI:

```bash
npx supabase test db         # pgTAP-тесты (supabase/tests/*.sql)
npx supabase gen types typescript --local > src/types/database.ts   # перегенерировать типы
npx supabase stop            # остановить стек
```

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm run dev` | dev-сервер Vite |
| `npm run build` | проверка типов (`tsc -b`) + production-сборка в `dist/` |
| `npm run preview` | локальный просмотр собранного `dist/` |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc -b --noEmit` (приложение, `vite.config.ts`, `scripts/`) |
| `npm run test` | vitest (`vitest run`), Supabase не нужен |
| `npm run security-check` | доказывает, что база отклоняет запрещённые действия (см. «Проверка безопасности») |

## База данных и модель безопасности

Схема, RLS, триггеры и RPC лежат в `supabase/migrations/` (3 файла: схема, функции и триггеры, RLS и права). pgTAP-тесты лежат в `supabase/tests/`.

**Ключ `service_role` (и `sb_secret_...`) в проекте не используется нигде:** ни в коде фронтенда, ни в `.env`, ни в деплое, ни в seed, ни в `security-check`. Фронтенд и скрипт проверки работают только с `anon` ключом, права проверяет база.

Основные правила:

- **Регистрации нет.** `[auth] enable_signup = false`, в облаке выключено в Dashboard. Пользователей создаёт администратор.
- **Профили.** Триггер на `auth.users` создаёт каждому новому пользователю профиль с ролью `executor`. Роль из метаданных не читается, email в `profiles` не копируется. Постановщиков повышают SQL-запросом.
- **Видимость.** Постановщик видит все объекты и все неудалённые задачи. Исполнитель видит только свои задачи и только объекты, где у него есть неудалённая задача. История видна, если видна сама задача. Профили: свой видят все, постановщики видят всех, исполнитель дополнительно видит постановщиков (авторов задач), но не других исполнителей. Анонимный клиент не получает ничего.
- **Статусы** меняются только через `change_task_status(p_task_id, p_new_status, p_comment)`. Прямой `UPDATE status` отклоняется. Матрица переходов (`_check_status_transition`):
  - `new -> in_progress`, `rework -> in_progress`, `in_progress -> review`: назначенный исполнитель;
  - `review -> accepted`: любой постановщик;
  - `review -> rework`: любой постановщик, комментарий обязателен (пустой или из пробелов отклоняется).
- **История** (`task_status_history`) пишется только триггером, на каждую смену статуса плюс строка `null -> new` при создании. Прав на запись в неё у API-ролей нет: ни INSERT, ни UPDATE, ни DELETE.
- **Задачи** создаёт только постановщик. `status`, `author_id`, `created_at` выставляет сервер. Исполнитель обязателен и должен иметь роль `executor`. Пока задача не `accepted`, постановщик может менять название, описание, объект и исполнителя; после `accepted` задача только для чтения. Удаление мягкое, только через `delete_task(p_task_id)`; прав на прямой `DELETE` из `tasks` нет.
- **Объекты** создаёт, меняет и удаляет постановщик. Объект, у которого есть (или была, в том числе удалённая) задача, удалить нельзя (FK `ON DELETE RESTRICT`).
- Вспомогательные функции: `app_role()` (роль вызывающего) и `is_manager()`.

Коды ошибок (фронтенд переводит их на русский в `src/lib/errors.ts`):

| Код | Значение |
| --- | --- |
| `42501` | нет прав / задача не найдена (намеренно одинаково, чтобы не раскрывать существование чужих задач) |
| `CR001` | недопустимый переход статуса |
| `CR002` | для `rework` нужен комментарий |
| `CR003` | задача `accepted`, менять и удалять нельзя |
| `CR004` | недопустимый исполнитель (не указан или не `executor`) |
| `23514` | нарушено ограничение длины или пустое значение (check constraint) |
| `23503` | у объекта есть задачи, удалить нельзя (внешний ключ) |
| `22P02` | некорректный идентификатор в URL (показывается как «не найдено») |

### Seed и подмена пользователя

Seed выполняется под `postgres` без JWT, а база намеренно запрещает создавать задачи и менять статусы, когда `auth.uid()` пуст. Поэтому seed подменяет пользователя и идёт обычными путями API, и триггеры и история остаются согласованными:

```sql
-- пользователи создаются в auth.users (профили появляются триггером), затем повышается постановщик:
update public.profiles set role = 'manager' where id = '<manager-uuid>';

select set_config('request.jwt.claims', '{"sub":"<manager-uuid>","role":"authenticated"}', true);
insert into public.objects (name) values ('Object 1');                 -- created_by = manager
insert into public.tasks (object_id, title, assignee_id) values (...); -- история: null -> new

select set_config('request.jwt.claims', '{"sub":"<executor-uuid>","role":"authenticated"}', true);
select public.change_task_status('<task-uuid>', 'in_progress', null);
```

Ослаблять проверки `auth.uid()` ради seed нельзя. pgTAP-тесты проверяют только строки, которые создали сами, поэтому демо-данные им не мешают.

### Демо-данные (seed)

`supabase/seed.sql` создаёт 3 объекта и 9 задач во всех статусах (`new`, `in_progress`, `review`, `accepted`, `rework`), включая задачу, прошедшую цикл доработки. Данные создаются от имени нужных пользователей (подмена `request.jwt.claims`, обычные `INSERT` и `change_task_status`), так что историю пишут настоящие триггеры. Пользователей и паролей в файле нет.

Демо-пользователи ищутся в `auth.users` **по email** (`manager@`, `executor1@`, `executor2@test-crm.example`). Если хотя бы одного нет, скрипт пишет `NOTICE` и ничего не вставляет. Если демо-объекты уже есть (по названию), он тоже ничего не делает. Повторный запуск безопасен, а `supabase db reset` на пустой базе (seed подключён в `[db.seed]`) ничего не меняет. Всё выполняется одной транзакцией.

`supabase/local/demo-users.sql` не входит в `[db.seed] sql_paths` (там только `./seed.sql`), поэтому `supabase db push --include-seed` никогда не отправит локальных пользователей в облако.

### Экраны и роли в интерфейсе

Вход по email и паролю. Регистрации в интерфейсе нет. Неавторизованного пользователя любой защищённый маршрут перенаправляет на `/login`. После входа открывается стартовый экран роли: исполнитель попадает на `/my-tasks`, постановщик на `/objects`.

| Маршрут | Экран | Постановщик | Исполнитель |
| --- | --- | --- | --- |
| `/login` | Вход | да | да |
| `/objects` | Список объектов | все объекты, создание / правка / удаление | только объекты со своими задачами, без кнопок управления |
| `/objects/:id` | Карточка объекта | все задачи объекта, форма создания задачи (название, описание, исполнитель) | только свои задачи |
| `/tasks/:id` | Карточка задачи | правка (название, описание, объект, исполнитель) и удаление, пока задача не `accepted`; из `review`: принять / на доработку (комментарий обязателен) | взять в работу (`new`, `rework`), отправить на проверку (`in_progress`) |
| `/my-tasks` | Мои задачи с фильтром по статусу | недоступно (редирект на `/objects`) | да |

Кнопки в карточке задачи определяет одна функция `getAvailableActions(role, status, isAssignee)` в `src/lib/taskActions.ts`. Она повторяет матрицу переходов БД, но сама ничего не защищает: права проверяет база. Ошибки PostgREST/RPC переводятся на русский в `src/lib/errors.ts` и показываются уведомлениями. Общего списка всех задач у постановщика нет, эту роль выполняют карточки объектов.

## Проверка безопасности

`npm run security-check` (`scripts/security-check.ts`) заходит в Supabase **только с anon key** под реальными учётками (email + пароль) и проверяет, что база сама отклоняет запрещённые действия в обход интерфейса. `service_role` не используется и не должен появляться в коде или `.env`.

Всего 35 проверок: 32 попытки нарушить правила (все должны быть отклонены) и 3 шага уборки (мягкое удаление тестовых задач, которое разрешено). Каждая строка печатает `PASS` или `FAIL` с причиной (код ошибки или `0 rows`) и там, где это применимо, перепроверяет, что состояние не изменилось. В конце выводится `Summary: N PASS, M FAIL, 35 total`. Код выхода `0`, если всё прошло; при любом `FAIL` или ошибке подготовки (не удалось войти, неверная роль учётки) код ненулевой.

Скрипт предназначен для **локального стека или отдельных учёток проверки**, не для боевых данных. Он сам создаёт данные с префиксом `[security-check] <время запуска>` и в конце мягко удаляет то, что разрешено. Задачи в `accepted` база блокирует намеренно, поэтому **после каждого прогона остаются** одна задача `accepted` и два объекта с этим префиксом.

### Учётки проверки

Нужны 4 разных пользователя: два постановщика (второй нужен для проверки «исполнитель = другой постановщик») и два исполнителя. Для локального стека их создаёт `supabase/local/check-users.sql`. Файл лежит вне `supabase/migrations` и не является seed, поэтому `db reset` и деплой его не трогают. Скрипт идемпотентен: пишет в `auth.users` и `auth.identities`, затем повышает двоих до `manager`.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/local/check-users.sql
```

Локальные учётки (открытые dev-значения, только для локального стека): `check-manager@example.test` / `check-manager-pass`, `check-manager2@example.test` / `check-manager2-pass`, `check-executor-a@example.test` / `check-executor-a-pass`, `check-executor-b@example.test` / `check-executor-b-pass`.

### Запуск

Заполните в `.env` (все ключи есть в `.env.example`). `CHECK_SUPABASE_URL` и `CHECK_SUPABASE_ANON_KEY` по умолчанию берутся из `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

```
CHECK_MANAGER_EMAIL / CHECK_MANAGER_PASSWORD
CHECK_MANAGER2_EMAIL / CHECK_MANAGER2_PASSWORD
CHECK_EXECUTOR_A_EMAIL / CHECK_EXECUTOR_A_PASSWORD
CHECK_EXECUTOR_B_EMAIL / CHECK_EXECUTOR_B_PASSWORD
```

```bash
npm run security-check
```

### Что проверяется

- Исполнитель A не видит и не меняет задачу исполнителя B: SELECT и UPDATE дают 0 строк, RPC даёт `42501`. Её объект и историю он тоже не видит.
- Недопустимые переходы статуса: `new -> review`, `new -> accepted` (`CR001`); `review -> accepted` исполнителем (`42501`); `rework` с пустым комментарием или из одних пробелов (`CR002`). Прямой UPDATE `status` отклоняется.
- `task_status_history`: INSERT, UPDATE и DELETE отклоняются и для исполнителя, и для постановщика.
- Исполнитель не может сделать себя `manager` в `profiles`; постановщик не может сделать прямой DELETE из `tasks`.
- Задача в `accepted`: смена названия и `delete_task` отклоняются (`CR003`).
- Другой постановщик в роли исполнителя: INSERT и UPDATE с его `assignee_id` отклоняются (`CR004`).
- Дополнительно: исполнитель не создаёт задачи (`42501`) и не видит профили других исполнителей; анонимный клиент ничего не получает из `tasks`, `objects`, `profiles`, `task_status_history` и не может вызвать RPC.

Запуск в CI не предусмотрен: нужен живой проект Supabase и секреты учёток.

## Тесты

```bash
npm run test           # vitest: 41 тест в 5 файлах, Supabase не нужен
npx supabase test db   # pgTAP: 133 проверки в 3 файлах, нужен локальный стек
npm run security-check # 35 проверок против живого Supabase (см. выше)
```

- **vitest** (`src/**/*.test.ts(x)`): матрица `getAvailableActions`, тексты ошибок, модалка доработки, защита маршрутов по ролям, форма редактирования задачи. Клиент Supabase в компонентных тестах подменён моком.
- **pgTAP** (`supabase/tests/`): схема и RLS (`01_schema_rls`), переходы статусов и RPC (`02_status_rpc`), усиление прав и триггеров (`03_hardening`). Каждый файл выполняется в транзакции с `rollback`.
- **CI** (`.github/workflows/ci.yml`): на каждый push и PR запускаются отдельные job'ы `lint`, `typecheck`, `build`, `test`. pgTAP и `security-check` в CI не запускаются.

## Деплой

База и авторизация живут в облачном проекте Supabase, фронтенд деплоится в Vercel через Git-интеграцию (production-ветка `main`). GitHub Actions для деплоя не используется.

### 1. Supabase

1. Создайте проект на [supabase.com](https://supabase.com) (Dashboard -> New project) и запомните Project ref (`Project Settings -> General`).
2. Примените миграции:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   `--include-seed` не используйте: демо-данные заливаются отдельно (шаг 5).
3. Настройки авторизации (`Authentication`):
   - `Sign In / Providers -> Allow new users to sign up` = **выключить** (регистрации нет, пользователей создаёт администратор);
   - `Sign In / Providers -> Email -> Confirm email` = **выключить** (или создавать пользователей с Auto Confirm, см. следующий шаг).
4. Создайте 3 демо-пользователя: `Authentication -> Users -> Add user -> Create new user`, с включённым **Auto Confirm User**. Email должны быть ровно такими (по ним seed находит пользователей). Пароли придумайте сами и в репозитории не храните:
   - `manager@test-crm.example`
   - `executor1@test-crm.example`
   - `executor2@test-crm.example`
5. Откройте `SQL Editor`, вставьте содержимое `supabase/seed.sql` и выполните (роль `postgres`). Ожидаемый результат: `NOTICE: seed done: 3 objects, 9 tasks`. Повторный запуск ничего не дублирует.

### 2. Vercel

1. `Add New -> Project`, импортируйте репозиторий. Framework Preset: **Vite**, Build Command `npm run build`, Output Directory `dist`. Это же задано в `vercel.json`, вместе с SPA-rewrite всех путей на `/index.html`. Node.js 20+ (`.nvmrc` и `engines` в `package.json`).
2. `Settings -> Environment Variables`: **только** две переменные (Production):
   - `VITE_SUPABASE_URL` из `Project Settings -> API -> Project URL`;
   - `VITE_SUPABASE_ANON_KEY` оттуда же, ключ `anon` / publishable.
3. `Settings -> Git -> Production Branch` = `main`.
4. Отключите preview-деплои других веток: `Settings -> Git -> Ignored Build Step -> Custom`, команда
   ```bash
   [ "$VERCEL_GIT_COMMIT_REF" != "main" ] && exit 0 || exit 1
   ```
   (код `0` пропускает сборку, `1` запускает), либо соответствующий переключатель в настройках Git.
5. Выполните деплой из `main` и скопируйте итоговый URL.

### 3. Supabase: URL приложения

`Authentication -> URL Configuration`: **Site URL** = итоговый URL проекта на Vercel (тот же, что в разделе «Демо»). При необходимости добавьте его же в Redirect URLs.

### Важно

- Ключ `service_role` (и `sb_secret_...`) **не нужен** ни приложению, ни деплою, ни seed. Класть его в Vercel или в код нельзя. Фронтенд работает только с `anon` ключом, права проверяет RLS.
- Демо-пароли в репозитории и README не хранятся, доступ передаётся ревьюерам отдельно.

## Документация

- [`docs/explanation.md`](docs/explanation.md): как устроена система и как защищены данные, простыми словами для руководителя.
- [`docs/decisions.md`](docs/decisions.md): решения по неоднозначностям ТЗ, допущения и что не сделано.
