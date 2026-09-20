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
    const appVersion = String(body.appVersion ?? '').trim().slice(0, 40)

    if (!deviceId || !deviceCredential) {
      return NextResponse.json({ error: 'missing_device_credentials' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('desktop_entitlement_check', {
      p_device_id: deviceId,
      p_credential_hash: hash(deviceCredential),
      p_app_version: appVersion || null,
    })

    if (error) throw error
    const result = Array.isArray(data) ? data[0] : null

    if (!result) {
      return NextResponse.json({ error: 'invalid_device_credentials' }, { status: 401 })
    }

    return NextResponse.json({
      allowed: Boolean(result.allowed),
      billingStatus: result.billing_status,
      plan: result.plan,
      workspaceId: result.workspace_id,
      deviceStatus: result.device_status,
      nextCheckSeconds: 300,
    })
  } catch (error) {
    console.error('desktop entitlement check failed', error)
    return NextResponse.json({ error: 'entitlement_check_failed' }, { status: 500 })
  }
}
