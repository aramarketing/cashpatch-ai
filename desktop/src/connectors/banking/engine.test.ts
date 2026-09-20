import { describe, expect, it } from 'vitest'
import {
  analyzeBankTransactions,
  detectBankFees,
  detectDuplicateCharges,
  detectRecurringCostIncreases,
  normalizeOpenBankingSync,
} from './engine'
import type { BankTransaction } from './types'

const tx = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  accountId: overrides.accountId ?? 'acc-1',
  bookedAt: overrides.bookedAt ?? '2026-09-01',
  amount: overrides.amount ?? -20,
  currency: overrides.currency ?? 'EUR',
  counterparty: overrides.counterparty ?? 'Example GmbH',
  description: overrides.description ?? '',
  status: overrides.status ?? 'booked',
})

describe('banking detector', () => {
  it('normalizes PSD2 transactions without changing sign or currency', () => {
    const result = normalizeOpenBankingSync({
      accounts: [{
        accountId: 'acc-1',
        transactions: {
          transactions: {
            booked: [{
              transactionId: 't-1',
              bookingDate: '2026-09-12',
              transactionAmount: { amount: '-49.00', currency: 'EUR' },
              creditorName: 'Software GmbH',
              remittanceInformationUnstructured: 'Monthly subscription',
            }],
          },
        },
      }],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 't-1',
      accountId: 'acc-1',
      amount: -49,
      currency: 'EUR',
      counterparty: 'Software GmbH',
      status: 'booked',
    })
  })

  it('detects a likely duplicate outgoing charge', () => {
    const findings = detectDuplicateCharges([
      tx({ id: 'a', bookedAt: '2026-09-10', amount: -129, counterparty: 'Vendor AG' }),
      tx({ id: 'b', bookedAt: '2026-09-11', amount: -129, counterparty: 'Vendor AG' }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('duplicate_bank_charge')
  })

  it('does not flag same amount from unrelated counterparties as duplicate', () => {
    const findings = detectDuplicateCharges([
      tx({ id: 'a', bookedAt: '2026-09-10', amount: -129, counterparty: 'Vendor AG' }),
      tx({ id: 'b', bookedAt: '2026-09-11', amount: -129, counterparty: 'Other Company' }),
    ])

    expect(findings).toHaveLength(0)
  })

  it('detects obvious bank fees', () => {
    const findings = detectBankFees([
      tx({ id: 'fee', amount: -12.5, counterparty: 'Bank', description: 'Kontoführungsgebühr September' }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('unexpected_bank_fee')
  })

  it('detects a material recurring cost increase', () => {
    const findings = detectRecurringCostIncreases([
      tx({ id: 'm1', bookedAt: '2026-06-01', amount: -100, counterparty: 'SaaS GmbH' }),
      tx({ id: 'm2', bookedAt: '2026-07-01', amount: -100, counterparty: 'SaaS GmbH' }),
      tx({ id: 'm3', bookedAt: '2026-08-01', amount: -130, counterparty: 'SaaS GmbH' }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('recurring_cost_increase')
    expect(findings[0].amount).toBe(30)
  })

  it('combines bank findings locally', () => {
    const findings = analyzeBankTransactions([
      tx({ id: 'a', bookedAt: '2026-09-10', amount: -99, counterparty: 'Vendor AG' }),
      tx({ id: 'b', bookedAt: '2026-09-11', amount: -99, counterparty: 'Vendor AG' }),
      tx({ id: 'fee', bookedAt: '2026-09-12', amount: -5, counterparty: 'Bank', description: 'Service fee' }),
    ])

    expect(findings.some(f => f.type === 'duplicate_bank_charge')).toBe(true)
    expect(findings.some(f => f.type === 'unexpected_bank_fee')).toBe(true)
  })
})
