# CashPatch Security Threat Model

## Security objective

CashPatch is a local-first, review-only audit application. Its core security property is stronger than a UI promise: the desktop runtime is designed so that scan data, documents, conversations, passwords, financial data, findings and report contents are not uploaded by CashPatch.

CashPatch may use the network only for narrowly defined control-plane operations:

1. account pairing and entitlement checks against the CashPatch control plane;
2. signed software-update metadata and update downloads;
3. vulnerability-feed downloads into a local cache;
4. user-initiated read-only connectors to providers the user explicitly connects;
5. loopback-only local AI runtimes.

There is no general-purpose telemetry or scan-data upload path.

## Trust boundaries

### Local trusted boundary

Inside the local desktop process:

- consent state;
- scan scheduler and collectors;
- filesystem metadata and approved file contents;
- normalized observations;
- local AI inference requests and responses;
- findings and evidence;
- password-vault ciphertext;
- locally exported reports.

Raw business content stays inside this boundary unless the user explicitly saves a local report or uses an approved read-only provider connection that necessarily communicates with that provider.

### CashPatch cloud control plane

The CashPatch cloud is allowed to know only what is needed for account operation, such as:

- account/workspace identity;
- paired-device identifiers;
- subscription/entitlement state;
- update-channel metadata;
- connector configuration metadata that does not contain scanned business content.

It must not receive scanned documents, mailbox contents, conversations, password-vault entries, bank transaction payloads, local file trees, findings or evidence.

### Third-party provider boundary

A third-party service is contacted only after explicit user connection. The connector must be read-only, use the minimum provider scope, and fail closed if the provider cannot enforce the required read-only capability.

## Threats and mandatory mitigations

### Unauthorized background scanning

Threat: a user installs or starts CashPatch and content scanning begins without informed consent.

Mitigations:

- no Quick Scan at application startup;
- no Full Scan at application startup;
- no timer may initiate either scan;
- Quick Scan requires an explicit consent value and user action;
- Full Scan requires a second explicit confirmation after Quick Scan has shown scope and ETA;
- closing/restarting CashPatch never silently resumes a content scan;
- crash recovery may offer a resume action, but resume requires fresh user confirmation.

### External write or automation capability

Threat: CashPatch changes a connected system or computer while claiming to be review-only.

Mitigations:

- connector capability allowlist is read/list/search/inspect only;
- provider fetch layer rejects unsafe HTTP methods;
- no payment initiation, transfer, refund, payout or charge capability;
- no browser form submission or session-cookie extraction;
- no keyboard/mouse automation;
- no AppleScript/PowerShell/shell automation used to control third-party applications;
- findings contain recommended human actions only.

### Data exfiltration

Threat: sensitive scan material leaves the computer through telemetry, analytics, AI APIs or an accidental generic HTTP client.

Mitigations:

- default-deny native egress policy;
- local AI endpoints restricted to loopback addresses;
- no cloud-AI fallback;
- no scan-content telemetry;
- no generic upload API;
- diagnostic logs redact secrets and must not contain full document/conversation bodies;
- tests must fail if unrestricted hosts or write-capable provider operations are introduced.

### Credential theft

Threat: CashPatch extracts browser passwords, session cookies or secrets that the user did not intentionally give to CashPatch.

Mitigations:

- never scrape browser password databases, cookies or OS credential stores for third-party credentials;
- OAuth tokens are acquired only through explicit provider authorization;
- password vault accepts only credentials deliberately entered/imported by the user;
- vault values are not used for autonomous login or browser automation;
- official signed builds use OS-secure credential storage for CashPatch device credentials;
- ad-hoc macOS QA builds may use the documented local protected fallback because their code identity changes between builds.

### Password-vault compromise

Threat: theft of the local vault file reveals secrets.

Mitigations:

- Argon2id password-based key derivation;
- authenticated encryption (XChaCha20-Poly1305);
- random salt and nonce;
- decrypted keys and buffers zeroized where practical;
- restrictive local file permissions;
- no cloud synchronization;
- no secret values in logs;
- automatic lock after inactivity;
- revealed values are intentionally short-lived in the UI.

### Filesystem attacks

Threats: symlink loops, unreadable paths, enormous files, cache explosions, malformed files and hostile filenames.

Mitigations:

- symlink traversal disabled by default;
- permission failures become findings/status, never privilege-escalation attempts;
- known cache/build directories are skipped;
- maximum content-inspection sizes;
- bounded progress payloads;
- defensive parsing with errors isolated per file;
- cancellation and pause checks during long scans.

### Malicious or compromised AI model

Threat: a local model returns instructions to modify systems, expose secrets or claim unsupported facts.

Mitigations:

- model receives no external write tools;
- model output is advisory data, not executable commands;
- deterministic rules and source evidence remain authoritative for hard findings;
- model findings require evidence references and confidence;
- model endpoint must be loopback-only;
- prompts and results remain local.

### Malicious document / prompt injection

Threat: scanned text contains instructions aimed at CashPatch or the local model.

Mitigations:

- scanned content is always treated as untrusted data, never as system instructions;
- document/conversation text cannot grant capabilities;
- local model prompts explicitly separate evidence from instructions;
- no finding can trigger execution;
- exported reports quote only bounded evidence snippets and are labeled untrusted where appropriate.

### Supply-chain and update compromise

Threat: a fake update replaces CashPatch.

Mitigations:

- update path is download-only;
- production releases require signed update artifacts;
- macOS public releases require Developer ID signing and notarization;
- Windows public releases require code signing;
- update verification keys are not replaced by data received from scan sources;
- release hashes are recorded and tied to the exact source commit.

## Banking boundary

Banking is Account Information Services only. CashPatch may analyze read-only account metadata, balances and transactions after explicit connection. It must not expose or implement payment initiation, transfers, standing-order creation, refunds, payouts or any equivalent write operation.

## AI conversation review boundary

Conversation analysis supports only:

- user-provided exports;
- legitimate local export/cache data that the user explicitly selects;
- provider read-only APIs where permitted.

It must not bypass provider protections, steal sessions, scrape credentials or silently inspect conversations. Analysis is local and aims to surface contradictions, forgotten commitments, cost/contract risks, questionable assumptions and open tasks.

## Evidence and logging rules

- Never log master passwords, vault secrets, OAuth tokens, device credentials or full authorization headers.
- Avoid logging full document bodies and full AI conversations.
- Store only bounded evidence necessary to explain a finding.
- Reports are created only through an explicit local Save action.
- Diagnostic export must be separately user initiated and redacted.

## Security release gates

A release is not secure merely because it builds. Final security PASS requires:

- consent-gated Quick Scan and Full Scan;
- proof no background content scan starts after launch/restart;
- default-deny egress tests;
- review-only connector tests;
- Banking AIS-only tests;
- vault cryptography and lock tests;
- malformed/unreadable filesystem tests;
- local-AI loopback-only tests;
- native macOS and Windows installer/runtime tests;
- no secrets in repository scans;
- explicit manual confirmation for any OS permission that CI cannot grant safely.
