import { createClient } from '@supabase/supabase-js'

const supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example).',
  )
}

// TODO(stage 2): pass the generated `Database` type: createClient<Database>(...)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
