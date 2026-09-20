import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getRequisition } from '@/lib/banking/gocardless'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const digest = (value: string) => createHash('sha256').update(value).digest()

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sourceId = url.searchParams.get('source') ?? ''
  const state = url.searchParams.get('state') ?? ''

  if (!sourceId || !state) {
    return NextResponse.redirect(new URL('/dashboard/sources?banking=invalid', request.url))
  }

  const admin = createAdminClient()
  const { data: connection } = await admin
    .schema('private')
    .from('banking_connections')
    .select('source_connection_id,requisition_id,callback_secret_hash')
    .eq('source_connection_id', sourceId)
    .maybeSingle()

  if (!connection?.callback_secret_hash) {
    return NextResponse.redirect(new URL('/dashboard/sources?banking=invalid', request.url))
  }

  const expected = Buffer.from(connection.callback_secret_hash, 'hex')
  const actual = digest(state)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.redirect(new URL('/dashboard/sources?banking=invalid', request.url))
  }

  try {
    const requisition = await getRequisition(connection.requisition_id)
    const status = typeof requisition.status === 'string'
      ? requisition.status
      : requisition.status?.short ?? requisition.status?.long ?? ''

    if (status !== 'LN') {
      await admin
        .schema('private')
        .from('banking_connections')
        .update({ consent_status: status === 'EX' ? 'expired' : 'error', updated_at: new Date().toISOString() })
        .eq('source_connection_id', sourceId)

      return NextResponse.redirect(new URL('/dashboard/sources?banking=not_linked', request.url))
    }

    await Promise.all([
      admin
        .schema('private')
        .from('banking_connections')
        .update({
          consent_status: 'linked',
          callback_secret_hash: null,
          updated_at: new Date().toISOString(),
        })
        .eq('source_connection_id', sourceId),
      admin
        .from('source_connections')
        .update({
          status: 'connected',
          external_account_id: requisition.institution_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId),
    ])

    return NextResponse.redirect(new URL('/dashboard/sources?banking=connected', request.url))
  } catch (error) {
    console.error('bank callback failed', error)
    return NextResponse.redirect(new URL('/dashboard/sources?banking=error', request.url))
  }
}
