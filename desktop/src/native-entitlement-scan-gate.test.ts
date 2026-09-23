import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rustSource = readFileSync(
  fileURLToPath(new URL('../src-tauri/src/lib.rs', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n')

const scanSource = readFileSync(
  fileURLToPath(new URL('../src-tauri/src/scan.rs', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n')

describe('native entitlement scan gate', () => {
  it('requires an active paired entitlement before Quick Scan and Full Scan enter the scanner', () => {
    expect(rustSource).toContain('async fn require_active_entitlement(app: &tauri::AppHandle) -> Result<(), String>')
    expect(rustSource).toContain('let status = entitlement_check(app.clone()).await?;')
    expect(rustSource).toContain('if !status.paired')
    expect(rustSource).toContain('if !status.allowed')

    const quick = rustSource.slice(
      rustSource.indexOf('async fn quick_scan_start('),
      rustSource.indexOf('async fn full_scan_start('),
    )
    expect(quick).toContain('require_active_entitlement(&app).await?;')
    expect(quick).toContain('scan::quick_scan_start(app, consent, extra_roots, recover_interrupted)')
    expect(quick.indexOf('require_active_entitlement')).toBeLessThan(quick.indexOf('scan::quick_scan_start'))

    const full = rustSource.slice(
      rustSource.indexOf('async fn full_scan_start('),
      rustSource.indexOf('async fn cloud_sources('),
    )
    expect(full).toContain('require_active_entitlement(&app).await?;')
    expect(full).toContain('scan::full_scan_start(app, scan_id, consent)')
    expect(full.indexOf('require_active_entitlement')).toBeLessThan(full.indexOf('scan::full_scan_start'))
  })

  it('exposes only the guarded scan entrypoints through the Tauri invoke handler', () => {
    const handler = rustSource.slice(
      rustSource.indexOf('.invoke_handler(tauri::generate_handler!['),
      rustSource.indexOf('.run(tauri::generate_context!())'),
    )
    expect(handler).toContain('quick_scan_start,')
    expect(handler).toContain('full_scan_start,')
    expect(handler).not.toContain('scan::quick_scan_start')
    expect(handler).not.toContain('scan::full_scan_start')
  })

  it('keeps the scan engine entrypoints internal so Tauri cannot register an unchecked duplicate command', () => {
    expect(scanSource).toContain('pub fn quick_scan_start(')
    expect(scanSource).toContain('pub fn full_scan_start(')
    expect(scanSource).not.toContain('#[tauri::command]\npub fn quick_scan_start(')
    expect(scanSource).not.toContain('#[tauri::command]\npub fn full_scan_start(')
  })
})
