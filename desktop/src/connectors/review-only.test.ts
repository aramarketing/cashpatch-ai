import { describe, expect, it } from 'vitest'
import {
  REVIEW_ONLY_CONNECTORS,
  assertReviewOnlyCapability,
  assertReviewOnlyManifest,
  manifestForConnector,
  type ReviewOnlyConnectorManifest,
} from './review-only'

describe('review-only connector security boundary', () => {
  it('accepts the complete built-in connector catalog as read-only', () => {
    expect(REVIEW_ONLY_CONNECTORS.length).toBeGreaterThanOrEqual(8)
    for (const connector of REVIEW_ONLY_CONNECTORS) {
      expect(assertReviewOnlyManifest(connector)).toBe(connector)
      expect(connector.permissionMode).toBe('review_only')
      expect(connector.externalWriteAllowed).toBe(false)
      expect(connector.capabilities.every(capability => capability.endsWith('.read'))).toBe(true)
    }
  })

  it.each([
    'mail.send',
    'files.write',
    'crm.update',
    'projects.create',
    'commerce.refund',
    'finance.payment.initiate',
    'finance.transfer',
    'finance.payout',
    'browser.cookies.upload',
  ])('rejects external mutation capability %s', capability => {
    expect(() => assertReviewOnlyCapability(capability)).toThrow()
  })

  it('makes the banking connector Account-Information-only', () => {
    const banking = manifestForConnector('banking-ais')
    expect(banking).not.toBeNull()
    expect(banking?.capabilities).toEqual([
      'finance.accounts.read',
      'finance.balances.read',
      'finance.transactions.read',
    ])
    expect(banking?.capabilities.some(capability => /payment|transfer|refund|payout|initiate/.test(capability))).toBe(false)
  })

  it('rejects a manifest that tries to turn on external writes', () => {
    const unsafe = {
      key: 'unsafe',
      displayName: 'Unsafe connector',
      category: 'crm',
      capabilities: ['crm.read'],
      permissionMode: 'review_only',
      externalWriteAllowed: true,
    } as unknown as ReviewOnlyConnectorManifest

    expect(() => assertReviewOnlyManifest(unsafe)).toThrow('may not enable external writes')
  })

  it('rejects empty connector capability declarations', () => {
    const empty = {
      key: 'empty',
      displayName: 'Empty connector',
      category: 'email',
      capabilities: [],
      permissionMode: 'review_only',
      externalWriteAllowed: false,
    } satisfies ReviewOnlyConnectorManifest

    expect(() => assertReviewOnlyManifest(empty)).toThrow('at least one read capability')
  })
})
