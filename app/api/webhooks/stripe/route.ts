import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id ?? null
}

function periodEnd(subscription: Stripe.Subscription) {
  const ts = subscription.items.data[0]?.current_period_end
  return ts ? new Date(ts * 1000).toISOString() : null
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const workspaceId = subscription.metadata.workspace_id
  if (!workspaceId) return
  const supabase = createAdminClient()
  const item = subscription.items.data[0]
  const price = item?.price
  const productId = idOf(price?.product)
  const plan = subscription.metadata.plan === 'pro' ? 'pro' : 'standard'
  const interval = price?.recurring?.interval === 'year' ? 'year' : 'month'
  const status = subscription.status

  await supabase.from('billing_accounts').upsert({
    workspace_id: workspaceId,
    stripe_customer_id: idOf(subscription.customer),
    stripe_subscription_id: subscription.id,
    stripe_price_id: price?.id ?? null,
    stripe_product_id: productId,
    plan,
    billing_interval: interval,
    status,
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' })

  await supabase.from('workspaces').update({
    plan,
    billing_status: status,
    billing_period_end: periodEnd(subscription),
    billing_cancel_at_period_end: subscription.cancel_at_period_end,
  }).eq('id', workspaceId)
}

export async function POST(request: Request) {
  const stripe = createStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook secret missing' }, { status: 500 })
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const payload = await request.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const subscriptionId = idOf(session.subscription)
      if (subscriptionId) await syncSubscription(await stripe.subscriptions.retrieve(subscriptionId))
    }
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await syncSubscription(event.data.object as Stripe.Subscription)
    }
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Stripe webhook sync failed', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
