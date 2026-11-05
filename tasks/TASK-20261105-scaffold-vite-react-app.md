# TASK-20261105-scaffold-vite-react-app: Создать каркас проекта

**Type:** feature  
**Size:** S  
**Status:** todo
**GitHub Issue:** #2 — https://github.com/prog-time/test_crm/issues/2

## Что делаем
Репозиторий пустой. Создаём каркас фронтенда (Vite + React + TypeScript) с Mantine, react-router, TanStack Query и клиентом Supabase, инициализируем Supabase CLI, настраиваем eslint и CI-проверку линтера. На этом каркасе строятся все остальные этапы.

## Пользователь получает
Как **разработчик**, я могу **склонировать репозиторий, заполнить `.env` по `.env.example` и запустить приложение одной командой**, чтобы **сразу начать работу над схемой БД и экранами**.

## Готово когда
- [ ] Given склонированный репозиторий и `.env`, заполненный по `.env.example`, when разработчик запускает `npm install && npm run dev`, then открывается стартовая страница в Mantine-оформлении с работающим роутером
- [ ] Given `src/lib/supabase.ts`, when модуль импортируется, then клиент создаётся только из `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, а при их отсутствии падает с понятной ошибкой
- [ ] Given файл `.env` с ключами, when выполняется `git status`, then `.env` не попадает в индекс (он в `.gitignore`), а `.env.example` закоммичен без реальных значений
- [ ] Given push или PR в `develop`, when срабатывает `.github/workflows/ci.yml`, then job с `eslint` (и `tsc --noEmit`) проходит зелёным
- [ ] Given выполнен `supabase init`, when разработчик смотрит в репозиторий, then есть `supabase/config.toml` и пустая папка `supabase/migrations/`

## Как делаем
- `npm create vite@latest` с шаблоном `react-ts`, затем добавляем `@mantine/core`, `@mantine/hooks`, `react-router-dom`, `@tanstack/react-query`, `@supabase/supabase-js`.
- В `src/main.tsx` подключаем `MantineProvider`, `QueryClientProvider` и роутер; в `src/lib/supabase.ts` создаём типизированный клиент (тип `Database` появится в этапе 2).
- `supabase init` создаёт `supabase/config.toml`, Supabase CLI ставится как devDependency.
- eslint flat config (из шаблона Vite) плюс скрипты `lint` и `typecheck` в `package.json`.
- В `.github/workflows/ci.yml` lint и typecheck идут отдельными job'ами, триггеры: push и pull_request.

## Файлы
- `package.json` — зависимости и скрипты `dev` / `build` / `lint` / `typecheck` (новый файл)
- `vite.config.ts`, `tsconfig*.json`, `index.html` — конфигурация Vite/TS (новые файлы)
- `eslint.config.js` — конфиг eslint (новый файл)
- `src/main.tsx` — провайдеры Mantine, TanStack Query, роутер (новый файл)
- `src/lib/supabase.ts` — клиент Supabase (новый файл)
- `supabase/config.toml` — конфиг Supabase CLI (новый файл)
- `.env.example` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (новый файл)
- `.gitignore` — `node_modules`, `dist`, `.env`, `supabase/.temp` (новый файл)
- `.github/workflows/ci.yml` — CI: lint и typecheck (новый файл)

## Не делаем в этой задаче
- Схему БД и миграции (этап 2)
- Экраны, авторизацию и layout (этап 4)
- Деплой на Vercel (этап 5)
- Тестовый фреймворк (vitest)

## Вопросы
- ❓ Пакетный менеджер: npm или pnpm? (в задаче пока npm)
- ❓ Нужен ли в CI шаг `npm run build`, помимо lint и typecheck?

## Связанные задачи
- Родительская: `TASK-20261105-mini-crm-implementation`
- Зависит от: —
- Блокирует: `TASK-20261105-db-schema-rls-migrations`, `TASK-20261105-frontend-screens-auth`, `TASK-20261105-security-check-script`

## Критерии приёмки (Definition of Done)
- [ ] Критерии из "Готово когда" выполнены и покрыты автотестами
- [ ] `eslint` и статический анализ (`tsc`) зелёные
- [ ] Юнит- и интеграционные тесты зелёные локально
- [ ] Документация (README / rules/ / API docs) обновлена, если изменилось поведение
- [ ] Code review пройден
- [ ] Нет регрессий в смежных сценариях
