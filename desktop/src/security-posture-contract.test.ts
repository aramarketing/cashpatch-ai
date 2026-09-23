import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8')
const rustSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/security_posture.rs', import.meta.url)), 'utf8')
const scanSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/scan.rs', import.meta.url)), 'utf8')
const libSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/lib.rs', import.meta.url)), 'utf8')

describe('local OS security posture contract', () => {
  it('keeps posture inspection local and read-only', () => {
    expect(rustSource).toContain('pub fn security_posture_scan()')
    expect(rustSource).toContain('CashPatch will not change')
    expect(rustSource).not.toContain('Command::new')
    expect(rustSource).not.toContain('powershell')
    expect(rustSource).not.toContain('osascript')
  })

  it('does not read Windows autologon credentials while checking whether autologon is enabled', () => {
    expect(rustSource).toContain('AutoAdminLogon')
    expect(rustSource).not.toContain('DefaultPassword')
    expect(rustSource).not.toContain('DefaultUserName')
  })

  it('surfaces security warnings in full-scan findings', () => {
    expect(scanSource).toContain('security_posture.checks.into_iter().filter')
    expect(scanSource).toContain('security_posture:')
    expect(scanSource).toContain('security_checks_seen')
  })

  it('registers and exposes the posture review in the dashboard', () => {
    expect(libSource).toContain('security_posture::security_posture_scan')
    expect(appSource).toContain("invoke<SecurityPostureReport>('security_posture_scan')")
    expect(appSource).toContain('Operating-system security posture')
  })
})
