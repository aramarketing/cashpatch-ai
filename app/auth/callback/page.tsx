'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const [message, setMessage] = useState('Completing secure sign-in…')

  useEffect(() => {
    let cancelled = false

    async function completeAuth() {
      try {
        const supabase = createClient()
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        } else {
          const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
          const accessToken = hash.get('access_token')
          const refreshToken = hash.get('refresh_token')
          const hashError = hash.get('error_description') || hash.get('error')

          if (hashError) throw new Error(hashError)

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
            if (error) throw error
          } else {
            const { data, error } = await supabase.auth.getSession()
            if (error) throw error
            if (!data.session) throw new Error('No authentication session was returned by the sign-in link.')
          }
        }

        // Remove auth parameters/tokens from the address bar before continuing.
        window.history.replaceState({}, '', '/auth/callback')

        if (!cancelled) {
          setMessage('Signed in. Opening your recovery dashboard…')
          window.location.replace('/dashboard')
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Sign-in failed. Please request a new link.')
        }
      }
    }

    completeAuth()
    return () => { cancelled = true }
  }, [])

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="signal">CP</div>
        <p className="eyebrow">SECURE SIGN-IN</p>
        <h1>Opening CashPatch.</h1>
        <p className="lede">{message}</p>
        <p className="status">If this takes more than a few seconds, return to the login page and request a fresh link.</p>
      </section>
    </main>
  )
}
