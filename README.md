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
