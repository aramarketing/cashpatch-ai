import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('deep audit native wiring', () => {
  it('registers system inventory and AI conversation review as explicit user-invoked native commands', () => {
    const backend = readRepoFile('desktop/src-tauri/src/lib.rs')
    const review = readRepoFile('desktop/src-tauri/src/conversation_review.rs')

    expect(backend).toContain('mod inventory;')
    expect(backend).toContain('mod conversations;')
    expect(backend).toContain('mod conversation_review;')
    expect(backend).toContain('inventory::system_inventory')
    expect(backend).toContain('conversation_review::conversation_review_import')
    expect(review).toContain('Explicit consent is required before reviewing an AI conversation export')
  })

  it('cancels an active scan before hiding the window so scans never continue invisibly in the tray', () => {
    const backend = readRepoFile('desktop/src-tauri/src/lib.rs')
    const closeHandler = backend.slice(backend.indexOf('.on_window_event'))

    expect(closeHandler).toContain('WindowEvent::CloseRequested')
    expect(closeHandler).toContain('scan::scan_cancel()')
    expect(closeHandler).toContain('window.hide()')
    expect(closeHandler.indexOf('scan::scan_cancel()')).toBeLessThan(closeHandler.indexOf('window.hide()'))
  })

  it('keeps inventory and conversation review read-only and local', () => {
    const inventory = readRepoFile('desktop/src-tauri/src/inventory.rs')
    const conversations = readRepoFile('desktop/src-tauri/src/conversations.rs')

    expect(inventory).not.toContain('std::process::Command')
    expect(inventory).not.toContain('powershell')
    expect(inventory).not.toContain('osascript')
    expect(conversations).toContain('load_user_selected_export')
    expect(conversations).not.toContain('reqwest')
    expect(conversations).not.toContain('http://')
    expect(conversations).not.toContain('https://')
  })
})
