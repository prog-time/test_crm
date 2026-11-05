# TASK-20261105-db-schema-rls-migrations: Написать миграции БД с RLS, триггерами и RPC

**Type:** feature  
**Size:** L  
**Status:** todo
**GitHub Issue:** #3 — https://github.com/prog-time/test_crm/issues/3

## Что делаем
Создаём в Supabase схему мини-CRM: профили с ролями, объекты, задачи и историю статусов. Все правила доступа, матрицу переходов статусов и неизменяемость истории закрываем на уровне базы (RLS, SECURITY DEFINER функции, триггеры), чтобы прямой запрос с anon key мимо UI не мог их обойти. Это центральная часть ТЗ (раздел 3).

## Пользователь получает
Как **постановщик**, я могу **быть уверен, что исполнитель не прочитает чужие задачи, не перескочит статус и не подделает историю даже через прямой запрос к API**, чтобы **данные клиентов были защищены**.

## Готово когда
- [ ] Given пустой проект Supabase, when выполняется `supabase db push`, then все миграции применяются без ошибок, создаются enum'ы `user_role` (manager|executor) и `task_status` (new|in_progress|review|accepted|rework) и таблицы `profiles`, `objects`, `tasks`, `task_status_history`
- [ ] Given авторизованный пользователь, when он пытается сделать INSERT/UPDATE в `profiles` (в том числе сменить себе `role`), then операция отклоняется; SELECT профилей доступен всем authenticated
- [ ] Given исполнитель, when он читает `tasks` / `objects`, then видит только задачи с `assignee_id = auth.uid()` и `deleted_at is null` и только объекты, где у него есть такая задача
- [ ] Given задача в статусе `new`, when исполнитель, которому она не назначена, или постановщик вызывает `change_task_status(id, 'in_progress', null)`, then RPC отклоняет переход; when это делает назначенный исполнитель, then статус меняется и в историю пишется строка `new → in_progress`
- [ ] Given задача в статусе `review`, when постановщик вызывает `change_task_status(id, 'rework', null)` или с пустым комментарием, then вызов отклоняется (комментарий обязателен); переходы вне матрицы (например `new → accepted`) отклоняются для всех
- [ ] Given любой пользователь, when он делает INSERT/UPDATE/DELETE в `task_status_history` через API, then операция запрещена; SELECT истории разрешён, только если видна сама задача
- [ ] Given постановщик создаёт задачу, when INSERT в `tasks` передаёт `status='accepted'` или чужой `author_id`, then триггер принудительно ставит `status='new'`, `author_id=auth.uid()`, `created_at=now()` и пишет в историю `null → new`
- [ ] Given прямой UPDATE `tasks` с изменением `status` / `author_id` / `created_at` мимо RPC, when запрос выполняется, then триггер отклоняет его
- [ ] Given задача в статусе `accepted`, when кто угодно пытается её изменить (в том числе через `delete_task`), then операция отклоняется
- [ ] Given назначение исполнителя, when в `assignee_id` передан пользователь с ролью `manager` или NULL, then INSERT/UPDATE отклоняется
- [ ] Given постановщик, when он делает прямой DELETE из `tasks`, then операция запрещена; when он вызывает `delete_task(id)`, then ставятся `deleted_at` / `deleted_by`, история сохраняется, задача пропадает из выборок
- [ ] Given объект, у которого есть хотя бы одна задача (в том числе удалённая), when постановщик удаляет объект, then удаление отклоняется (FK `ON DELETE RESTRICT`)
- [ ] Given роль `anon`, when она обращается к любой таблице или функции, then доступа нет (REVOKE)

## Как делаем
- Миграция схемы: enum'ы, таблицы, FK (`tasks.object_id` с `ON DELETE RESTRICT`, `assignee_id NOT NULL`), индексы по `tasks(assignee_id)`, `tasks(object_id)`, `task_status_history(task_id)`.
- Хелперы `is_manager()` и `current_role()`: `SECURITY DEFINER STABLE`, `SET search_path = ''`, обращения к таблицам с указанием схемы.
- RLS на всех таблицах. `profiles`: SELECT для authenticated, без политик на запись. `objects`: CRUD для manager, SELECT для executor через `EXISTS` по его неудалённым задачам. `tasks`: manager видит все неудалённые и может их вставлять/обновлять, executor видит только свои. `task_status_history`: SELECT через видимость задачи, без политик на запись.
- RPC `change_task_status(task_id, new_status, comment)`, `SECURITY DEFINER`: `SELECT ... FOR UPDATE`, проверка матрицы и роли/назначения, обязательный комментарий для `rework`, `set_config('app.status_change', 'on', true)`, UPDATE статуса и INSERT в историю в одной транзакции.
- Триггеры на `tasks`. BEFORE INSERT: принудительно выставляет поля и пишет историю. BEFORE UPDATE: без флага RPC запрещает менять `status` / `author_id` / `created_at`, отклоняет любые изменения при `OLD.status='accepted'`, проверяет роль `executor` у `assignee_id`, обновляет `updated_at`.
- RPC `delete_task(id)` для manager. REVOKE DELETE на `tasks` и REVOKE всего у `anon`; GRANT EXECUTE на RPC только `authenticated`. После миграций генерируем типы: `supabase gen types typescript > src/types/database.ts`.

## Файлы
- `supabase/migrations/<timestamp>_*.sql` — схема, enum'ы, хелперы, RLS, триггеры, RPC, гранты (новые файлы; разбиение на файлы на усмотрение исполнителя)
- `src/types/database.ts` — сгенерированные типы БД (новый файл)

## Не делаем в этой задаче
- Создание пользователей и сиды (этап 5)
- Автоматическую проверку отказов (этап 3, `scripts/security-check.ts`)
- Логирование переназначения исполнителя в истории (фиксируется как допущение в `docs/decisions.md`)
- Отключение регистрации в Supabase Auth (этап 5)

## Вопросы
- ❓ Создаём `profiles` триггером на `auth.users` или вручную в сидах? (в плане роли выдаются вручную, этап 5)
- ❓ Может ли постановщик менять `object_id` задачи после создания или только название, описание и исполнителя?
- ❓ Если исполнителя переназначили, сохраняется ли текущий статус (например `in_progress`) или задача сбрасывается в `new`? (сейчас статус сохраняется)

## Связанные задачи
- Родительская: `TASK-20261105-mini-crm-implementation`
- Зависит от: `TASK-20261105-scaffold-vite-react-app` (`supabase/config.toml`, Supabase CLI)
- Блокирует: `TASK-20261105-security-check-script`, `TASK-20261105-frontend-screens-auth`, `TASK-20261105-seed-data-deploy`

## Критерии приёмки (Definition of Done)
- [ ] Критерии из "Готово когда" выполнены и покрыты автотестами
- [ ] `eslint` и статический анализ (`tsc`) зелёные
- [ ] Юнит- и интеграционные тесты зелёные локально
- [ ] Документация (README / rules/ / API docs) обновлена, если изменилось поведение
- [ ] Code review пройден
- [ ] Нет регрессий в смежных сценариях
