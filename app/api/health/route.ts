import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET() {
  const result: Record<string, unknown> = {
    app: 'cashpatch',
    supabase: false,
    stripe: false,
  }

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('workspaces').select('id', { head: true, count: 'exact' })
    result.supabase = !error
  } catch {
    result.supabase = false
  }

  try {
    const key = process.env.STRIPE_SECRET_KEY
    if (key) {
      const response = await fetch('https://api.stripe.com/v1/account', {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
      })
      const data = await response.json()
      result.stripe = response.ok
      result.stripeAccountId = response.ok ? data.id : null
      result.stripeLivemode = response.ok ? Boolean(data.livemode) : null
    }
  } catch {
    result.stripe = false
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
