import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readNormalized(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
}

const appSource = readNormalized('./App.tsx')
const rustSource = readNormalized('../src-tauri/src/lib.rs')
const scanSource = readNormalized('../src-tauri/src/scan.rs')

describe('foreground-only scan contract', () => {
  it('requires explicit consent before Quick Scan and a second confirmation before Full Scan', () => {
    expect(appSource).toContain('if (!quickConsent) return')
    expect(appSource).toContain("invoke<string>('quick_scan_start', { consent: true, extraRoots, recoverInterrupted: false })")
    expect(appSource).toContain('if (!fullConsent || !scanSnapshot?.scanId) return')
    expect(appSource).toContain("invoke('full_scan_start', { scanId: scanSnapshot.scanId, consent: true })")
    expect(scanSource).toContain('if !consent {\n    return Err("Explicit scan consent is required".to_string());\n  }')
    expect(scanSource).toContain('if !consent {\n    return Err("Explicit Full Scan confirmation is required".to_string());\n  }')
    expect(scanSource).toContain('if state.snapshot.phase != "awaiting_full_confirmation"')
  })

  it('never auto-starts a scan from desktop setup or autostart', () => {
    const setupBlock = rustSource.slice(rustSource.indexOf('.setup(|app|'), rustSource.indexOf('.on_window_event'))
    expect(setupBlock).not.toContain('quick_scan_start(')
    expect(setupBlock).not.toContain('full_scan_start(')
    expect(setupBlock).not.toContain('scan_resume(')
    expect(appSource).toContain('if (nextEnabled) await enable()')
    expect(appSource).toContain('else await disable()')
  })

  it('cancels active scanning before the main window is hidden', () => {
    const closeHandler = rustSource.slice(rustSource.indexOf('.on_window_event'), rustSource.indexOf('.invoke_handler'))
    expect(closeHandler).toContain('WindowEvent::CloseRequested')
    expect(closeHandler).toContain('let _ = scan::scan_cancel();')
    expect(closeHandler).toContain('api.prevent_close();')
    expect(closeHandler).toContain('window.hide()')
    expect(closeHandler.indexOf('scan::scan_cancel()')).toBeLessThan(closeHandler.indexOf('window.hide()'))
  })

  it('requires fresh user confirmation before recovery can restart interrupted scope', () => {
    expect(appSource).toContain('if (!recoveryConsent || !scanRecovery?.available) return')
    expect(appSource).toContain("invoke<string>('quick_scan_start', { consent: true, extraRoots: [], recoverInterrupted: true })")
    expect(scanSource).toContain('scan_journal::recovery_roots()?')
    expect(scanSource).not.toContain('scan_journal::recovery_roots().unwrap')
  })

  it('keeps pause, resume and cancel as explicit local scan controls', () => {
    expect(appSource).toContain("if (scanSnapshot.paused) await invoke('scan_resume')")
    expect(appSource).toContain("else await invoke('scan_pause')")
    expect(appSource).toContain("await invoke('scan_cancel')")
    expect(scanSource).toContain('pub fn scan_pause()')
    expect(scanSource).toContain('pub fn scan_resume()')
    expect(scanSource).toContain('pub fn scan_cancel()')
  })
})
