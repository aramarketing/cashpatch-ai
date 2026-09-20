import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bankingConfigured, listInstitutions } from '@/lib/banking/gocardless'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!bankingConfigured()) {
    return NextResponse.json({ error: 'banking_not_configured' }, { status: 503 })
  }

  const country = new URL(request.url).searchParams.get('country')?.toUpperCase() ?? 'DE'
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'invalid_country' }, { status: 400 })
  }

  try {
    const institutions = await listInstitutions(country)
    return NextResponse.json({
      country,
      institutions: institutions
        .map(bank => ({
          id: bank.id,
          name: bank.name,
          bic: bank.bic ?? null,
          logo: bank.logo ?? null,
          businessAccountsSupported: bank.business_accounts_supported ?? null,
          corporateAccountsSupported: bank.corporate_accounts_supported ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (error) {
    console.error('bank institution list failed', error)
    return NextResponse.json({ error: 'banking_provider_failed' }, { status: 502 })
  }
}
