# CashPatch Security Architecture and Threat Model

CashPatch is a **local-first, review-only audit application**. Its security objective is to let a user inspect approved local and connected business data without giving CashPatch the ability to mutate source systems or upload private audit content.

This document is normative. Product code and tests must fail closed when behavior conflicts with these rules.

## 1. Trust boundaries

### Local desktop process

The Tauri/Rust desktop core is the trusted enforcement boundary for:

- scan consent and scan state;
- filesystem access;
- local AI routing;
- local report generation;
- password-vault cryptography;
- local scan journal/history;
- egress allowlisting;
- read-only connector capability checks.

The React frontend is a presentation and consent surface. It must not hold long-lived credentials, provider tokens, vault master keys, or source-system secrets in browser storage.

### CashPatch cloud control plane

The cloud service may hold only the minimum account/control-plane information required for:

- account identity;
- device pairing;
- subscription entitlement;
- update metadata;
- connector authorization metadata where a provider requires a server-side OAuth exchange.

Scan contents, local files, conversation exports, local findings, vault contents and password data are not audit-plane cloud data and must not be uploaded to CashPatch infrastructure.

### External providers

A connected provider is untrusted with respect to CashPatch's review-only guarantee. CashPatch must assume a provider API can expose both read and write methods and must enforce a local/server capability allowlist before a request is made.

## 2. Non-negotiable product invariants

1. A content scan never starts without explicit user consent.
2. Quick Scan is metadata/scope discovery only. Full Scan requires a second explicit confirmation.
3. Closing/hiding CashPatch stops an active scan; an app restart never silently resumes one.
4. Recovery of an interrupted scan requires explicit user confirmation and uses the previously approved scope.
5. External source actions are read-only. CashPatch never sends, edits, deletes, creates, clicks, types, uploads, pays, transfers, refunds, books, posts or otherwise mutates a connected source.
6. Banking is Account Information only. Payment initiation and money movement are forbidden capabilities.
7. Local AI is local-only. Unknown/non-loopback AI endpoints are rejected; there is no automatic cloud-AI fallback.
8. Browser passwords, cookies, refresh tokens and session stores are never scraped.
9. Vault entries are accepted only through deliberate user entry/import into the CashPatch vault and are never used for autonomous login.
10. Audit content and findings are not uploaded to CashPatch.
11. Unknown outbound network destinations are denied by default.
12. Reports are created only by a user-initiated local save action.

## 3. Scan consent state machine

Allowed high-level transitions:

`idle -> quick_scanning -> awaiting_full_confirmation -> full_scanning -> completed`

Additional safe terminal/recovery transitions:

- `quick_scanning -> cancelled`
- `full_scanning -> cancelled`
- active scan -> local crash journal -> explicit recovery confirmation -> new scan of the same approved scope
- any execution error -> `failed`

No transition from `idle` directly to `full_scanning` is valid. No persisted journal may cause automatic scanning after launch.

## 4. Filesystem safety

CashPatch may enumerate/read only paths the operating system makes available to the current user and any additional scope the user explicitly selects.

Required controls:

- never follow filesystem symlink loops;
- skip known cache/build/VM-like high-churn directories where appropriate;
- enforce bounded file sizes for content extraction;
- bound archive entries and decompressed text sizes;
- treat permission-denied as a finding/status, not a reason to bypass OS protection;
- no privilege escalation;
- no writing to reviewed source files;
- local CashPatch state is written only inside the application data/support directory or a user-selected report destination.

## 5. Local AI boundary

Supported local AI adapters must route only to loopback/local endpoints such as Ollama, LM Studio, Jev-compatible local endpoints, or explicitly configured local runtimes.

Security requirements:

- validate endpoint host before every request;
- reject remote DNS names/IPs and redirects that leave the approved local boundary;
- never provide shell, browser, file-write, payment, messaging or connector-write tools to the model;
- treat model output as untrusted advisory text;
- keep deterministic non-AI detectors for high-confidence findings where possible;
- cap document/message input size and number of documents per scan;
- redact secrets from logs and diagnostic output;
- if no local model is available, report that condition instead of silently using a hosted model.

## 6. Connector capability model

Every connector must declare capabilities. The allowlist for review-only data access may include operations equivalent to:

- `read`
- `list`
- `search`
- `get`
- `download` when the result is read locally and download itself does not mutate the source

Forbidden capabilities include, without limitation:

- create/update/delete
- send/post/publish
- click/type/execute/automation
- upload
- charge/refund
- transfer/payout/payment initiation
- task/record mutation
- remote file move/rename
- permission/share mutation

Provider-facing generic HTTP access must be constrained to read semantics (`GET`/`HEAD`) unless a narrowly scoped OAuth/token exchange is required by protocol; such control-plane exchanges must never carry scanned customer content.

## 7. Banking boundary

CashPatch banking support is Account Information Service style review only.

Permitted data:

- institution/account metadata;
- balances;
- transactions;
- read-only categorization/analysis performed locally.

Forbidden functionality:

- payment initiation;
- transfers;
- card/account changes;
- refunds;
- payouts;
- beneficiary creation;
- mandate creation/modification;
- any write-capable banking scope.

If a provider offers combined read/write credentials, CashPatch must request the minimum read-only scope or refuse the integration.

## 8. Password vault

The optional local vault is a storage feature, not a credential extraction or automation feature.

Required properties:

- Argon2id-derived key from the user's master passphrase;
- authenticated encryption (XChaCha20-Poly1305 or equivalent strong AEAD);
- independent random salt and nonce generation;
- no master passphrase persistence;
- auto-lock after inactivity;
- no cleartext vault secrets in logs, telemetry, reports or frontend storage;
- secrets revealed only on explicit user action and hidden again after a bounded interval;
- any future clipboard-copy feature must clear the clipboard after a short timeout;
- no cloud synchronization by default;
- no automatic form filling or login by CashPatch.

## 9. Local persistent state

Local state includes scan journal/history, configuration, optional vulnerability database, device session metadata and encrypted vault data.

Requirements:

- store under OS-appropriate application-data directories;
- use restrictive filesystem permissions where supported;
- write journal/history atomically to reduce corruption risk;
- scan history stores summary metadata, not document bodies or passwords;
- vault data is encrypted at rest;
- device credentials use the OS credential store in production-signed builds;
- internal ad-hoc macOS test builds may use the documented restricted local credential fallback only to avoid unstable Keychain ACL behavior from changing ad-hoc code identities.

## 10. Egress policy

CashPatch is default-deny for network egress.

Allowed classes are narrowly scoped to:

1. CashPatch account/device entitlement endpoints;
2. CashPatch update metadata/download endpoint;
3. explicitly approved vulnerability database download source(s);
4. local loopback AI endpoints;
5. user-enabled read-only connector provider endpoints.

Prohibited egress includes:

- scan file content to CashPatch;
- conversation contents to CashPatch;
- findings to CashPatch;
- vault contents or passwords;
- browser/session credentials;
- arbitrary telemetry containing customer data;
- unknown hosts.

Any redirect or dynamically supplied URL must be revalidated before use.

## 11. Update security

Updates are download-only from the application's update channel. Customer scan data is not part of the update protocol.

Production release requirements:

- macOS: stable Developer ID signing and Apple notarization;
- Windows: appropriate code signing;
- signed update artifacts/metadata;
- update integrity verification before install;
- protected signing keys stored outside the repository.

Unsigned/ad-hoc packages are internal QA artifacts only and must not be presented as production-signed releases.

## 12. Threat model

### Malicious or compromised local file

Risk: parser crash, decompression bomb, malicious document contents, path trickery.

Mitigations: bounded reads, archive-entry limits, no macro execution, no document rendering engines that execute embedded code, symlink-loop protection, parser errors fail closed, no source-file writes.

### Prompt injection inside scanned content

Risk: a document/conversation tells the local model to reveal data or execute actions.

Mitigations: local model has no write/action tools; model output is advisory only; egress remains enforced in native code; prompt/content is treated as untrusted data; deterministic policies cannot be overridden by model text.

### Malicious connector/provider response

Risk: provider data attempts to inject instructions or trigger writes.

Mitigations: capability allowlist, response treated as data, no provider-derived URL/action executed without policy validation, no write tools exposed.

### Stolen device credential

Risk: attacker uses a paired-device token.

Mitigations: credential stored in OS credential store (production) or restricted QA fallback, server-side revocation/status checks, device entitlement required, token must not authorize customer-data uploads or external write actions.

### Compromised local AI runtime

Risk: local AI process returns malicious output or attempts network activity independently.

Mitigations: CashPatch treats output as untrusted advisory text, gives it no action credentials/tools, sends only user-approved local content, and does not treat AI output as authority for policy decisions. CashPatch cannot guarantee behavior of third-party local model software outside its own process and should disclose that boundary.

### Credential theft via scanning

Risk: scanning accidentally captures secrets from browser stores or credential files.

Mitigations: no browser-cookie/password extraction, explicit sensitive-file findings avoid reproducing secret contents, vault import is deliberate, logs/reports redact likely credentials, unsupported protected stores remain untouched.

### Unauthorized background surveillance

Risk: app scans after restart, close-to-tray, or without visible consent.

Mitigations: scan state starts idle on process launch, scans require consent commands, closing/hiding cancels an active scan, recovery is opt-in, no scheduled background scanner.

### Data exfiltration bug

Risk: new code sends scanned content to a new host.

Mitigations: central native egress allowlist, unknown-host tests, local-only AI endpoint validation, code review/CI security contract tests, no generic unrestricted HTTP client exposed to frontend.

## 13. Logging and diagnostics

Logs must never contain:

- vault secrets/master passphrases;
- raw device credentials or OAuth tokens;
- full conversation/message bodies;
- full document contents;
- browser cookies/session data.

Diagnostic export should contain application/build version, safe error codes, scanner counters, permission failures and redacted endpoint classes rather than sensitive payloads.

## 14. Security QA gates

A release candidate is not complete until automated tests demonstrate at least:

- Full Scan cannot start without Quick Scan completion and explicit confirmation;
- unknown egress hosts are rejected;
- remote local-AI endpoints are rejected;
- connector write capabilities are rejected;
- banking write/payment capabilities are rejected;
- scan restart is not automatic after app launch;
- close/hide cancels an active scan;
- symlink loops and permission errors do not escape scope or crash the scanner;
- bounded file/archive parsing limits hold;
- vault ciphertext does not contain the entered secret in clear text;
- scan history/journal does not contain document bodies or vault secrets;
- report export is user initiated and local;
- native packaged application launches successfully on macOS and Windows E2E runners.

## 15. Known release boundary

A technically valid internal ad-hoc/unsigned build is not equivalent to a smooth public release. Public macOS distribution requires Developer ID signing/notarization and public Windows distribution should use trusted code signing. Those signing credentials must be provided as protected release secrets and never committed to GitHub.
