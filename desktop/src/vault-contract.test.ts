import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('local password vault security contract', () => {
  it('uses explicit Argon2id parameters and authenticated local encryption', () => {
    const vault = readRepoFile('desktop/src-tauri/src/vault.rs')

    expect(vault).toContain('Algorithm::Argon2id')
    expect(vault).toContain('Version::V0x13')
    expect(vault).toContain('ARGON2_MEMORY_KIB: u32 = 64 * 1024')
    expect(vault).toContain('ARGON2_ITERATIONS: u32 = 3')
    expect(vault).toContain('ARGON2_PARALLELISM: u32 = 1')
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

  it('prepares native clipboard copy with a short expiry and does not erase newer clipboard data', () => {
    const vault = readRepoFile('desktop/src-tauri/src/vault.rs')

    expect(vault).toContain('CLIPBOARD_CLEAR_AFTER: Duration = Duration::from_secs(30)')
    expect(vault).toContain('pub fn vault_copy_secret')
    expect(vault).toContain('arboard::Clipboard::new()')
    expect(vault).toContain('thread::sleep(CLIPBOARD_CLEAR_AFTER)')
    expect(vault).toContain('clipboard.get_text().ok().as_deref() == Some(secret_for_clear.as_str())')
    expect(vault).toContain('clipboard.set_text(String::new())')
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
