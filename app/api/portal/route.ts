import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createStripe } from '@/lib/stripe/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getClaims()
  if (authError || !auth?.claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: memberships } = await supabase.from('workspace_members').select('workspace_id').limit(1)
  const workspaceId = memberships?.[0]?.workspace_id
  if (!workspaceId) return NextResponse.json({ error: 'Workspace required' }, { status: 409 })

  const { data: billing } = await supabase
    .from('billing_accounts')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!billing?.stripe_customer_id) return NextResponse.json({ error: 'No billing account' }, { status: 404 })

  const stripe = createStripe()
  const origin = new URL(request.url).origin
  const portal = await stripe.billingPortal.sessions.create({
    customer: billing.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  })
  return NextResponse.json({ url: portal.url })
}
