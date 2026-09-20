import { NextResponse } from 'next/server'
import { createStripe } from '@/lib/stripe/server'

export const runtime = 'nodejs'

type PriceDef = {
  lookupKey: string
  amount: number
  interval: 'month' | 'year'
  nickname: string
}

type PlanDef = {
  productKey: string
  name: string
  description: string
  prices: PriceDef[]
}

const plans: PlanDef[] = [
  {
    productKey: 'cashpatch_standard',
    name: 'CashPatch Standard',
    description: 'AI-powered money leak detection and recovery queue for small businesses.',
    prices: [
      { lookupKey: 'cashpatch_standard_monthly', amount: 4900, interval: 'month', nickname: 'Standard Monthly' },
      { lookupKey: 'cashpatch_standard_yearly', amount: 49000, interval: 'year', nickname: 'Standard Yearly' },
    ],
  },
  {
    productKey: 'cashpatch_pro',
    name: 'CashPatch Pro',
    description: 'Advanced money leak recovery for teams and multiple connected data sources.',
    prices: [
      { lookupKey: 'cashpatch_pro_monthly', amount: 9900, interval: 'month', nickname: 'Pro Monthly' },
      { lookupKey: 'cashpatch_pro_yearly', amount: 99000, interval: 'year', nickname: 'Pro Yearly' },
    ],
  },
]

export async function GET() {
  const stripe = createStripe()
  const output: Array<Record<string, unknown>> = []

  for (const plan of plans) {
    const productSearch = await stripe.products.search({
      query: `metadata['product_key']:'${plan.productKey}'`,
      limit: 1,
    })

    const product = productSearch.data[0] ?? await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { product_key: plan.productKey, environment: 'sandbox' },
    })

    const prices: Array<Record<string, unknown>> = []

    for (const def of plan.prices) {
      const existing = await stripe.prices.list({
        active: true,
        lookup_keys: [def.lookupKey],
        limit: 1,
      })

      const price = existing.data[0] ?? await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: def.amount,
        recurring: { interval: def.interval },
        lookup_key: def.lookupKey,
        nickname: def.nickname,
      })

      prices.push({
        id: price.id,
        lookupKey: def.lookupKey,
        unitAmount: price.unit_amount,
        interval: price.recurring?.interval ?? null,
      })
    }

    output.push({
      productId: product.id,
      productKey: plan.productKey,
      prices,
    })
  }

  return NextResponse.json({
    ok: true,
    account: 'current-stripe-key',
    plans: output,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
