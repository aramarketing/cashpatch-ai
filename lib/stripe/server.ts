import Stripe from 'stripe'

export function createStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key)
}

export const priceLookupKeys = {
  standard_monthly: 'cashpatch_standard_monthly',
  standard_yearly: 'cashpatch_standard_yearly',
  pro_monthly: 'cashpatch_pro_monthly',
  pro_yearly: 'cashpatch_pro_yearly',
} as const

export type PriceKey = keyof typeof priceLookupKeys
