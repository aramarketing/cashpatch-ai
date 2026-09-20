import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { createStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const idOf = (value:string|Stripe.Customer|Stripe.Subscription|null):string|null => {
  if (!value) return null
  return typeof value==='string' ? value : value.id
}

async function syncSubscription(subscription:Stripe.Subscription) {
  const workspaceId = subscription.metadata.workspace_id
  if (!workspaceId) throw new Error('Missing workspace_id metadata')
  const stripe = createStripe()
  const item = subscription.items.data[0]
  const priceId = idOf(item?.price as any)
  let productId:string|null = null
  if (item?.price) {
    const p = item.price.product
    productId = typeof p==='string' ? p : p?.id ?? null
  }
  const customerId = idOf(subscription.customer as any)
  const supabase = createAdminClient()
  const plan = subscription.metadata.plan==='pro'?'pro':'standard'
  const interval = subscription.metadata.interval==='year'?'year':'month'
  const currentPeriodEnd = (typeof (subscription as any).current_period_end === 'number') ? new Date((subscription as any).current_period_end * 1000).toISOString() : null

  await supabase.from('billing_accounts').upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId, stripe_product_id: productId, plan, billing_interval: interval,
    status: subscription.status, current_period_end: currentPeriodEnd,
    cancel_at_period_end: subscription.cancel_at_period, updated_at: new Date().toISOString()
  }, { onConflict: 'workspace_id' })
  await supabase.from('workspaces').update({
    plan, billing_status: subscription.status, billing_period_end: currentPeriodEnd,
    billing_cancel_at_period_end: subscription.cancel_at_period,
  }).eq('id', workspaceId)
}

export async function POST(request: Request) {
  const stripe = createStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
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
