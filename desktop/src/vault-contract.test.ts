import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('local password vault security contract', () => {
  it('uses memory-hard key derivation and authenticated local encryption', () => {
    const vault = readRepoFile('desktop/src-tauri/src/vault.rs')

    expect(vault).toContain('Argon2::default()')
    expect(vault).toContain('XChaCha20Poly1305')
    expect(vault).toContain('VAULT_AAD')
    expect(vault).toContain('OsRng.fill_bytes')
    expect(vault).toContain('Zeroizing')
  })

  it('restricts the vault file on Unix and auto-locks', () => {
    const vault = readRepoFile('desktop/src-tauri/src/vault.rs')

    expect(vault).toContain('Permissions::from_mode(0o700)')
    expect(vault).toContain('Permissions::from_mode(0o600)')
    expect(vault).toContain('AUTO_LOCK_AFTER')
    expect(vault).toContain('state.key = None')
  })

  it('never stores vault secrets in frontend localStorage or scrapes browser credentials', () => {
    const app = readRepoFile('desktop/src/App.tsx')
    const vault = readRepoFile('desktop/src-tauri/src/vault.rs')

    expect(app).not.toContain('localStorage.setItem(\'cashpatch-vault')
    expect(vault).not.toContain('Login Data')
    expect(vault).not.toContain('Cookies')
    expect(vault).not.toContain('Chrome Safe Storage')
  })

  it('requires deliberate user entry and offers no autonomous login action', () => {
    const app = readRepoFile('desktop/src/App.tsx')

    expect(app).toContain('Only credentials you deliberately enter are stored')
    expect(app).toContain('CashPatch never scrapes browser passwords')
    expect(app).not.toContain('Autofill password')
    expect(app).not.toContain('Login automatically')
  })
})
