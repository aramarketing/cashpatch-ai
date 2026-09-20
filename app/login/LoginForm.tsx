'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setState('Sending secure sign-in link…')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    })
    setState(error ? error.message : 'Check your inbox. The sign-in link is on its way.')
  }
  return <form onSubmit={submit} className="login-card">
    <div className="signal">CP</div>
    <p className="eyebrow">CASH RECOVERY OS</p>
    <h1>Find the money your tools forgot.</h1>
    <p className="lede">Sign in with a secure email link. No password required.</p>
    <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@company.com" required /></label>
    <button type="submit">Continue</button>
    {state && <p className="status">{state}</p>}
  </form>
}
