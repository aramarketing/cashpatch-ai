import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appPath = fileURLToPath(new URL('./App.tsx', import.meta.url))
const appSource = readFileSync(appPath, 'utf8')

function blockedRefreshIntervalMs(source: string) {
  const blockedBranch = source.match(/if \(phase === 'blocked'\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  const intervalExpression = blockedBranch.match(/setInterval\(refreshEntitlement,\s*([^\)]+)\)/)?.[1]
  if (!intervalExpression) return null

  const compact = intervalExpression.replace(/\s+/g, '')
  if (/^\d+$/.test(compact)) return Number(compact)
  const multiplication = compact.match(/^(\d+)\*(\d+)$/)
  if (multiplication) return Number(multiplication[1]) * Number(multiplication[2])
  return null
}

describe('subscription entitlement refresh contract', () => {
  it('keeps an already-open blocked app polling fast enough to unlock without restart', () => {
    expect(appSource).toContain("if (phase === 'blocked')")
    expect(appSource).toContain('setInterval(refreshEntitlement')

    const intervalMs = blockedRefreshIntervalMs(appSource)
    expect(intervalMs).not.toBeNull()
    expect(intervalMs!).toBeGreaterThan(0)
    expect(intervalMs!).toBeLessThanOrEqual(15_000)
  })

  it('moves an entitled device directly from the entitlement check into the ready phase', () => {
    expect(appSource).toMatch(/if \(!status\.paired\) setPhase\('unpaired'\)/)
    expect(appSource).toMatch(/else if \(!status\.allowed\) setPhase\('blocked'\)/)
    expect(appSource).toMatch(/else setPhase\('ready'\)/)
  })

  it('does not start monitoring while blocked and provides an immediate manual recheck', () => {
    const effectStart = appSource.indexOf("if (phase === 'blocked')")
    const readyGuard = appSource.indexOf("if (phase !== 'ready') return", effectStart)
    const discovery = appSource.indexOf('refreshLocalDiscovery()', readyGuard)

    expect(effectStart).toBeGreaterThanOrEqual(0)
    expect(readyGuard).toBeGreaterThan(effectStart)
    expect(discovery).toBeGreaterThan(readyGuard)
    expect(appSource).toContain('onClick={refreshEntitlement}>Check subscription now</button>')
  })
})
