import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('native system inventory privacy contract', () => {
  it('keeps inventory implemented with read-only native APIs instead of shell automation', () => {
    const inventory = readRepoFile('desktop/src-tauri/src/inventory.rs')

    expect(inventory).toContain('System::new_all()')
    expect(inventory).toContain('Disks::new_with_refreshed_list()')
    expect(inventory).toContain('Networks::new_with_refreshed_list()')
    expect(inventory).toContain('processes()')
    expect(inventory).toContain('installed_apps')
    expect(inventory).toContain('autostart_entries')
    expect(inventory).not.toContain('std::process::Command')
    expect(inventory).not.toContain('powershell')
    expect(inventory).not.toContain('osascript')
    expect(inventory).not.toContain('cmd.exe')
  })

  it('caps inventory detail so discovery cannot explode memory or UI payloads', () => {
    const inventory = readRepoFile('desktop/src-tauri/src/inventory.rs')

    expect(inventory).toContain('MAX_PROCESS_NAMES: usize = 250')
    expect(inventory).toContain('MAX_APP_NAMES: usize = 500')
    expect(inventory).toContain('MAX_AUTOSTART_ENTRIES: usize = 250')
  })

  it('does not collect system inventory automatically at process startup', () => {
    const main = readRepoFile('desktop/src-tauri/src/main.rs')

    expect(main).toContain('mod inventory;')
    expect(main).not.toContain('collect_system_inventory()')
    expect(main).toContain('cashpatch_desktop_lib::run()')
  })
})
