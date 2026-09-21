import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  const code = request.nextUrl.searchParams.get('code')
  const nextPath = safeReturnTo(request.nextUrl.searchParams.get('next'))

  const supabase = await createClient()
  let authenticated = false

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authenticated = !error
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })
    authenticated = !error
  }

  if (authenticated) {
    const redirectTo = new URL(nextPath, request.url)
    const response = NextResponse.redirect(redirectTo)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('error', 'invalid_or_expired_link')
  loginUrl.searchParams.set('next', nextPath)
  const response = NextResponse.redirect(loginUrl)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
