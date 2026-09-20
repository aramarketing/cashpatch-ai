# CashPatch Build Status — 2026-09-21

## Production backend

- GitHub repository: `aramarketing/cashpatch-ai`, branch `main`
- Vercel project: `cashpatch-ai`
- Production deployment is active and `/api/health` returns HTTP 200
- Supabase project: `cashpatch-ai` in `eu-central-1`, status `ACTIVE_HEALTHY`
- Stripe is connected in test mode; the health endpoint confirms Supabase, Stripe and the Stripe webhook secret are configured
- Server secrets remain environment-only and are not committed to the repository

## Desktop application

CashPatch has a Tauri 2 desktop client for macOS and Windows. Implemented desktop behavior includes:

- secure browser-approved device pairing
- OS-keyring storage for pairing/device credentials
- server-authoritative paid entitlement checks
- tray/menu-bar operation; closing the main window hides it instead of terminating the watchdog
- optional autostart using the Tauri autostart plugin
- local AI discovery for Ollama and LM Studio
- supported-app discovery on macOS and Windows
- explicit local-folder permission selection
- native desktop notifications
- cloud-source discovery behind device entitlement
- local banking anomaly analysis and findings

## Review-only security boundary

CashPatch is review-only by design.

- External connector capabilities such as write, create, update, delete, send, execute, click, type, upload, task/record mutation, charge, refund, transfer and payout are explicitly forbidden.
- Provider-facing review-only fetches permit only `GET` and `HEAD`.
- Desktop cloud sources are used only when the server reports `permission_mode = review_only` and `external_write_allowed = false`.
- Banking is Account Information only: account metadata, balances and transactions may be read for analysis. Payment initiation, transfers and other bank write operations are forbidden.
- Local folders are opt-in and are not available until the user explicitly chooses one.

## Desktop CI

`Desktop CI` runs natively on both `macos-latest` and `windows-latest` and verifies:

1. desktop tests
2. frontend production build
3. platform icon generation
4. Rust/Tauri backend with `cargo check`

The current `main` desktop CI run for commit `290df1397af6d13c5376720f7b79dcd0f09ae022` passed on both macOS and Windows.

## Test installers

The `Desktop Test Installers` workflow builds unsigned native test installers and uploads platform artifacts with SHA-256 checksums.

A fully successful installer proof run (`35541317729`, commit `9e4c84457957ef4e2a73668ce2046a7a2ee572b1`) produced and smoke-tested both platforms:

- Windows: `CashPatch_0.1.0_x64-setup.exe` plus MSI bundle. The workflow verified the PE header, silently installed the NSIS package, confirmed the Windows installed-app/uninstaller registration and cleaned up the test installation.
- macOS: `CashPatch_0.1.0_aarch64.dmg`. The workflow ran `hdiutil verify`, mounted the DMG read-only, found the `.app`, validated `Info.plist`, and verified that the bundled executable is a Mach-O executable.

The successful artifacts are retained by GitHub Actions for 14 days. Later documentation-only desktop changes trigger a fresh native rebuild without changing the packaged runtime behavior.

## Unsigned-test limitation

These are internal QA installers, not signed production releases.

- Windows may show Microsoft Defender SmartScreen / unknown-publisher warnings.
- macOS may require the normal explicit-open flow because the app is not Developer ID signed or notarized.
- No paid code-signing certificate or Apple notarization credentials are used in the test workflow.

Production distribution should add platform signing/notarization later through protected repository/environment secrets.

## Supabase security state

All current application tables in the `public` and `private` schemas are RLS-enabled. Internal/private service tables intentionally have no client RLS policies where direct client access is not required. Desktop pairing and entitlement RPCs are executable only by `postgres`/`service_role` and use a fixed search path.

The current Supabase advisor warning that remains relevant to account hardening is leaked-password protection being disabled. It is not a desktop build blocker.

## Current release boundary

The unsigned desktop QA target is operational: native `.exe` and `.dmg` installers have been built and smoke-tested, the production backend is healthy, and desktop CI is green on both supported operating systems. The remaining production-release boundary is code signing/notarization and wider human end-to-end QA on real machines/accounts; those steps are intentionally outside the free unsigned-test build.