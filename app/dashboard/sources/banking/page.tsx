import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BankingConnect from './BankingConnect'

export const dynamic = 'force-dynamic'

export default async function BankingPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) redirect('/login')

  return <div className="dashboard-shell">
    <aside>
      <div className="brand"><span className="logo">CP</span><strong>CashPatch</strong></div>
      <nav>
        <a href="/dashboard">Recovery queue</a>
        <a className="active" href="/dashboard/sources">Sources</a>
        <a href="/dashboard/reports">Reports</a>
      </nav>
    </aside>
    <main className="dashboard-main">
      <header className="dash-head source-head">
        <div>
          <p className="eyebrow">BANKING · REVIEW ONLY</p>
          <h1>Connect the account. Never the money.</h1>
          <p className="source-intro">CashPatch requests account-information access only: accounts, balances and transactions. It has no payment-initiation route and cannot transfer money.</p>
        </div>
      </header>
      <BankingConnect />
    </main>
  </div>
}
