import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export default async function DesktopPairPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; approved?: string }>
}) {
  const params = await searchParams
  const code = String(params.code ?? '').trim().toUpperCase()
  const approved = params.approved === '1'

  if (!/^[A-F0-9]{10}$/.test(code)) redirect('/dashboard')

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims?.sub) {
    const returnTo = `/desktop/pair?code=${encodeURIComponent(code)}`
    redirect(`/login?next=${encodeURIComponent(returnTo)}`)
  }

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id,role')
    .in('role', ['owner', 'admin'])
    .limit(1)

  const workspaceId = memberships?.[0]?.workspace_id
  if (!workspaceId) redirect('/dashboard')

  async function approveDevice() {
    'use server'
    const server = await createClient()
    const { data: currentAuth } = await server.auth.getClaims()
    const userId = currentAuth?.claims?.sub
    if (!userId) {
      const returnTo = `/desktop/pair?code=${encodeURIComponent(code)}`
      redirect(`/login?next=${encodeURIComponent(returnTo)}`)
    }

    const { data: currentMemberships } = await server
      .from('workspace_members')
      .select('workspace_id,role')
      .in('role', ['owner', 'admin'])
      .limit(1)

    const currentWorkspaceId = currentMemberships?.[0]?.workspace_id
    if (!currentWorkspaceId) redirect('/dashboard')

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('desktop_pairing_approve', {
      p_code: code,
      p_workspace_id: currentWorkspaceId,
      p_approved_by: userId,
    })

    if (error || !data) redirect(`/desktop/pair?code=${encodeURIComponent(code)}&approved=0`)
    redirect(`/desktop/pair?code=${encodeURIComponent(code)}&approved=1`)
  }

  return <main className="app-shell">
    <section className="onboarding">
      <div className="signal">CP</div>
      <p className="eyebrow">DESKTOP PAIRING</p>
      <h1>{approved ? 'Device approved.' : 'Pair CashPatch Desktop.'}</h1>
      {approved
        ? <>
            <p>Return to the CashPatch app. It will finish pairing automatically and then verify your paid subscription.</p>
            <p className="status">Pairing code {code}</p>
          </>
        : <>
            <p>Approve this installation for your workspace. This does not grant write access to Gmail, CRM, project tools or your computer.</p>
            <p className="status">Pairing code {code}</p>
            <form action={approveDevice}><button>Approve this device</button></form>
          </>}
    </section>
  </main>
}
