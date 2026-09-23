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
    expect(egress).toContain('host.eq_ignore_ascii_case("localhost")')
    expect(egress).toContain('.parse::<IpAddr>()')
    expect(egress).toContain('.map(|address| address.is_loopback())')
    expect(egress).toContain('http://127.0.0.1:11434/api/tags')
    expect(egress).toContain('http://[::1]:8080/health')
    expect(egress).toContain('Local AI must use a loopback address')
  })

  it('includes native system scope in Quick Scan before Full Scan confirmation', () => {
    const app = readRepoFile('desktop/src/App.tsx')
    const scan = readRepoFile('desktop/src-tauri/src/scan.rs')

    expect(scan).toContain('let inventory = crate::inventory::collect_system_inventory()')
    expect(scan).toContain('installed_software_seen: inventory.installed_software.len() as u64')
    expect(scan).toContain('running_processes_seen: inventory.running_processes.len() as u64')
    expect(scan).toContain('network_interfaces_seen: inventory.network_interfaces.len() as u64')
    expect(scan).toContain('autostart_entries_seen: inventory.autostart_entries.len() as u64')
    expect(app).toContain('installedSoftwareSeen')
    expect(app).toContain('runningProcessesSeen')
    expect(app).toContain('networkInterfacesSeen')
    expect(app).toContain('autostartEntriesSeen')
    expect(app).toContain('installed programs')
    expect(app).toContain('running processes')
    expect(app).toContain('autostart entries')
    expect(app).toContain('network interfaces mapped')
    expect(app).toContain('connected review-only online sources')
    expect(app).toContain('local AI runtimes available')
  })

  it('explains confidence and possible financial impact for every local finding', () => {
    const app = readRepoFile('desktop/src/App.tsx')
    const scan = readRepoFile('desktop/src-tauri/src/scan.rs')

    expect(scan).toContain('struct LocalFindingView')
    expect(scan).toContain('confidence: u8')
    expect(scan).toContain('financial_impact: String')
    expect(scan).toContain('fn finding_confidence(finding: &LocalFinding) -> u8')
    expect(scan).toContain('fn finding_financial_impact(finding: &LocalFinding) -> String')
    expect(scan).toContain('- Possible financial impact: {}')
    expect(app).toContain('financialImpact: string')
    expect(app).toContain('Why this stands out:')
    expect(app).toContain('Possible financial impact:')
    expect(app).toContain('finding.confidence}%')
  })

  it('surfaces crash-safe recovery and local scan history without automatic resume', () => {
    const app = readRepoFile('desktop/src/App.tsx')
    const scan = readRepoFile('desktop/src-tauri/src/scan.rs')
    const journal = readRepoFile('desktop/src-tauri/src/scan_journal.rs')
    const backend = readRepoFile('desktop/src-tauri/src/lib.rs')

    expect(app).toContain('Interrupted scan found')
    expect(app).toContain('Restart the same approved scope locally')
    expect(app).toContain("recoverInterrupted: true")
    expect(app).toContain('LOCAL SCAN HISTORY')
    expect(scan).toContain('pub fn scan_discard_recovery()')
    expect(scan).toContain('pub fn scan_clear_history()')
    expect(journal).toContain('MAX_HISTORY_ENTRIES: usize = 50')
    expect(journal).toContain('Permissions::from_mode(0o600)')
    expect(backend).toContain('scan::scan_discard_recovery,')
    expect(backend).toContain('scan::scan_clear_history,')
  })
})
