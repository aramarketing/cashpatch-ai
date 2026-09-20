import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const pairingCode = String(body.pairingCode ?? '').trim().toUpperCase()
    const pairingSecret = String(body.pairingSecret ?? '').trim()

    if (!pairingCode || !pairingSecret) {
      return NextResponse.json({ error: 'missing_pairing_credentials' }, { status: 400 })
    }

    const deviceCredential = randomBytes(32).toString('base64url')
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('desktop_pairing_consume', {
      p_code: pairingCode,
      p_secret_hash: hash(pairingSecret),
      p_device_credential_hash: hash(deviceCredential),
    })

    if (error) throw error
    const result = Array.isArray(data) ? data[0] : null

    if (!result?.device_id) {
      return NextResponse.json({ state: 'pending' }, { status: 409 })
    }

    return NextResponse.json({
      state: 'paired',
      deviceId: result.device_id,
      workspaceId: result.workspace_id,
      deviceCredential,
    })
  } catch (error) {
    console.error('desktop pairing consume failed', error)
    return NextResponse.json({ error: 'pairing_consume_failed' }, { status: 500 })
  }
}
