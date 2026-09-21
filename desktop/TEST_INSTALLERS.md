# CashPatch desktop test installers

CashPatch produces internal QA installers for Windows and macOS from GitHub Actions.

- Windows test builds are unsigned and can trigger Microsoft Defender SmartScreen.
- macOS test builds are ad-hoc code-signed but are not Developer ID signed or notarized.

The ad-hoc macOS signature is intentional: Apple Silicon requires code signing for apps downloaded from the Internet, and Tauri documents the pseudo-identity `-` for this no-certificate test case. This removes the completely unsigned/broken-app failure while keeping the build free of paid certificates and signing secrets.

## Build and verification

The `Desktop Test Installers` workflow builds the desktop app on the native GitHub-hosted operating system and uploads platform-specific artifacts:

- Windows: installable `.exe` bundle
- macOS: ad-hoc-signed `.dmg` bundle

The workflow must finish its platform smoke-check before the artifact is uploaded. Checksums are written alongside the bundles. On macOS the workflow also verifies the app's code signature and starts the packaged executable briefly, so a DMG that merely mounts but contains a non-launchable app does not pass.

`Desktop CI` separately runs the desktop tests, frontend build, icon generation and `cargo check` on both Windows and macOS whenever a file under `desktop/**` changes.

## Windows test install

Because the test `.exe` is not code-signed, Microsoft Defender SmartScreen can warn that the publisher is unknown. For an internal test build, verify that the artifact comes from the expected GitHub Actions run and compare its SHA-256 checksum before proceeding. Do not distribute an unsigned test build as a production release.

A production Windows release should be signed with an appropriate code-signing certificate before general distribution.

## macOS test install

The macOS app is ad-hoc signed but not Developer ID signed or notarized, so Gatekeeper can still require explicit approval on the first launch.

For an internal test build:

1. Drag `CashPatch.app` from the DMG into `Applications`.
2. Control-click or right-click `CashPatch.app` in Applications and choose **Open**.
3. If macOS still blocks it, open **System Settings > Privacy & Security** and use **Open Anyway** for CashPatch after the blocked launch attempt.

Do not disable Gatekeeper globally. A production macOS release should use Developer ID signing and Apple notarization before general distribution.

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

Developer ID signing/notarization is intentionally outside the free test workflow. Adding production signing credentials requires an explicit release setup and must use repository/environment secrets rather than committed files.
