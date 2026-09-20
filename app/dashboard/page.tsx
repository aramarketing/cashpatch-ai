import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createWorkspace, updateFinding } from './actions'
import SignOutButton from './SignOutButton'
import { CheckoutButton, PortalButton } from '@/components/BillingButtons'
import CsvImport from '@/components/CsvImport'

type Finding = {id:string; finding_type:string; title:string; counterparty:string; amount:number|string; currency:string; confidence:number|string; risk_score:number|string; explanation:string; next_action:string; status:string}

const money = (value:number|string, currency='EUR') => new Intl.NumberFormat('en-GB',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value||0))

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) redirect('/login')

  const { data: memberships } = await supabase.from('workspace_members').select('workspace_id, role').limit(1)
  const workspaceId = memberships?.[0]?.workspace_id
  if (!workspaceId) return <main className="app-shell"><section className="onboarding"><p className="eyebrow">FIRST RUN</p><h1>Create your recovery workspace.</h1><p>CashPatch will keep every finding isolated inside this workspace.</p><form action={createWorkspace}><input name="name" placeholder="Company or workspace name" minLength={2} maxLength={120} required/><button>Create workspace</button></form><SignOutButton /></section></main>

  const [{ data: workspaces }, { data: findings }] = await Promise.all([
    supabase.from('workspaces').select('id,name,plan,billing_status').eq('id', workspaceId).limit(1),
    supabase.from('findings').select('id,finding_type,title,counterparty,amount,currency,confidence,risk_score,explanation,next_action,status').eq('workspace_id', workspaceId).order('risk_score',{ascending:false}).limit(50)
  ])
  const workspace = workspaces?.[0]
  const list = (findings ?? []) as Finding[]
  const open = list.filter(f=>f.status==='open' || f.status==='approved')
  const potential = open.reduce((sum,f)=>sum+Number(f.amount||0),0)
  const weighted = open.reduce((sum,f)=>sum+Number(f.risk_score||0),0)

  return <div className="dashboard-shell">
    <aside><div className="brand"><span className="logo">CP</span><strong>CashPatch</strong></div><nav><a className="active">Recovery queue</a><a>Sources</a><a>Reports</a></nav><div className="aside-bottom"><span>{workspace?.plan ?? 'trial'} plan</span><SignOutButton /></div></aside>
    <main className="dashboard-main">
      <header className="dash-head"><div><p className="eyebrow">{workspace?.name ?? 'Workspace'}</p><h1>Recover what slipped through.</h1></div><CsvImport /></header>
      <section className="metrics"><article><span>Potential</span><strong>{money(potential)}</strong><small>Open findings</small></article><article><span>Priority value</span><strong>{money(weighted)}</strong><small>Confidence × recoverability × urgency</small></article><article><span>Open</span><strong>{open.length}</strong><small>Items awaiting action</small></article><article><span>Status</span><strong>{workspace?.billing_status ?? 'free'}</strong><small>Billing state</small></article></section>
      <section className="billing-strip">
        <div><p className="eyebrow">SUBSCRIPTION</p><h2>{workspace?.billing_status==='active' ? 'CashPatch is active.' : 'Unlock continuous recovery.'}</h2></div>
        {workspace?.billing_status==='active' ? <PortalButton /> : <div className="plan-actions"><CheckoutButton priceKey="standard_monthly">Standard · €49/mo</CheckoutButton><CheckoutButton priceKey="standard_yearly">€490/yr</CheckoutButton><CheckoutButton priceKey="pro_monthly">Pro · €99/mo</CheckoutButton><CheckoutButton priceKey="pro_yearly">€990/yr</CheckoutButton></div>}
      </section>
      <section className="queue-panel"><div className="queue-head"><div><p className="eyebrow">RECOVERY QUEUE</p><h2>Highest-value leaks first.</h2></div></div>
        {list.length===0 ? <div className="empty"><div className="orb">0</div><h3>No findings yet.</h3><p>Import a CSV or connect a source to run the first scan.</p></div> : <div className="findings">{list.map(f=><article className={`finding ${f.status!=='open'?'closed':''}`} key={f.id}><div className="finding-top"><span className="tag">{f.finding_type.replaceAll('_',' ')}</span><span>{Math.round(Number(f.confidence)*100)}%</span></div><h3>{f.title}</h3><p className="counterparty">{f.counterparty}</p><strong className="amount">{money(f.amount,f.currency)}</strong><p>{f.explanation}</p><div className="next"><span>NEXT ACTION</span><b>{f.next_action}</b></div>{f.status==='open'&&<form action={updateFinding} className="actions"><input type="hidden" name="id" value={f.id}/><button name="status" value="snoozed">Snooze</button><button name="status" value="dismissed">Dismiss</button><button name="status" value="resolved">Resolved</button></form>}</article>)}</div>}
      </section>
    </main>
  </div>
}
