# CashPatch desktop test installers

CashPatch produces internal QA installers for Windows and macOS from GitHub Actions.

- Windows test builds are unsigned and can trigger Microsoft Defender SmartScreen.
- macOS test builds are ad-hoc code-signed but are not Developer ID signed or notarized.

The ad-hoc macOS signature is intentional: it provides a structurally valid signed app bundle without requiring a paid Apple Developer certificate or committing signing secrets.

## Hard E2E build and verification

The `Desktop Test Installers` workflow builds the desktop app on native GitHub-hosted operating systems and uploads commit-specific artifacts:

- Windows: installable `.exe` / NSIS bundle
- macOS: ad-hoc-signed `.dmg` bundle

A build is not considered installer-verified merely because compilation succeeded.

### Windows automated E2E

The native Windows runner must:

1. validate the generated NSIS `.exe` as a Windows PE executable;
2. execute the installer and create a real installed CashPatch application;
3. locate and start the installed application binary;
4. keep that installed process alive through the runtime smoke window;
5. verify the registered uninstaller;
6. uninstall CashPatch and verify the registration is removed;
7. write SHA-256 checksums and E2E evidence before publishing the artifact.

Any install, launch, early-crash or uninstall failure is a failed installer build.

### macOS automated E2E

The native macOS runner must:

1. verify the DMG with `hdiutil verify`;
2. mount the DMG and locate the packaged `CashPatch.app`;
3. copy the packaged app to a separate Applications-style install location;
4. validate the bundle with `codesign --verify --deep --strict`;
5. confirm the ad-hoc signature;
6. start the installed packaged executable and keep it alive through the runtime smoke window;
7. apply quarantine metadata and re-check signature integrity;
8. run a Gatekeeper assessment and reject damaged/invalid-signature-class results;
9. write SHA-256 checksums plus E2E evidence before publishing the artifact.

A headless GitHub runner cannot perform the human macOS approval gesture required by Gatekeeper for a non-notarized application. Therefore `spctl` rejection of an otherwise valid ad-hoc-signed build is recorded as `MANUAL_APPROVAL_REQUIRED`, not as a claim that the application is fully user-approved. A `damaged`, invalid-signature, modified-after-signing or similar integrity result remains a hard FAIL.

## Required real-Mac Gatekeeper gate

Before an ad-hoc test DMG can be called fully functional for the intended test-install path, it must also be tried on a real Mac with normal security settings:

1. Drag `CashPatch.app` from the DMG into `Applications`.
2. Control-click or right-click `CashPatch.app` in Applications and choose **Open**.
3. If macOS blocks the first launch, use **System Settings > Privacy & Security > Open Anyway** for CashPatch after that launch attempt.
4. CashPatch must open and remain running without a `damaged` / `beschädigt` error.

Do not disable Gatekeeper globally and do not remove quarantine metadata as a user workaround. If the normal explicit-open flow cannot launch the build, the macOS installer remains FAIL. A seamless double-click experience for public distribution requires Developer ID signing and Apple notarization.

## Windows test install

Because the test `.exe` is not code-signed, Microsoft Defender SmartScreen can warn that the publisher is unknown. For an internal test build, verify that the artifact comes from the expected GitHub Actions run and compare its SHA-256 checksum before proceeding. A SmartScreen reputation warning is different from an installer or runtime failure.

A production Windows release should be signed with an appropriate code-signing certificate before general distribution.

## Security invariants for desktop builds

These rules apply to both test and production builds:

1. CashPatch is review-only. It may surface findings and recommended human actions, but it must not send, edit, delete, click, type into, or otherwise mutate connected external systems.
2. Banking is Account Information only. The desktop banking path may retrieve account metadata, balances and transactions for analysis. Payment initiation, transfers and any other bank write operation are forbidden.
3. A paired device receives a device credential only after browser approval. Desktop credentials are stored in the operating-system keyring rather than in frontend storage.
4. Server-side entitlement is authoritative. A paired device may monitor sources only while the server reports an active device and an active workspace subscription.
5. The desktop source API exposes only connections with `permission_mode=review_only` and `external_write_allowed=false`.
6. Local folders are opt-in. CashPatch receives no local folder path until the user chooses one explicitly.
7. Native notifications may report findings but must not expose an action path that changes the originating system.
8. No production secrets, service-role keys, banking secrets or signing keys may be committed to this repository or embedded in the desktop bundle.

`Desktop CI` separately runs desktop tests, frontend build, icon generation and Rust/Tauri checks on both Windows and macOS whenever a file under `desktop/**` changes.

## Release-signing boundary

Developer ID signing/notarization and commercial Windows code signing are outside the free test workflow. Adding production signing credentials requires an explicit release setup and must use repository/environment secrets rather than committed files.
