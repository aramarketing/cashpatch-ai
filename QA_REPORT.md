# CashPatch QA Report — 2026-09-21

## Verified production services

- Vercel production deployment is `READY`.
- `https://cashpatch-ai.vercel.app/api/health` returns HTTP 200.
- Health response confirms Supabase connectivity, Stripe connectivity and a configured Stripe webhook secret.
- Stripe is currently in test mode.
- Vercel runtime-error inspection reported no runtime errors in the previous 24 hours at the time of this QA pass.
- Supabase `cashpatch-ai` is `ACTIVE_HEALTHY` in `eu-central-1`.

## Desktop CI — passed

For current desktop source on `main`, `Desktop CI` passed on both native runners:

- macOS: desktop tests, frontend build, icon generation, Rust/Tauri `cargo check`
- Windows: desktop tests, frontend build, icon generation, Rust/Tauri `cargo check`

The banking detector tests are part of desktop CI.

## Native installer proof — passed

A successful `Desktop Test Installers` run (`35541317729`) built and smoke-tested installable packages on native GitHub-hosted runners.

### Windows

Produced:

- `CashPatch_0.1.0_x64-setup.exe`
- `CashPatch_0.1.0_x64_en-US.msi`

Verified by workflow:

- NSIS `.exe` exists
- Windows PE/MZ header is valid
- installer runs silently with exit code 0
- installed application registration for `CashPatch` exists
- uninstaller registration exists
- test cleanup invokes the uninstaller when available

Artifact inspection also confirmed the `.exe` is recognized as a Windows PE/Nullsoft installer executable.

### macOS

Produced:

- `CashPatch_0.1.0_aarch64.dmg`
- `CashPatch.app`

Verified by workflow:

- DMG exists
- `hdiutil verify` succeeds
- DMG mounts read-only
- `.app` bundle exists
- `Info.plist` passes `plutil -lint`
- `CFBundleExecutable` resolves to an executable file
- application binary is recognized as Mach-O

Artifact inspection additionally confirmed the bundled app binary is an arm64 Mach-O executable.

## Desktop feature review

Verified in source and build checks:

- browser-approved pairing flow
- pairing secrets/device credentials kept out of frontend storage and stored in the OS keyring on the desktop side
- server-side entitlement gate before monitoring sources
- tray/menu-bar behavior with Open/Quit controls
- close-to-tray behavior
- autostart plugin and UI enable path
- local AI discovery for Ollama and LM Studio
- explicit local-folder permission selection/removal
- native notification permission/request/send flow
- approved cloud-source loading only after entitlement
- periodic entitlement refresh and source scanning

## Pairing and entitlement backend review

Supabase desktop RPCs were inspected directly.

- `desktop_pairing_create` limits platform values to macOS/Windows and stores only a hash of the pairing secret.
- `desktop_pairing_approve` requires the approving user to be a workspace owner/admin and rejects expired/non-pending sessions.
- `desktop_pairing_consume` requires the matching pairing secret hash, an approved non-expired session, issues/rotates the device credential hash and marks the pairing session consumed.
- `desktop_entitlement_check` grants monitoring only when both device status and workspace billing status are `active`, and records grant/deny audit events.
- Desktop RPC execute privileges are restricted to `postgres` and `service_role` and use a fixed search path.

## Review-only / banking safety review

Passed source-policy review:

- connector write/create/update/delete/send/execute/mutate/click/type/upload actions are explicitly forbidden
- charge/refund/transfer/payout capabilities are explicitly forbidden
- review-only outbound provider requests are restricted to `GET`/`HEAD`
- desktop accepts a cloud source for banking analysis only when it is connected, `review_only`, and `externalWriteAllowed === false`
- banking desktop logic normalizes account-information data and performs local analysis; it exposes findings/recommended human actions rather than payment or transfer actions

## Supabase security review

- All current application tables in `public` and `private` are RLS-enabled.
- Advisor notices for RLS-enabled tables with no policy correspond to internal/service-only data paths where client access is intentionally absent.
- Remaining advisor warning: leaked-password protection is disabled in Supabase Auth. This should be enabled before a hardened public release, but it does not block desktop packaging or internal QA.

## Test-installer caveat

The current installers are intentionally unsigned.

- Windows can show SmartScreen/unknown-publisher warnings.
- macOS can block first launch through Gatekeeper until the tester explicitly opens the trusted app.
- This QA does not claim production signing or Apple notarization.

## Remaining release QA

Before calling a signed public desktop release complete, perform human end-to-end checks on representative real machines for:

1. fresh install and first launch on Intel/ARM Windows targets as applicable
2. fresh install and first launch on supported macOS hardware
3. browser pairing with a real paid test workspace
4. subscription revocation while the desktop app is running
5. real notification permission UX on each OS
6. real autostart after reboot/login
7. real local Ollama/LM Studio detection
8. a read-only bank connection using test/sandbox account-information consent
9. final signed/notarized release packaging once signing credentials are deliberately introduced

The unsigned QA requirement is already met: working native `.exe` and `.dmg` packages have been built and smoke-tested successfully.