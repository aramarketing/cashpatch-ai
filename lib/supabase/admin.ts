import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) throw new Error('Supabase admin environment is not configured')
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
