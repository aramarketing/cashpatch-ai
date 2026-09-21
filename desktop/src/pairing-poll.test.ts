import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appPath = fileURLToPath(new URL('./App.tsx', import.meta.url))
const appSource = readFileSync(appPath, 'utf8')

describe('desktop pairing polling contract', () => {
  it('does not start a recurring poll after the first consume already paired the device', () => {
    expect(appSource).toContain("const initialState = await pollPairing()")
    expect(appSource).toContain("if (initialState !== 'pending') return")

    const initialPoll = appSource.indexOf('const initialState = await pollPairing()')
    const pendingGuard = appSource.indexOf("if (initialState !== 'pending') return", initialPoll)
    const recurringPoll = appSource.indexOf('pollRef.current = window.setInterval', pendingGuard)

    expect(initialPoll).toBeGreaterThanOrEqual(0)
    expect(pendingGuard).toBeGreaterThan(initialPoll)
    expect(recurringPoll).toBeGreaterThan(pendingGuard)
  })

  it('clears an active recurring poll as soon as pairing completes or expires', () => {
    expect(appSource).toContain("if (state !== 'pending' && pollRef.current)")
    expect(appSource).toContain('window.clearInterval(pollRef.current)')
    expect(appSource).toContain('pollRef.current = null')
  })
})
