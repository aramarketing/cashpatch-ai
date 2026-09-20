# CashPatch unsigned desktop test installers

CashPatch currently produces **unsigned test builds** for Windows and macOS from GitHub Actions. They are intended for internal QA before release signing is introduced.

## Build and verification

The `Desktop Test Installers` workflow builds the desktop app on the native GitHub-hosted operating system and uploads platform-specific artifacts:

- Windows: installable `.exe` bundle
- macOS: `.dmg` bundle

The workflow must finish its platform smoke-check before the artifact is uploaded. Checksums are written alongside the bundles. `Desktop CI` separately runs the desktop tests, frontend build, icon generation and `cargo check` on both Windows and macOS whenever a file under `desktop/**` changes.

## Windows test install

Because the test `.exe` is not code-signed, Microsoft Defender SmartScreen can warn that the publisher is unknown. For an internal test build, verify that the artifact comes from the expected GitHub Actions run and compare its SHA-256 checksum before proceeding. Do not distribute an unsigned test build as a production release.

A production Windows release should be signed with an appropriate code-signing certificate before general distribution.

## macOS test install

Because the test `.dmg` is not Developer ID signed or notarized, macOS Gatekeeper can block the first launch. For an internal test build, verify the artifact and its SHA-256 checksum first. A tester may then use the normal macOS explicit-open flow for an app they trust. Do not weaken Gatekeeper globally and do not distribute the unsigned build as a production release.

A production macOS release should use Developer ID signing and Apple notarization before general distribution.

## Security invariants for desktop builds

These rules apply to both test and production builds:

1. CashPatch is review-only. It may surface findings and recommended human actions, but it must not send, edit, delete, click, type into, or otherwise mutate connected external systems.
2. Banking is Account Information only. The desktop banking path may retrieve account metadata, balances and transactions for analysis. Payment initiation, transfers and any other bank write operation are forbidden.
3. A paired device receives a device credential only after browser approval. Desktop credentials are stored in the operating-system keyring rather than in frontend storage.
4. Server-side entitlement is authoritative. A paired device may monitor sources only while the server reports an active device and an active workspace subscription.
5. Cloud source access must remain `review_only` with `externalWriteAllowed === false` before the desktop client uses it.
6. Local folders are opt-in. CashPatch receives no local folder path until the user chooses one explicitly.
7. Native notifications may report findings but must not expose an action path that changes the originating system.
8. No production secrets, service-role keys, banking secrets or signing keys may be committed to this repository or embedded in the desktop bundle.

## Release-signing boundary

Release signing/notarization is intentionally outside the unsigned-test workflow. Adding paid certificates or production signing credentials requires an explicit release setup and must use repository/environment secrets rather than committed files.