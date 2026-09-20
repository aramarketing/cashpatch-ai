import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  getAccountMetadata,
  getBalances,
  getRequisition,
  getTransactions,
} from '@/lib/banking/gocardless'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function yyyyMmDd(date: Date) {
  return date.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const deviceId = String(body.deviceId ?? '').trim()
    const deviceCredential = String(body.deviceCredential ?? '').trim()
    const sourceConnectionId = String(body.sourceConnectionId ?? '').trim()

    if (!deviceId || !deviceCredential || !sourceConnectionId) {
      return NextResponse.json({ error: 'missing_credentials' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: entitlement, error: entitlementError } = await admin.rpc('desktop_entitlement_check', {
      p_device_id: deviceId,
      p_credential_hash: hash(deviceCredential),
      p_app_version: String(body.appVersion ?? '').slice(0, 40) || null,
    })

    if (entitlementError) throw entitlementError
    const ent = Array.isArray(entitlement) ? entitlement[0] : null
    if (!ent?.allowed || !ent.workspace_id) {
      return NextResponse.json({ error: 'entitlement_required' }, { status: 402 })
    }

    const { data: source } = await admin
      .from('source_connections')
      .select('id,workspace_id,status,permission_mode,external_write_allowed')
      .eq('id', sourceConnectionId)
      .eq('workspace_id', ent.workspace_id)
      .eq('provider', 'open_banking')
      .maybeSingle()

    if (
      !source ||
      source.status !== 'connected' ||
      source.permission_mode !== 'review_only' ||
      source.external_write_allowed !== false
    ) {
      return NextResponse.json({ error: 'bank_source_not_available' }, { status: 403 })
    }

    const { data: connection } = await admin
      .schema('private')
      .from('banking_connections')
      .select('requisition_id,consent_status')
      .eq('source_connection_id', sourceConnectionId)
      .maybeSingle()

    if (!connection || connection.consent_status !== 'linked') {
      return NextResponse.json({ error: 'bank_consent_not_linked' }, { status: 409 })
    }

    const requisition = await getRequisition(connection.requisition_id)
    const to = new Date()
    const from = new Date(to.getTime() - 90 * 86_400_000)

    const accounts = await Promise.all(
      requisition.accounts.map(async accountId => {
        const [metadata, balances, transactions] = await Promise.all([
          getAccountMetadata(accountId),
          getBalances(accountId),
          getTransactions(accountId, yyyyMmDd(from), yyyyMmDd(to)),
        ])

        return {
          accountId,
          metadata,
          balances,
          transactions,
        }
      })
    )

    await admin
      .schema('private')
      .from('banking_connections')
      .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('source_connection_id', sourceConnectionId)

    return NextResponse.json({
      sourceConnectionId,
      fetchedAt: new Date().toISOString(),
      accounts,
      retention: 'transient_only',
      permissions: ['accounts:read','balances:read','transactions:read'],
      externalWriteAllowed: false,
    })
  } catch (error) {
    console.error('desktop bank sync failed', error)
    return NextResponse.json({ error: 'bank_sync_failed' }, { status: 502 })
  }
}
