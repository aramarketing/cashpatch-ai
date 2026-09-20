import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const devicePublicId = String(body.devicePublicId ?? '').trim()
    const deviceName = String(body.deviceName ?? '').trim().slice(0, 120)
    const platform = String(body.platform ?? '').trim()
    const architecture = String(body.architecture ?? '').trim().slice(0, 40)
    const appVersion = String(body.appVersion ?? '').trim().slice(0, 40)
    const publicKey = String(body.publicKey ?? '').trim().slice(0, 4000)

    if (!devicePublicId || !['macos', 'windows'].includes(platform)) {
      return NextResponse.json({ error: 'invalid_device' }, { status: 400 })
    }

    const pairingCode = randomBytes(5).toString('hex').toUpperCase()
    const pairingSecret = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('desktop_pairing_create', {
      p_code: pairingCode,
      p_secret_hash: hash(pairingSecret),
      p_device_public_id: devicePublicId,
      p_device_name: deviceName || null,
      p_platform: platform,
      p_architecture: architecture || null,
      p_app_version: appVersion || null,
      p_public_key: publicKey || null,
      p_expires_at: expiresAt,
    })

    if (error) throw error

    return NextResponse.json({
      pairingId: data,
      pairingCode,
      pairingSecret,
      expiresAt,
      approveUrl: `https://cashpatch-ai.vercel.app/desktop/pair?code=${encodeURIComponent(pairingCode)}`,
    })
  } catch (error) {
    console.error('desktop pairing start failed', error)
    return NextResponse.json({ error: 'pairing_start_failed' }, { status: 500 })
  }
}
