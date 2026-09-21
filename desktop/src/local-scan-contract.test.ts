import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('local scan consent and privacy contracts', () => {
  it('requires two separate consent gates before deep scanning', () => {
    const app = readRepoFile('desktop/src/App.tsx')
    const scan = readRepoFile('desktop/src-tauri/src/scan.rs')

    expect(app).toContain('I consent to a local read-only Quick Scan')
    expect(app).toContain('I confirm the local read-only Full Scan')
    expect(scan).toContain('Explicit scan consent is required')
    expect(scan).toContain('Explicit Full Scan confirmation is required')
    expect(scan).toContain('Full Scan is available only after Quick Scan completes')
  })

  it('exposes pause, resume and cancel without auto-resume on startup', () => {
    const app = readRepoFile('desktop/src/App.tsx')
    const scan = readRepoFile('desktop/src-tauri/src/scan.rs')

    expect(app).toContain("invoke('scan_pause')")
    expect(app).toContain("invoke('scan_resume')")
    expect(app).toContain("invoke('scan_cancel')")
    expect(scan).toContain('pub fn scan_pause()')
    expect(scan).toContain('pub fn scan_resume()')
    expect(scan).toContain('pub fn scan_cancel()')
    expect(app).toContain('const startQuickScan = async () =>')
    expect(app).toContain('onClick={startQuickScan}')
  })

  it('never starts content scans from a background timer', () => {
    const app = readRepoFile('desktop/src/App.tsx')

    expect(app).not.toContain('setInterval(refreshBusinessSources')
    expect(app).not.toContain('setInterval(startQuickScan')
    expect(app).not.toContain('setInterval(startFullScan')
    expect(app).toContain('onClick={startQuickScan}')
    expect(app).toContain('onClick={startFullScan}')
  })

  it('does not expose the legacy cloud banking content sync command to the desktop UI', () => {
    const backend = readRepoFile('desktop/src-tauri/src/lib.rs')
    const app = readRepoFile('desktop/src/App.tsx')

    const handler = backend.slice(backend.indexOf('tauri::generate_handler!['))
    expect(handler).not.toContain('banking_sync,')
    expect(app).not.toContain("invoke<unknown>('banking_sync'")
  })

  it('keeps desktop cloud egress default-deny and local AI loopback-only', () => {
    const egress = readRepoFile('desktop/src-tauri/src/egress.rs')
    expect(egress).toContain('cashpatch-ai.vercel.app')
    expect(egress).toContain('Blocked network destination')
    expect(egress).toContain('"127.0.0.1" | "localhost" | "::1"')
    expect(egress).toContain('Local AI must use a loopback address')
  })
})
