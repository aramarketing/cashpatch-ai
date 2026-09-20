export type BankAccount = {
  id: string
  iban?: string
  name?: string
  currency: string
  balance?: number
}

export type BankTransaction = {
  id: string
  accountId: string
  bookedAt: string
  amount: number
  currency: string
  counterparty?: string
  description?: string
  status: 'booked' | 'pending'
}

export type ExpectedPayment = {
  id: string
  reference?: string
  counterparty?: string
  amount: number
  currency: string
  dueAt: string
  source: 'invoice' | 'stripe' | 'crm' | 'email' | 'manual'
}

export type BankingFindingType =
  | 'missing_expected_payment'
  | 'duplicate_bank_charge'
  | 'recurring_cost_increase'
  | 'unexpected_bank_fee'
  | 'payment_received'
  | 'cash_drop'

export type BankingFinding = {
  id: string
  type: BankingFindingType
  title: string
  amount: number
  currency: string
  confidence: number
  explanation: string
  evidence: string[]
  recommendedAction: string
}

export interface ReadOnlyBankingConnector {
  readonly provider: string
  readonly permissionMode: 'review_only'
  listAccounts(): Promise<BankAccount[]>
  listTransactions(accountId: string, from: string, to: string): Promise<BankTransaction[]>
  getBalances(accountId: string): Promise<{ current?: number; available?: number; currency: string }>
}
