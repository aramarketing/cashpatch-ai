import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createStripe, priceLookupKeys, type PriceKey } from '@/lib/stripe/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getClaims()
  if (authError || !auth?.claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const priceKey = String(body.priceKey ?? '') as PriceKey
  const lookupKey = priceLookupKeys[priceKey]
  if (!lookupKey) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .limit(1)
  const workspaceId = memberships?.[0]?.workspace_id
  if (!workspaceId) return NextResponse.json({ error: 'Workspace required' }, { status: 409 })

  const stripe = createStripe()
  const prices = await stripe.prices.list({ active: true, lookup_keys: [lookupKey], limit: 1 })
  const price = prices.data[0]
  if (!price) return NextResponse.json({ error: 'Price not configured' }, { status: 500 })

  const { data: billing } = await supabase
    .from('billing_accounts')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const origin = new URL(request.url).origin
  const plan = priceKey.startsWith('pro_') ? 'pro' : 'standard'
  const interval = priceKey.endsWith('_yearly') ? 'year' : 'month'
  const email = typeof auth.claims.email === 'string' ? auth.claims.email : undefined

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    customer: billing?.stripe_customer_id || undefined,
    customer_email: billing?.stripe_customer_id ? undefined : email,
    client_reference_id: workspaceId,
    metadata: { workspace_id: workspaceId, plan, interval },
    subscription_data: { metadata: { workspace_id: workspaceId, plan, interval } },
    success_url: `${origin}/dashboard?billing=success`,
    cancel_url: `${origin}/dashboard?billing=cancelled`,
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: session.url })
}
