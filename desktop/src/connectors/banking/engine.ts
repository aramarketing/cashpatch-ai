import type { BankTransaction, BankingFinding, ExpectedPayment } from './types'

const norm = (value?: string) =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()

const days = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000

const closeAmount = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= 0.02

const counterpartyScore = (a?: string, b?: string) => {
  const left = norm(a)
  const right = norm(b)
  if (!left || !right) return 0.5
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.9
  const aw = new Set(left.split(' '))
  const bw = new Set(right.split(' '))
  const overlap = [...aw].filter(x => bw.has(x)).length
  return overlap / Math.max(aw.size, bw.size, 1)
}

export function matchExpectedPayments(
  expected: ExpectedPayment[],
  transactions: BankTransaction[],
  now = new Date(),
): { findings: BankingFinding[]; matchedExpectedIds: Set<string> } {
  const findings: BankingFinding[] = []
  const matchedExpectedIds = new Set<string>()

  for (const item of expected) {
    const candidates = transactions
      .filter(t => t.status === 'booked')
      .filter(t => t.currency === item.currency)
      .filter(t => t.amount > 0)
      .filter(t => closeAmount(t.amount, item.amount))
      .filter(t => days(t.bookedAt, item.dueAt) <= 21)
      .map(t => ({
        tx: t,
        score: 0.65 + counterpartyScore(t.counterparty, item.counterparty) * 0.3,
      }))
      .sort((a, b) => b.score - a.score)

    if (candidates[0]?.score >= 0.75) {
      matchedExpectedIds.add(item.id)
      findings.push({
        id: `received:${item.id}:${candidates[0].tx.id}`,
        type: 'payment_received',
        title: `${item.amount.toFixed(2)} ${item.currency} payment found`,
        amount: item.amount,
        currency: item.currency,
        confidence: Math.min(candidates[0].score, 0.99),
        explanation: 'A booked bank transaction closely matches an expected payment.',
        evidence: [item.id, candidates[0].tx.id],
        recommendedAction: 'Review the match and reconcile it in the relevant business system.',
      })
      continue
    }

    const overdueDays = (now.getTime() - new Date(item.dueAt).getTime()) / 86_400_000
    if (overdueDays >= 3) {
      findings.push({
        id: `missing:${item.id}`,
        type: 'missing_expected_payment',
        title: `Expected ${item.amount.toFixed(2)} ${item.currency} has not arrived`,
        amount: item.amount,
        currency: item.currency,
        confidence: overdueDays >= 10 ? 0.94 : 0.86,
        explanation: `The expected payment is ${Math.floor(overdueDays)} days past due and no matching booked bank transaction was found.`,
        evidence: [item.id],
        recommendedAction: 'Review the invoice or customer conversation and decide whether to follow up.',
      })
    }
  }

  return { findings, matchedExpectedIds }
}

export function detectDuplicateCharges(transactions: BankTransaction[]): BankingFinding[] {
  const outgoing = transactions.filter(t => t.status === 'booked' && t.amount < 0)
  const findings: BankingFinding[] = []

  for (let i = 0; i < outgoing.length; i++) {
    for (let j = i + 1; j < outgoing.length; j++) {
      const a = outgoing[i]
      const b = outgoing[j]
      if (
        a.accountId === b.accountId &&
        a.currency === b.currency &&
        closeAmount(a.amount, b.amount) &&
        days(a.bookedAt, b.bookedAt) <= 3 &&
        counterpartyScore(a.counterparty, b.counterparty) >= 0.85
      ) {
        findings.push({
          id: `duplicate:${a.id}:${b.id}`,
          type: 'duplicate_bank_charge',
          title: 'Possible duplicate bank charge',
          amount: Math.abs(a.amount),
          currency: a.currency,
          confidence: 0.92,
          explanation: 'Two very similar outgoing transactions occurred within three days.',
          evidence: [a.id, b.id],
          recommendedAction: 'Review both transactions and contact the merchant or bank if one is not expected.',
        })
      }
    }
  }

  return findings
}

export function detectBankFees(transactions: BankTransaction[]): BankingFinding[] {
  const feeWords = ['gebühr', 'gebuehr', 'fee', 'entgelt', 'kontoführung', 'kontoentgelt', 'service charge']
  return transactions
    .filter(t => t.amount < 0)
    .filter(t => {
      const text = norm(`${t.counterparty ?? ''} ${t.description ?? ''}`)
      return feeWords.some(word => text.includes(norm(word)))
    })
    .map(t => ({
      id: `fee:${t.id}`,
      type: 'unexpected_bank_fee' as const,
      title: 'Bank fee detected',
      amount: Math.abs(t.amount),
      currency: t.currency,
      confidence: 0.88,
      explanation: 'The transaction description looks like a bank or account fee.',
      evidence: [t.id],
      recommendedAction: 'Review whether this fee is expected and compare it with previous periods.',
    }))
}

export function detectRecurringCostIncreases(transactions: BankTransaction[]): BankingFinding[] {
  const groups = new Map<string, BankTransaction[]>()

  for (const tx of transactions.filter(t => t.amount < 0 && t.status === 'booked')) {
    const key = `${tx.currency}:${norm(tx.counterparty)}`
    if (!norm(tx.counterparty)) continue
    const list = groups.get(key) ?? []
    list.push(tx)
    groups.set(key, list)
  }

  const findings: BankingFinding[] = []
  for (const list of groups.values()) {
    if (list.length < 3) continue
    list.sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime())
    const current = list.at(-1)!
    const previous = list.at(-2)!
    const currentAmount = Math.abs(current.amount)
    const previousAmount = Math.abs(previous.amount)
    if (previousAmount <= 0) continue
    const increase = (currentAmount - previousAmount) / previousAmount

    if (increase >= 0.15 && days(current.bookedAt, previous.bookedAt) >= 20) {
      findings.push({
        id: `increase:${previous.id}:${current.id}`,
        type: 'recurring_cost_increase',
        title: `Recurring cost increased ${Math.round(increase * 100)}%`,
        amount: currentAmount - previousAmount,
        currency: current.currency,
        confidence: 0.84,
        explanation: `The latest payment to ${current.counterparty ?? 'the same counterparty'} is materially higher than the previous one.`,
        evidence: [previous.id, current.id],
        recommendedAction: 'Review the subscription or supplier contract and confirm the price increase.',
      })
    }
  }

  return findings
}
