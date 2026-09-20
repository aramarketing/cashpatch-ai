const BASE_URL = 'https://bankaccountdata.gocardless.com'

type TokenCache = {
  access: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

function config() {
  const secretId = process.env.GOCARDLESS_BANK_SECRET_ID
  const secretKey = process.env.GOCARDLESS_BANK_SECRET_KEY
  if (!secretId || !secretKey) {
    throw new Error('Open Banking provider is not configured')
  }
  return { secretId, secretKey }
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.access

  const { secretId, secretKey } = config()
  const response = await fetch(`${BASE_URL}/api/v2/token/new/`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      secret_id: secretId,
      secret_key: secretKey,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Open Banking token request failed: ${response.status}`)
  }

  const json = await response.json() as {
    access?: string
    access_expires?: number
  }

  if (!json.access) throw new Error('Open Banking provider returned no access token')

  tokenCache = {
    access: json.access,
    expiresAt: Date.now() + Math.max(60, Number(json.access_expires ?? 86400)) * 1000,
  }
  return tokenCache.access
}

async function providerFetch<T>(path: string, init: RequestInit = {}) {
  const token = await accessToken()
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Open Banking API failed: ${response.status} ${text.slice(0, 400)}`)
  }

  return response.json() as Promise<T>
}

export type Institution = {
  id: string
  name: string
  bic?: string
  logo?: string
  countries?: string[]
  business_accounts_supported?: boolean
  corporate_accounts_supported?: boolean
  transaction_total_days?: string
}

export type Requisition = {
  id: string
  status: string | { short?: string; long?: string }
  institution_id: string
  reference?: string
  accounts: string[]
  link: string
  created?: string
}

export async function listInstitutions(country: string) {
  const code = country.toUpperCase().slice(0, 2)
  return providerFetch<Institution[]>(`/api/v2/institutions/?country=${encodeURIComponent(code)}`)
}

export async function createRequisition(input: {
  institutionId: string
  redirect: string
  reference: string
  userLanguage?: string
}) {
  return providerFetch<Requisition>('/api/v2/requisitions/', {
    method: 'POST',
    body: JSON.stringify({
      redirect: input.redirect,
      institution_id: input.institutionId,
      reference: input.reference,
      user_language: (input.userLanguage ?? 'DE').toUpperCase(),
      account_selection: true,
      redirect_immediate: false,
    }),
  })
}

export async function getRequisition(id: string) {
  return providerFetch<Requisition>(`/api/v2/requisitions/${encodeURIComponent(id)}/`)
}

export async function getAccountMetadata(id: string) {
  return providerFetch<{
    id: string
    iban?: string
    owner_name?: string
    name?: string
    institution_id?: string
    status?: string
  }>(`/api/v2/accounts/${encodeURIComponent(id)}/`)
}

export async function getBalances(id: string) {
  return providerFetch<{
    balances?: Array<{
      balanceAmount?: { amount?: string; currency?: string }
      balanceType?: string
      referenceDate?: string
    }>
  }>(`/api/v2/accounts/${encodeURIComponent(id)}/balances/`)
}

export async function getTransactions(id: string, from?: string, to?: string) {
  const params = new URLSearchParams()
  if (from) params.set('date_from', from)
  if (to) params.set('date_to', to)
  const suffix = params.size ? `?${params.toString()}` : ''
  return providerFetch<{
    transactions?: {
      booked?: unknown[]
      pending?: unknown[]
    }
    last_updated?: string
  }>(`/api/v2/accounts/${encodeURIComponent(id)}/transactions/${suffix}`)
}

export function bankingConfigured() {
  return Boolean(process.env.GOCARDLESS_BANK_SECRET_ID && process.env.GOCARDLESS_BANK_SECRET_KEY)
}
