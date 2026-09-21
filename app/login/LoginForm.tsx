'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type LoginFormProps = {
  nextPath?: string
  pairing?: boolean
}

export default function LoginForm({ nextPath = '/dashboard', pairing = false }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('Sending secure sign-in link…')

    const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//')
      ? nextPath
      : '/dashboard'

    const confirmUrl = new URL('/auth/confirm', window.location.origin)
    confirmUrl.searchParams.set('next', safeNext)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: confirmUrl.toString() },
    })

    setState(error ? error.message : 'Check your inbox. The sign-in link is on its way.')
  }

  return <form onSubmit={submit} className="login-card">
    <div className="signal">CP</div>
    <p className="eyebrow">{pairing ? 'DESKTOP PAIRING' : 'CASH RECOVERY OS'}</p>
    <h1>{pairing ? 'Approve CashPatch Desktop.' : 'Find the money your tools forgot.'}</h1>
    <p className="lede">
      {pairing
        ? 'Sign in with your CashPatch email. After sign-in, you will return to this device approval automatically.'
        : 'Sign in with a secure email link. No password required.'}
    </p>
    <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@company.com" required /></label>
    <button type="submit">Continue</button>
    {state && <p className="status">{state}</p>}
  </form>
}
