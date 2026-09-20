import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const deviceId = String(body.deviceId ?? '').trim()
    const deviceCredential = String(body.deviceCredential ?? '').trim()

    if (!deviceId || !deviceCredential) {
      return NextResponse.json({ error: 'missing_device_credentials' }, { status: 401 })
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

    const { data: sources, error } = await admin
      .from('source_connections')
      .select('id,provider,provider_category,display_name,status,scopes,capabilities,permission_mode,external_write_allowed,updated_at')
      .eq('workspace_id', ent.workspace_id)
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({
      sources: (sources ?? []).map(source => ({
        id: source.id,
        provider: source.provider,
        category: source.provider_category,
        displayName: source.display_name,
        status: source.status,
        scopes: source.scopes,
        capabilities: source.capabilities,
        permissionMode: source.permission_mode,
        externalWriteAllowed: source.external_write_allowed,
        updatedAt: source.updated_at,
      })),
    })
  } catch (error) {
    console.error('desktop source list failed', error)
    return NextResponse.json({ error: 'desktop_source_list_failed' }, { status: 500 })
  }
}
