import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LoginForm from './LoginForm'

function safeReturnTo(value?: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextPath = safeReturnTo(params.next)

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (data?.claims) redirect(nextPath)

  return <main className="login-shell">
    <LoginForm
      nextPath={nextPath}
      pairing={nextPath.startsWith('/desktop/pair?')}
    />
  </main>
}
