import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createRequisition, bankingConfigured } from '@/lib/banking/gocardless'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  const userId = auth?.claims?.sub
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!bankingConfigured()) {
    return NextResponse.json({ error: 'banking_not_configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const institutionId = String(body.institutionId ?? '').trim()
  const country = String(body.country ?? 'DE').trim().toUpperCase()

  if (!institutionId || !/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1)

  const workspaceId = memberships?.[0]?.workspace_id
  if (!workspaceId) return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 })

  const admin = createAdminClient()
  const { data: source, error: sourceError } = await admin
    .from('source_connections')
    .insert({
      workspace_id: workspaceId,
      provider: 'open_banking',
      provider_category: 'banking',
      display_name: institutionId,
      status: 'pending',
      connection_method: 'oauth2',
      sync_mode: 'scheduled',
      permission_mode: 'review_only',
      external_write_allowed: false,
      capabilities: ['read','list','sync','analyze'],
      scopes: ['accounts','balances','transactions'],
      config: { country },
    })
    .select('id')
    .single()

  if (sourceError || !source) {
    console.error('bank source create failed', sourceError)
    return NextResponse.json({ error: 'source_create_failed' }, { status: 500 })
  }

  const callbackSecret = randomBytes(32).toString('base64url')
  const callbackUrl = new URL('/api/banking/callback', 'https://cashpatch-ai.vercel.app')
  callbackUrl.searchParams.set('source', source.id)
  callbackUrl.searchParams.set('state', callbackSecret)

  try {
    const requisition = await createRequisition({
      institutionId,
      redirect: callbackUrl.toString(),
      reference: source.id,
      userLanguage: country === 'DE' ? 'DE' : 'EN',
    })

    const { error: privateError } = await admin
      .schema('private')
      .from('banking_connections')
      .insert({
        source_connection_id: source.id,
        provider: 'gocardless_bacd',
        requisition_id: requisition.id,
        institution_id: institutionId,
        country,
        consent_status: 'pending',
        callback_secret_hash: hash(callbackSecret),
      })

    if (privateError) throw privateError

    return NextResponse.json({
      sourceConnectionId: source.id,
      authorizationUrl: requisition.link,
    })
  } catch (error) {
    await admin.from('source_connections').delete().eq('id', source.id)
    console.error('bank connect failed', error)
    return NextResponse.json({ error: 'bank_connect_failed' }, { status: 502 })
  }
}
