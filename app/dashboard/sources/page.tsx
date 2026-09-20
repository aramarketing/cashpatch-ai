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
  // Email & communication
  { key:'gmail', name:'Gmail', group:'Email', description:'Monitors quotes, follow-ups, payment promises and stalled conversations.', note:'OAuth · background sync' },
  { key:'outlook', name:'Microsoft Outlook', group:'Email', description:'Reads Microsoft 365 business mail for unanswered commercial conversations and revenue signals.', note:'OAuth · background sync' },
  { key:'slack', name:'Slack', group:'Communication', description:'Finds commercial commitments, customer handoffs and unresolved revenue-related threads.', note:'OAuth · channel-scoped access' },
  { key:'teams', name:'Microsoft Teams', group:'Communication', description:'Uses approved Teams conversations and collaboration signals to detect stalled money workflows.', note:'Microsoft Graph connector' },

  // CRM
  { key:'hubspot', name:'HubSpot', group:'CRM', description:'Tracks deals, stages, inactivity and contact history to find neglected revenue.', note:'OAuth CRM connector' },
  { key:'salesforce', name:'Salesforce', group:'CRM', description:'Monitors opportunities, stages, activities and account signals for recoverable pipeline value.', note:'OAuth CRM connector' },
  { key:'pipedrive', name:'Pipedrive', group:'CRM', description:'Watches deal value, pipeline movement and opportunities that have stopped moving.', note:'OAuth CRM connector' },
  { key:'zoho_crm', name:'Zoho CRM', group:'CRM', description:'Connects leads, deals and follow-up activity to the recovery engine.', note:'OAuth CRM connector' },
  { key:'dynamics365', name:'Dynamics 365 Sales', group:'CRM', description:'Connects Microsoft CRM opportunities and activities with CashPatch recovery logic.', note:'Microsoft Graph / Dataverse' },
  { key:'close', name:'Close', group:'CRM', description:'Uses sales calls, emails, SMS and pipeline context to detect missed follow-up value.', note:'API connector' },
  { key:'freshsales', name:'Freshsales', group:'CRM', description:'Monitors leads, deals and activity gaps that may represent lost revenue.', note:'API connector' },

  // Project & work management
  { key:'asana', name:'Asana', group:'Project management', description:'Finds blocked customer work, overdue commercial tasks and handoffs tied to revenue.', note:'OAuth work-management connector' },
  { key:'trello', name:'Trello', group:'Project management', description:'Monitors boards and cards for stalled deliverables, follow-ups and billing triggers.', note:'OAuth work-management connector' },
  { key:'clickup', name:'ClickUp', group:'Project management', description:'Connects tasks, docs and work status to detect revenue blockers and missed billing events.', note:'OAuth work-management connector' },
  { key:'monday', name:'monday.com', group:'Project management', description:'Watches boards and automations for overdue customer work and commercial gaps.', note:'OAuth work-management connector' },
  { key:'jira', name:'Jira', group:'Project management', description:'Uses issue and project state to detect delivery blockers that can delay invoices or renewals.', note:'Atlassian OAuth connector' },
  { key:'notion', name:'Notion', group:'Project management', description:'Reads approved databases and workspaces for customer commitments, follow-ups and billing cues.', note:'OAuth workspace connector' },
  { key:'linear', name:'Linear', group:'Project management', description:'Monitors work state and customer-related issues that may block billable progress.', note:'OAuth work-management connector' },
  { key:'basecamp', name:'Basecamp', group:'Project management', description:'Connects project communication and todos to revenue-recovery signals.', note:'OAuth work-management connector' },

  // Banking, payments, accounting & commerce
  { key:'open_banking', name:'Bank accounts (Open Banking)', group:'Banking', description:'Reads approved account balances and transactions so CashPatch can match expected money with what actually arrived or left the account.', note:'PSD2/Open Banking · account information only', href:'/dashboard/sources/banking' },
  { key:'stripe', name:'Stripe', group:'Payments', description:'Watches subscriptions, invoices, failed payments and customers for revenue at risk.', note:'API + webhook connector' },
  { key:'paypal', name:'PayPal', group:'Payments', description:'Monitors transactions, disputes and payment state for recoverable cash.', note:'OAuth / API connector' },
  { key:'quickbooks', name:'QuickBooks', group:'Accounting', description:'Surfaces overdue invoices and customer balances automatically.', note:'OAuth accounting connector' },
  { key:'xero', name:'Xero', group:'Accounting', description:'Connects invoices and receivables for overdue and partially paid revenue detection.', note:'OAuth accounting connector' },
  { key:'lexoffice', name:'Lexoffice', group:'Accounting', description:'German SME accounting connector for invoices, contacts and receivables.', note:'API connector' },
  { key:'sevdesk', name:'sevDesk', group:'Accounting', description:'Monitors German SME invoices and receivables for missed cash.', note:'API connector' },
  { key:'datev', name:'DATEV', group:'Accounting', description:'Future connector for accounting data where customer/API access permits it.', note:'Partner/API dependent' },
  { key:'shopify', name:'Shopify', group:'Commerce', description:'Watches orders, refunds, customers and payment signals for commerce leakage.', note:'OAuth / Admin API' },
  { key:'woocommerce', name:'WooCommerce', group:'Commerce', description:'Connects orders and payment status for ecommerce recovery signals.', note:'REST API connector' },

  // AI systems
  { key:'openai', name:'OpenAI / ChatGPT', group:'AI', description:'Uses approved AI workspace or API context as an additional business-intelligence source.', note:'API / future workspace connector' },
  { key:'claude', name:'Anthropic Claude', group:'AI', description:'Connects supported Claude/API workflows for context, cross-checking and delegated analysis.', note:'API / MCP where supported' },
  { key:'gemini', name:'Google Gemini', group:'AI', description:'Connects supported Gemini APIs and enterprise context for delegated analysis.', note:'API connector' },
  { key:'perplexity', name:'Perplexity', group:'AI', description:'Optional research and verification layer for supported business workflows.', note:'API connector' },
  { key:'copilot', name:'Microsoft Copilot', group:'AI', description:'Future Microsoft AI connector where tenant APIs and permissions allow it.', note:'Microsoft ecosystem connector' },
  { key:'local_ai', name:'Local AI models', group:'AI', description:'Connect Ollama, LM Studio and other local models through the CashPatch local bridge.', note:'Local bridge / OpenAI-compatible API' },

  // Universal bridges
  { key:'mcp', name:'MCP server', group:'Universal', description:'Connect any compatible Model Context Protocol server so new tools can be added without bespoke UI.', note:'MCP connector' },
  { key:'custom_api', name:'REST / OpenAPI', group:'Universal', description:'Connect a custom business system using an API base URL, schema and scoped credentials.', note:'Custom API connector' },
  { key:'webhook', name:'Webhooks', group:'Universal', description:'Let any system push money-relevant events into CashPatch in real time.', note:'Inbound webhook' },
  { key:'desktop', name:'CashPatch Desktop Agent', group:'Computer', description:'A local macOS/Windows helper for approved folders, apps and workflows when cloud APIs are not enough.', note:'Local-first agent' },
  { key:'browser', name:'CashPatch Browser Agent', group:'Computer', description:'Browser extension for approved sites and workflows that do not expose a usable API.', note:'Permissioned browser extension' },
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

      <section className="review-only-banner">
        <div>
          <p className="eyebrow">REVIEW-ONLY GUARANTEE</p>
          <h2>CashPatch can see. CashPatch cannot change.</h2>
          <p>Connected systems are read-only. CashPatch may analyze, synchronize and create recommendations inside CashPatch, but it cannot send, edit, delete, click, type, submit, move, charge, refund or modify anything in the source system.</p>
        </div>
        <span className="review-lock">READ ONLY</span>
      </section>

      <section className="source-principles">
        <article><span>01</span><strong>No uploads</strong><p>Connections replace manual file handling.</p></article>
        <article><span>02</span><strong>Least privilege</strong><p>Only review scopes are accepted. If a provider cannot guarantee read-only access, CashPatch does not connect.</p></article>
        <article><span>03</span><strong>Always scanning</strong><p>New signals are synced and rescored automatically without changing the source.</p></article>
      </section>

      <section className="source-grid">
        {providers.map(provider => {
          const connected = connectionMap.get(provider.key)
          const status = connected?.status ?? 'not connected'
          const live = status === 'connected'
          return <article className="source-card" key={provider.key}>
            <div className="source-card-top">
              <span className="source-group">{provider.group}</span>
              <span className={`source-status ${live ? 'connected' : ''}`}>{status} · review only</span>
            </div>
            <h2>{provider.name}</h2>
            <p>{provider.description}</p>
            <div className="source-card-bottom">
              <small>{live ? connected?.display_name ?? 'Connected' : provider.note}</small>
              {live
                ? <button className="source-button secondary" type="button">Manage</button>
                : <a className="source-button" href={provider.href ?? `/api/sources/${provider.key}/connect`}>Connect</a>}
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
