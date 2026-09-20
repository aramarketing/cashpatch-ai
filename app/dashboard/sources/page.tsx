import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from '../SignOutButton'

type Connection = {
  id: string
  provider: string
  display_name: string | null
  status: string
  updated_at: string
}

const providers = [
  {
    key: 'gmail',
    name: 'Gmail',
    group: 'Inbox intelligence',
    description: 'Reads business conversations, quotes, follow-ups and payment promises. CashPatch watches for silence, stalled deals and money left hanging.',
    note: 'Automatic background sync after connection',
  },
  {
    key: 'outlook',
    name: 'Microsoft Outlook',
    group: 'Inbox intelligence',
    description: 'Connect Microsoft 365 mail so CashPatch can detect unanswered quotes, overdue follow-ups and commercial commitments.',
    note: 'Automatic background sync after connection',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    group: 'Payments',
    description: 'Watches customers, subscriptions, invoices and payments for failed charges, unpaid invoices and revenue at risk.',
    note: 'Continuous payment monitoring',
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    group: 'CRM',
    description: 'Tracks deals, stages and inactivity to find opportunities that are worth money but have stopped moving.',
    note: 'CRM OAuth connector',
  },
  {
    key: 'pipedrive',
    name: 'Pipedrive',
    group: 'CRM',
    description: 'Monitors deal value, pipeline movement and neglected opportunities without replacing the CRM.',
    note: 'CRM OAuth connector',
  },
  {
    key: 'xero',
    name: 'Xero',
    group: 'Accounting',
    description: 'Connect invoices and receivables so CashPatch can surface overdue and partially paid revenue automatically.',
    note: 'Accounting connector',
  },
  {
    key: 'quickbooks',
    name: 'QuickBooks',
    group: 'Accounting',
    description: 'Monitors invoices and customer balances to surface cash that should already have arrived.',
    note: 'Accounting connector',
  },
  {
    key: 'desktop',
    name: 'CashPatch Desktop Agent',
    group: 'Computer',
    description: 'A lightweight local helper for approved folders and browser workflows, so CashPatch can observe business signals without manual uploads.',
    note: 'Local-first agent · planned',
  },
  {
    key: 'ai',
    name: 'AI workspace',
    group: 'AI',
    description: 'Connect supported AI workspaces so CashPatch can use existing business context and cross-check its own findings.',
    note: 'Optional context layer',
  },
]

export default async function SourcesPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) redirect('/login')

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .limit(1)

  const workspaceId = memberships?.[0]?.workspace_id
  if (!workspaceId) redirect('/dashboard')

  const [{ data: workspaces }, { data: connections }] = await Promise.all([
    supabase.from('workspaces').select('name,plan,billing_status').eq('id', workspaceId).limit(1),
    supabase.from('source_connections').select('id,provider,display_name,status,updated_at').eq('workspace_id', workspaceId)
  ])

  const workspace = workspaces?.[0]
  const connectionMap = new Map((connections ?? []).map((c: Connection) => [c.provider, c]))

  return <div className="dashboard-shell">
    <aside>
      <div className="brand"><span className="logo">CP</span><strong>CashPatch</strong></div>
      <nav>
        <a href="/dashboard">Recovery queue</a>
        <a className="active" href="/dashboard/sources">Sources</a>
        <a href="/dashboard/reports">Reports</a>
      </nav>
      <div className="aside-bottom"><span>{workspace?.plan ?? 'trial'} plan</span><SignOutButton /></div>
    </aside>

    <main className="dashboard-main">
      <header className="dash-head source-head">
        <div>
          <p className="eyebrow">{workspace?.name ?? 'Workspace'} · CONNECTED BUSINESS</p>
          <h1>Plug in. CashPatch watches.</h1>
          <p className="source-intro">Connect the systems your business already uses. CashPatch syncs in the background, detects money leaks and sends only the highest-value findings to the recovery queue.</p>
        </div>
      </header>

      <section className="source-principles">
        <article><span>01</span><strong>No uploads</strong><p>Connections replace manual file handling.</p></article>
        <article><span>02</span><strong>Read first</strong><p>CashPatch starts with least-privilege, read-only access wherever possible.</p></article>
        <article><span>03</span><strong>Always scanning</strong><p>New signals are synced and rescored automatically.</p></article>
      </section>

      <section className="source-grid">
        {providers.map(provider => {
          const connected = connectionMap.get(provider.key)
          const status = connected?.status ?? 'not connected'
          const live = status === 'connected'
          return <article className="source-card" key={provider.key}>
            <div className="source-card-top">
              <span className="source-group">{provider.group}</span>
              <span className={`source-status ${live ? 'connected' : ''}`}>{status}</span>
            </div>
            <h2>{provider.name}</h2>
            <p>{provider.description}</p>
            <div className="source-card-bottom">
              <small>{live ? connected?.display_name ?? 'Connected' : provider.note}</small>
              {live
                ? <button className="source-button secondary" type="button">Manage</button>
                : <a className="source-button" href={`/api/sources/${provider.key}/connect`}>Connect</a>}
            </div>
          </article>
        })}
      </section>

      <section className="agent-note">
        <p className="eyebrow">CASH PATCH AGENT</p>
        <h2>The product should do the chasing, not the customer.</h2>
        <p>Once a source is connected, the intended experience is continuous: sync → detect → prioritize → propose action → learn from the outcome. CSV remains a developer fallback only and is no longer part of the main product journey.</p>
      </section>
    </main>
  </div>
}
