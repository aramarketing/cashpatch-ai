import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('CashPatch desktop safety boundaries', () => {
  it('only exposes review-only non-writing cloud sources to the desktop client', () => {
    const route = readRepoFile('app/api/desktop/sources/route.ts')

    expect(route).toContain(".eq('permission_mode', 'review_only')")
    expect(route).toContain(".eq('external_write_allowed', false)")
    expect(route).toContain('reviewOnly: true')
  })

  it('fails closed when a future connector carries write-like scopes or capabilities', () => {
    const route = readRepoFile('app/api/desktop/sources/route.ts')

    expect(route).toContain('forbiddenMutationSignals')
    for (const signal of ['write', 'create', 'update', 'delete', 'send', 'manage', 'payment', 'payout', 'refund', 'transfer']) {
      expect(route).toContain(`'${signal}'`)
    }
    expect(route).toContain('isStrictlyReviewOnlySource')
    expect(route).toContain('safeSources = (sources ?? []).filter(isStrictlyReviewOnlySource)')
    expect(route).toContain("policy: 'default_deny_write_capabilities'")
    expect(route).toContain('blockedUnsafeSources')
  })

  it('requires active server entitlement before cloud sources or banking sync', () => {
    const sourcesRoute = readRepoFile('app/api/desktop/sources/route.ts')
    const bankingRoute = readRepoFile('app/api/desktop/banking/sync/route.ts')
    const desktopApp = readRepoFile('desktop/src/App.tsx')

    expect(sourcesRoute).toContain("admin.rpc('desktop_entitlement_check'")
    expect(sourcesRoute).toContain("error: 'entitlement_required'")
    expect(bankingRoute).toContain("admin.rpc('desktop_entitlement_check'")
    expect(bankingRoute).toContain("error: 'entitlement_required'")
    expect(desktopApp).toContain("if (phase !== 'ready') return")
  })

  it('refuses unsafe banking source connections', () => {
    const route = readRepoFile('app/api/desktop/banking/sync/route.ts')

    expect(route).toContain("source.permission_mode !== 'review_only'")
    expect(route).toContain('source.external_write_allowed !== false')
    expect(route).toContain("error: 'bank_source_not_available'")
  })

  it('keeps open banking limited to Account Information data', () => {
    const route = readRepoFile('app/api/desktop/banking/sync/route.ts')
    const provider = readRepoFile('lib/banking/gocardless.ts')

    expect(route).toContain("permissions: ['accounts:read','balances:read','transactions:read']")
    expect(route).toContain('externalWriteAllowed: false')
    expect(provider).toContain('/balances/')
    expect(provider).toContain('/transactions/')

    for (const forbidden of ['/payments/', '/payment-initiation/', '/transfers/', '/payouts/', '/refunds/']) {
      expect(provider).not.toContain(forbidden)
    }
  })

  it('keeps local monitoring behind explicit user-controlled permissions', () => {
    const backend = readRepoFile('desktop/src-tauri/src/lib.rs')
    const frontend = readRepoFile('desktop/src/App.tsx')

    expect(backend).toContain('approved_folder_set')
    expect(backend).toContain('approved_folder_clear')
    expect(frontend).toContain("title: 'Choose a folder CashPatch may review'")
    expect(frontend).toContain("invoke('approved_folder_clear')")
  })

  it('preserves local AI, autostart, notifications and close-to-tray controls', () => {
    const backend = readRepoFile('desktop/src-tauri/src/lib.rs')
    const frontend = readRepoFile('desktop/src/App.tsx')
    const notifications = readRepoFile('desktop/src/notifications.ts')

    expect(backend).toContain('local_ai::local_ai_models')
    expect(backend).toContain('!models.is_empty()')
    expect(backend).toContain('api.prevent_close()')
    expect(backend).toContain('window.hide()')
    expect(frontend).toContain('if (nextEnabled) await enable()')
    expect(frontend).toContain('else await disable()')
    expect(notifications).toContain('requestPermission()')
    expect(notifications).toContain('sendNotification({ title, body })')
  })
})
