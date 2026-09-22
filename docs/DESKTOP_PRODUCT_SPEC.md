# CashPatch Desktop Product Specification

## Product form

CashPatch is a downloadable desktop application for macOS and Windows. The desktop application is the primary product. The web application is limited to account management, subscription and billing, device pairing, downloads, release notes and support.

CashPatch is a local-first, review-only audit system. It observes approved data, produces findings and reports, and never performs remediation in external systems.

## Non-negotiable operating model

CashPatch does **not** run an automatic background scan.

A scan begins only after the user opens CashPatch and explicitly starts it. The required flow is:

1. show the local/privacy and review-only consent;
2. user chooses or grants the minimum read-only permissions needed;
3. user presses **Start Quick Scan**;
4. Quick Scan inventories metadata and accessible scope only;
5. CashPatch shows discovered sources, permission boundaries, approximate data size and a Full Scan ETA;
6. user explicitly confirms the Full Scan;
7. only then may CashPatch inspect approved content;
8. Live View shows the current phase/source/path, processed counts, findings, elapsed time, ETA and pause/cancel controls.

Closing or hiding the application cancels an active scan. Restarting CashPatch must never silently resume an interrupted scan. Recovery may be offered, but resumption requires a fresh user confirmation.

Autostart, if enabled by the user, may start the CashPatch shell/tray only. It must not start a scan.

## Desktop stack

- Tauri 2 desktop shell
- Rust native audit core
- React/TypeScript interface
- protected local scan state/history
- OS credential store for signed production builds
- native notifications
- signed download-only updater
- local AI provider abstraction
- read-only connector runtime
- optional encrypted local password vault

## Review-only guarantee

CashPatch may:

- read data the user explicitly authorizes;
- list/search/inspect approved local and connected sources;
- hash files for local duplicate analysis;
- correlate and analyze locally;
- create local findings and recommendations;
- display native notifications;
- export a user-requested local report.

CashPatch may not:

- send email or messages;
- create, update or delete CRM/project records;
- click or type in external software;
- submit browser forms;
- upload or modify customer files;
- change connected-service settings;
- create invoices;
- charge, refund, pay or transfer money;
- initiate bank payments;
- extract browser passwords, session cookies or protected credentials;
- bypass operating-system permissions, sandboxing or security controls.

If a connector cannot technically guarantee the required read-only capability, it fails closed and is not enabled.

## Local data boundary

Scan content, files, AI conversations, passwords, financial records and findings stay on the customer device by default. They are not uploaded to CashPatch cloud services.

Allowed network egress is default-deny and limited to:

- CashPatch account/device pairing and paid-entitlement checks;
- signed application update download;
- approved vulnerability-database download;
- a connector explicitly enabled by the user with read-only scopes;
- loopback-only local AI endpoints.

Unknown destinations are blocked by the native egress policy. There is no cloud-AI fallback for scan content.

## Quick Scan

Quick Scan requires explicit consent and reads metadata needed to estimate Full Scan scope. It may inspect:

- accessible root locations;
- file and directory counts;
- file sizes and supported extensions;
- installed applications and versions;
- running process names;
- autostart entries;
- storage and memory inventory;
- supported local AI runtimes;
- configured CashPatch read-only connectors;
- permission-denied boundaries.

Quick Scan must not bypass protected locations or silently request privilege escalation. The result includes a conservative duration estimate, reachable bytes/files, source count and missing permissions.

## Full Scan

Full Scan requires a second explicit confirmation. It runs only while the user is actively running CashPatch and may analyze approved content locally for:

- duplicate files/documents;
- exposed-secret file risks without harvesting protected credentials;
- invoices, receipts, offers and contracts;
- duplicate invoices and likely double payments;
- recurring charges and cost anomalies;
- unusual price changes and potential overpayment;
- deadlines and consistency errors;
- installed-software version and known-vulnerability matches;
- local/exported AI conversations for contradictions, forgotten tasks, cost/contract issues and unresolved risks;
- explicitly connected read-only account data.

Every finding contains category, severity, confidence/evidence, possible financial or security impact, why it is suspicious and human remediation guidance. There is no execute/remediate button.

## Live View

During a scan the user can see:

- Quick Scan / Full Scan phase;
- current approved source, folder or item;
- files/records processed;
- data volume processed;
- progress percentage;
- elapsed time and ETA;
- permission errors;
- findings as they appear;
- Pause/Resume and Cancel controls.

The UI must not expose entire sensitive documents when a short redacted evidence snippet is sufficient.

## Local AI

CashPatch detects and supports loopback-only local runtimes such as Ollama, LM Studio, Jev-compatible endpoints and future compatible providers.

Rules:

- no scan-content cloud fallback;
- endpoint must resolve to a loopback address;
- local model receives only the minimum chunk needed for analysis;
- deterministic rules run before LLM analysis where possible;
- models receive no write tools or external-action capabilities;
- sensitive logs are redacted;
- if no compatible local model is available, the UI explains setup rather than silently using a remote model.

## AI conversation review

CashPatch may review AI conversations only after explicit user permission and through a legitimate read-only source:

- user-selected exports;
- locally available user-owned export data;
- a provider API that offers appropriate read-only access.

No scraping around provider protections, credential extraction, cookie extraction or session hijacking is allowed.

## Password vault

The optional CashPatch vault is local and user-controlled. It is not a credential extractor or automatic login tool.

Only entries deliberately added/imported by the user are accepted. Target design:

- Argon2id key derivation from a master passphrase;
- authenticated encryption such as XChaCha20-Poly1305;
- fresh random salt/nonce;
- protected local storage;
- automatic locking;
- temporary secret reveal and clipboard expiration when clipboard support is added;
- no plaintext secret logs;
- no cloud synchronization;
- no autonomous use of vault secrets against websites or applications.

## System and vulnerability audit

CashPatch may collect read-only OS inventory without shell automation that controls third-party applications. Supported inventory includes operating system, architecture, hardware/memory/storage metadata, process names, network-interface metadata, installed applications/software versions and autostart locations that are readable without privilege bypass.

Known-vulnerability analysis uses a local cached vulnerability database. Database installation/update must validate schema, size limits and cryptographic integrity before replacing the local cache. Vulnerability data may be downloaded; customer telemetry is never uploaded as part of that download.

## Online connectors

Connectors are capability-allowlisted and opt-in. Tokens are stored locally using the platform credential strategy and request only the minimum read scopes.

Target connector categories include email, CRM, project management, accounting, banking, commerce, storage and calendar.

Banking is strictly Account Information only: account metadata, balances and transactions may be read for analysis. Payment initiation, transfers, refunds, payouts and all other bank write actions are prohibited.

## Paid entitlement and account binding

Stripe remains the billing source of truth. The desktop client cannot grant itself entitlement.

Pairing flow:

1. desktop creates a short-lived pairing request;
2. user approves the device in the browser;
3. server binds the device to the workspace;
4. desktop receives a revocable device credential;
5. signed production builds store credentials in the OS credential store;
6. the free ad-hoc macOS QA build may use the documented protected local test credential store to avoid unstable Keychain ACL prompts.

When entitlement is not active, new monitoring/scanning is disabled. After a successful payment changes the server from inactive/free to active, an already-open blocked desktop app must detect the new entitlement automatically within 15 seconds without restart.

## Updates

Updates are download-only. CashPatch may check for and download signed application updates but must never upload customer scan content as part of the updater flow.

Production updates must verify signatures before installation. Private updater signing keys are never committed to the repository.

## Interface

Primary navigation includes:

- Watchtower / Overview
- Scan / Live View
- Findings
- Sources
- Permissions
- Security / Vulnerabilities
- Costs / Efficiency
- AI Conversation Review
- Local AI
- Password Vault
- Reports / Scan History
- Subscription
- Settings / Updates / Privacy

The home screen must make the idle state obvious: **No scan is running until you start one.** It must never imply continuous background monitoring when no scan is active.

## Notifications and reports

Native notifications may announce a finding but cannot execute any remediation. Reports are created only when requested by the user and are written locally to a user-selected path. Reports should contain redacted evidence where possible and enough detail for a human or another AI to work through recommendations manually.

## Installer and release gates

A build is not complete because compilation succeeds.

macOS QA gate:

- build current DMG on native macOS;
- `hdiutil verify`;
- mount and copy the packaged app to a separate Applications-style location;
- `codesign --verify --deep --strict`;
- launch the packaged binary and keep it alive through the smoke window;
- apply quarantine metadata and record Gatekeeper behavior;
- `damaged` / `beschädigt` is a hard failure;
- free ad-hoc QA builds may require the normal Control-click/Open or Privacy & Security/Open Anyway flow;
- seamless public distribution requires Developer ID signing/notarization.

Windows QA gate:

- build current NSIS/EXE on native Windows;
- validate PE installer;
- actually install CashPatch;
- launch the installed executable and keep it alive through the smoke window;
- verify installer registration/uninstaller;
- uninstall cleanly;
- an unsigned SmartScreen reputation warning may be documented for an internal QA build, but technical install/start failure is a hard failure.

Final artifacts are commit-specific and accompanied by SHA-256 hashes.

## Product principle

**CashPatch scans only when the human starts the scan. CashPatch watches and explains. The human decides and acts.**
