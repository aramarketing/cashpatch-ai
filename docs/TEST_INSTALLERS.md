# CashPatch unsigned desktop test installers

CashPatch currently produces unsigned **test** installers for Windows and macOS in GitHub Actions. These builds are for development and controlled testing before commercial code-signing certificates and Apple notarization are added.

## What CI verifies

The `Desktop Test Installers` workflow builds directly from `main` on native GitHub-hosted runners.

### Windows

The workflow:
- requires an NSIS `.exe` installer to be generated;
- verifies the installer has a valid Windows PE/MZ header;
- runs the installer silently on a clean GitHub-hosted Windows runner;
- requires the installer to exit successfully;
- verifies that CashPatch is registered as an installed application with an uninstaller;
- attempts a silent uninstall after the smoke test;
- publishes SHA-256 checksums with the artifact.

### macOS

The workflow:
- requires a `.dmg` installer to be generated;
- verifies the disk image with `hdiutil verify`;
- mounts the DMG read-only on a GitHub-hosted macOS runner;
- requires a CashPatch `.app` bundle to be present;
- validates its `Info.plist`;
- requires its declared application executable to exist and be executable;
- verifies the executable is a Mach-O binary;
- publishes SHA-256 checksums with the artifact.

These checks prove the package is structurally valid and installable/mountable in CI. They do not replace final human UI testing on every supported Windows/macOS version.

## Windows SmartScreen

The test installer is intentionally unsigned. Windows may therefore show a Microsoft Defender SmartScreen warning such as **Windows protected your PC**.

For a test build that you obtained from the project's own GitHub Actions artifact, first verify its SHA-256 checksum. If you trust the verified build, use **More info** and **Run anyway** when Windows offers that option.

Do not disable SmartScreen globally.

Public production releases should be Authenticode-signed so users receive normal publisher trust and fewer reputation warnings.

## macOS Gatekeeper

The test DMG/app is intentionally not Apple-notarized or Developer ID signed. macOS Gatekeeper may block the first launch.

For a test build that you obtained from the project's own GitHub Actions artifact, first verify its SHA-256 checksum. If you trust the verified build, use Finder's **Open** command from the context menu, or use **System Settings → Privacy & Security → Open Anyway** if macOS presents that option.

Do not disable Gatekeeper globally and do not use commands that remove system-wide security protections.

Public production releases should use an Apple Developer ID certificate and Apple notarization.

## Verify checksums

Each CI artifact includes `SHA256SUMS.txt`.

macOS example:

```bash
shasum -a 256 /path/to/CashPatch*.dmg
```

Windows PowerShell example:

```powershell
Get-FileHash -Algorithm SHA256 .\CashPatch*.exe
```

Compare the result with the checksum in the downloaded artifact before running an unsigned test installer.

## Security boundary

Signing status does not change CashPatch's application permissions. Test and production builds must keep the same review-only model: connectors may read approved data but may not send messages, modify source systems, create payments, initiate transfers, or expose external write actions. Banking remains Account Information only.
