import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8')
const notificationSource = readFileSync(fileURLToPath(new URL('./notifications.ts', import.meta.url)), 'utf8')
const rustSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/lib.rs', import.meta.url)), 'utf8')
const scanSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/scan.rs', import.meta.url)), 'utf8')
const journalSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/scan_journal.rs', import.meta.url)), 'utf8')

describe('native desktop runtime contracts', () => {
  it('keeps the tray menu and close-to-tray behavior wired in the native shell', () => {
    expect(rustSource).toContain('TrayIconBuilder::new()')
    expect(rustSource).toContain('MenuItem::with_id(app, "open", "Open CashPatch"')
    expect(rustSource).toContain('MenuItem::with_id(app, "quit", "Quit CashPatch"')
    expect(rustSource).toContain('WindowEvent::CloseRequested')
    expect(rustSource).toContain('api.prevent_close()')
    expect(rustSource).toContain('window.hide()')
    expect(rustSource).toContain('app.exit(0)')
  })

  it('keeps autostart explicitly user-toggleable in both directions', () => {
    expect(appSource).toContain("import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'")
    expect(appSource).toContain('if (nextEnabled) await enable()')
    expect(appSource).toContain('else await disable()')
    expect(appSource).toContain('setAutostart(await isEnabled())')
    expect(rustSource).toContain('tauri_plugin_autostart::MacosLauncher::LaunchAgent')
  })

  it('keeps local folder access opt-in and removable', () => {
    expect(appSource).toContain("directory: true")
    expect(appSource).toContain("await invoke('approved_folder_set', { path: selected })")
    expect(appSource).toContain("await invoke('approved_folder_clear')")
    expect(rustSource).toContain('fn approved_folder_set(path: String)')
    expect(rustSource).toContain('fn approved_folder_clear()')
  })

  it('keeps native notification permission and send flow intact', () => {
    expect(notificationSource).toContain('isPermissionGranted')
    expect(notificationSource).toContain('requestPermission')
    expect(notificationSource).toContain('sendNotification({ title, body })')
    expect(appSource).toContain("notifyFinding('CashPatch alert test', 'Desktop notifications are working.')")
  })

  it('uses a no-prompt credential store only for ad-hoc macOS test builds', () => {
    expect(rustSource).toContain('CASHPATCH_ADHOC_TEST_BUILD')
    expect(rustSource).toContain('option_env!("CASHPATCH_ADHOC_TEST_BUILD") == Some("1")')
    expect(rustSource).toContain('.join("Application Support")')
    expect(rustSource).toContain('.join("CashPatch")')
    expect(rustSource).toContain('.join("device-session.json")')
    expect(rustSource).toContain('Permissions::from_mode(0o700)')
    expect(rustSource).toContain('Permissions::from_mode(0o600)')
    expect(rustSource).toContain('keyring_entry(name)?.set_password(value)')
  })

  it('detects supported local AI only through loopback endpoints', () => {
    expect(rustSource).toContain('local_ai::local_ai_models')
    expect(rustSource).toContain('!models.is_empty()')
    expect(rustSource).not.toContain('http://0.0.0.0:11434')
    expect(rustSource).not.toContain('http://0.0.0.0:1234')
  })

  it('persists active scan snapshots and exposes recovery only through explicit consent', () => {
    expect(scanSource).toContain('#[path = "scan_journal.rs"]')
    expect(scanSource).toContain('scan_journal::persist_snapshot(&snapshot, &roots)')
    expect(scanSource).toContain('recover_interrupted: Option<bool>')
    expect(scanSource).toContain('scan_journal::recovery_roots()?')
    expect(scanSource).toContain('Explicit scan consent is required')
    expect(journalSource).toContain('only after explicit confirmation')
    expect(journalSource).toContain('CashPatch restarts the same approved scope from the beginning')
  })
})
