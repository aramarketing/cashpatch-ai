'use client'

import { useEffect, useMemo, useState } from 'react'

type Institution = {
  id: string
  name: string
  bic: string | null
  logo: string | null
  businessAccountsSupported: boolean | null
  corporateAccountsSupported: boolean | null
}

export default function BankingConnect() {
  const [country, setCountry] = useState('DE')
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading'|'ready'|'unconfigured'|'error'>('loading')
  const [connecting, setConnecting] = useState<string | null>(null)

  async function load() {
    setState('loading')
    try {
      const response = await fetch(`/api/banking/institutions?country=${encodeURIComponent(country)}`, {
        cache: 'no-store',
      })
      const data = await response.json()

      if (response.status === 503 && data.error === 'banking_not_configured') {
        setInstitutions([])
        setState('unconfigured')
        return
      }
      if (!response.ok) throw new Error(data.error ?? 'Could not load banks')

      setInstitutions(data.institutions ?? [])
      setState('ready')
    } catch {
      setInstitutions([])
      setState('error')
    }
  }

  useEffect(() => { load() }, [country])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return institutions
    return institutions.filter(bank =>
      bank.name.toLowerCase().includes(term) ||
      (bank.bic ?? '').toLowerCase().includes(term)
    )
  }, [institutions, query])

  async function connect(bank: Institution) {
    setConnecting(bank.id)
    try {
      const response = await fetch('/api/banking/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ institutionId: bank.id, country }),
      })
      const data = await response.json()
      if (!response.ok || !data.authorizationUrl) {
        throw new Error(data.error ?? 'Bank connection failed')
      }
      window.location.assign(data.authorizationUrl)
    } catch {
      setConnecting(null)
      setState('error')
    }
  }

  return <>
    <section className="review-only-banner">
      <div>
        <p className="eyebrow">ACCOUNT INFORMATION ONLY</p>
        <h2>Balances and transactions. Nothing else.</h2>
        <p>CashPatch never asks for payment-initiation permission. Authentication happens with the bank/Open-Banking provider, not inside CashPatch.</p>
      </div>
      <span className="review-lock">NO PAYMENTS</span>
    </section>

    <section className="bank-toolbar">
      <label>
        <span>Country</span>
        <select value={country} onChange={e => setCountry(e.target.value)}>
          <option value="DE">Germany</option>
          <option value="AT">Austria</option>
          <option value="NL">Netherlands</option>
          <option value="FR">France</option>
          <option value="ES">Spain</option>
          <option value="IT">Italy</option>
          <option value="IE">Ireland</option>
        </select>
      </label>
      <label className="bank-search">
        <span>Find your bank</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Bank name or BIC" />
      </label>
    </section>

    {state === 'loading' && <section className="queue-panel bank-state"><h2>Loading available banks…</h2></section>}

    {state === 'unconfigured' && <section className="queue-panel bank-state">
      <p className="eyebrow">CONNECTOR READY</p>
      <h2>Open Banking provider credentials are not installed yet.</h2>
      <p>The read-only connector is built, but the server still needs the provider account credentials before live banks can be shown.</p>
    </section>}

    {state === 'error' && <section className="queue-panel bank-state">
      <h2>Banking connection is temporarily unavailable.</h2>
      <p>No access was granted and no bank data was read.</p>
      <button className="source-button" onClick={load}>Try again</button>
    </section>}

    {state === 'ready' && <section className="bank-grid">
      {filtered.map(bank => <article className="bank-card" key={bank.id}>
        <div className="bank-identity">
          {bank.logo ? <img src={bank.logo} alt="" referrerPolicy="no-referrer" /> : <div className="bank-logo-fallback">B</div>}
          <div>
            <h3>{bank.name}</h3>
            {bank.bic && <small>{bank.bic}</small>}
          </div>
        </div>
        <div className="bank-flags">
          <span>Accounts</span><span>Balances</span><span>Transactions</span>
        </div>
        <button className="source-button" disabled={connecting === bank.id} onClick={() => connect(bank)}>
          {connecting === bank.id ? 'Opening bank…' : 'Connect read-only'}
        </button>
      </article>)}
      {filtered.length === 0 && <div className="empty"><h3>No matching bank found.</h3><p>Try a different search or country.</p></div>}
    </section>}
  </>
}
