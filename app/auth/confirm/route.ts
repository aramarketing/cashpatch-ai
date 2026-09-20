import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null

  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = '/dashboard'
  redirectTo.search = ''

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })

    if (!error) {
      const response = NextResponse.redirect(redirectTo)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }

  redirectTo.pathname = '/login'
  redirectTo.searchParams.set('error', 'invalid_or_expired_link')
  const response = NextResponse.redirect(redirectTo)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
