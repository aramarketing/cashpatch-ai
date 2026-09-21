# CashPatch Local Audit OS — architecture contract

CashPatch is a local-first, review-only audit system for macOS and Windows. The desktop application may inspect only data the user explicitly authorizes. It must never mutate the scanned computer, connected SaaS systems, bank accounts, email, CRM records, project tools, files, or AI conversations.

## User flow

1. Install CashPatch.
2. Open CashPatch.
3. Pair the installation to a CashPatch account for license/entitlement only.
4. Review permissions and scan scope.
5. Explicitly consent to **Quick Scan**.
6. Quick Scan performs metadata inventory only, estimates accessible scope, file/data volume, permission boundaries and a Full Scan ETA.
7. CashPatch displays the estimate and requires a second explicit confirmation.
8. Explicitly consent to **Full Scan**.
9. Full Scan runs only while the user has actively started it. The UI shows live progress, current source/path, counters, findings and ETA. The user can pause, resume or cancel.
10. Results are review-only: evidence, explanation and recommended human remediation. There is no execute/fix/pay/send/delete button.

## Hard privacy boundary

Customer content is local by default.

Allowed desktop network purposes are intentionally narrow:

- account pairing and entitlement;
- metadata about explicitly connected read-only sources;
- signed update downloads;
- vulnerability-database downloads;
- user-initiated read-only connector traffic;
- loopback traffic to local AI runtimes.

The desktop core uses a default-deny egress policy. Unknown cloud destinations are rejected. Local AI endpoints must resolve to loopback addresses.

Scan content, local files, AI conversations, passwords, financial records and findings must never be uploaded to CashPatch infrastructure. Supabase/Vercel hold account/license/update metadata only.

## Review-only capability model

The desktop runtime is not given generic write primitives for external systems.

Forbidden capabilities include:

- send/edit/delete email;
- create/update/delete CRM or project records;
- browser click/type automation;
- shell/AppleScript/PowerShell automation that controls external apps;
- file delete/move/rename/write as a remediation action;
- payment initiation, transfer, payout, refund, beneficiary management or card control.

Banking is Account Information only. The legacy cloud banking-content sync path is not exposed by the desktop invoke handler; a local AIS connector must replace it before banking content is considered production-ready.

## Scan state machine

The native Rust core owns scan state.

- `idle`
- `quick_scanning`
- `awaiting_full_confirmation`
- `full_scanning`
- `completed`
- `cancelled`
- `failed`

Quick Scan and Full Scan require separate consent booleans. A Full Scan cannot start without a completed matching Quick Scan session. Scan workers support pause/resume/cancel and emit `scan-progress` events to the frontend.

The first implementation performs:

- filesystem metadata inventory;
- accessible-root and permission-boundary mapping;
- Full Scan ETA calculation;
- supported-business-file hashing for duplicate detection;
- filename-only detection of likely plaintext credential documents without exposing secret contents;
- large stale-file efficiency findings;
- permission-denied summary findings.

Later analyzers plug into the same state machine rather than creating background workers.

## Resource safety

- Symlinks are not followed.
- Heavy cache/build directories are skipped.
- Quick Scan has an entry safety cap.
- Full content hashing is limited by file size and supported business extensions.
- Progress is emitted periodically instead of per byte.
- No scan resumes automatically after restart; resume requires user confirmation.

## Local AI

CashPatch supports local AI only. Initial runtime detection is for loopback Ollama and LM Studio endpoints. A Jev-compatible adapter will be added only when its local API contract is known/configured; no cloud fallback is allowed.

Local AI receives only the minimum chunks required for analysis. It receives no write tools.

## Password vault

The planned vault is a separate optional user-controlled component. It must never scrape browser passwords or session cookies. Users add/import entries deliberately.

Target design:

- Argon2id password-based key derivation;
- authenticated encryption such as XChaCha20-Poly1305;
- per-vault random salt and nonce;
- automatic lock;
- short clipboard lifetime;
- no plaintext secrets in logs;
- no cloud synchronization;
- no autonomous login or credential submission by CashPatch.

## macOS ad-hoc test builds

Official signed production builds use the operating-system credential store. Internal ad-hoc macOS test builds have no stable signing identity between rebuilds, which can create repeated Keychain ACL prompts. The test build therefore uses the documented protected local test credential store only when `CASHPATCH_ADHOC_TEST_BUILD=1`; production code does not enable that fallback.

## Delivery gates

No Final PASS until both current installers are built from the same current commit and:

- macOS DMG verifies, mounts, installs/copies, passes code-signature checks and launches the packaged app;
- Windows EXE installs, launches the installed app and uninstalls cleanly;
- real-Mac Gatekeeper flow works without a damaged-app error;
- pairing works;
- inactive entitlement blocks scanning;
- active entitlement unlocks an already-open app within 15 seconds without restart;
- Quick Scan requires consent and returns scope + ETA;
- Full Scan requires second consent and exposes live progress;
- pause/resume/cancel work;
- no background content scan runs automatically;
- review-only and AIS-only boundaries have regression tests;
- final artifacts have SHA-256 checksums.
