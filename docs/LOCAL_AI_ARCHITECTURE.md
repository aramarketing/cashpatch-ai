# CashPatch Local AI Architecture

## Product principle

CashPatch is a local-first, review-only audit application for macOS and Windows.

**CashPatch inspects only after the user starts a scan. It changes nothing. The human decides.**

The application does not continuously monitor in the background. Starting the app, logging in, pairing a device, closing the main window to the tray, enabling autostart or checking for updates must never initiate a content scan.

## User-controlled scan lifecycle

### 1. Idle

After launch CashPatch may verify account entitlement and update availability. It does not inspect business content.

### 2. Quick Scan

The user reads the consent notice and presses **Start Quick Scan**. Quick Scan is metadata-oriented and may inventory only what current OS permissions make readable, including:

- operating-system and hardware summary;
- disks and storage capacity;
- installed applications;
- running process names;
- autostart locations;
- network-interface metadata;
- reachable file/folder counts and sizes;
- explicitly configured read-only connectors;
- available local AI runtimes;
- permission boundaries.

Quick Scan produces an estimated Full Scan duration, scope and source count.

### 3. Full Scan confirmation

A Full Scan cannot start automatically. The user must explicitly confirm it after seeing the Quick Scan estimate.

### 4. Full Scan

The Full Scan may locally inspect approved data sources and supported business documents. The live view shows current phase/source, progress, file/data counters, ETA and findings. The user can pause or cancel at any time.

### 5. Completed / report

CashPatch shows findings with evidence, severity/confidence, possible financial impact, explanation and recommended human remediation. It never exposes an Execute/Fix button. Reports are written only when the user explicitly chooses a local Save action.

## Local AI runtime

Local inference is the default and required content-analysis path.

Supported provider abstraction:

- Ollama on loopback;
- LM Studio on loopback;
- Jev-compatible local endpoint on loopback;
- configurable custom local endpoint on loopback;
- future bundled local model when licensing, size and hardware constraints permit.

There is no silent cloud-AI fallback. If no local model is available, CashPatch explains what is missing and deterministic analyzers continue where possible.

Local AI is used for advisory tasks such as:

- document classification;
- entity and obligation extraction;
- anomaly explanation;
- semantic duplicate detection;
- contradiction detection;
- conversation review;
- summarization;
- confidence/risk ranking.

The local model is never given external write tools, credentials, browser automation or payment capability.

## Deterministic-first analysis pipeline

1. bounded read-only collection;
2. deterministic parsing and normalization;
3. hashing/deduplication;
4. deterministic business/security rules;
5. optional local AI classification/explanation;
6. confidence calculation;
7. financial impact estimate where evidence supports it;
8. finding deduplication;
9. evidence-backed finding creation.

LLM output alone must not create a high-confidence factual finding without traceable local evidence.

## Local data plane

Raw scan content remains on the device. Components include:

- Rust scan scheduler active only for a user-started scan;
- filesystem/system collectors;
- document parsers;
- local normalized observation store;
- local AI router;
- finding engine;
- encrypted password vault;
- local scan history/journal;
- local report exporter.

The UI receives bounded status/evidence payloads instead of full file or conversation bodies wherever possible.

## Connector runtime

Every connector must implement a common read-only capability contract.

Allowed conceptual capabilities:

- list;
- read;
- search;
- inspect;
- fetch metadata;
- fetch read-only records.

Forbidden capabilities:

- create;
- update;
- delete;
- send;
- execute;
- click;
- type;
- submit;
- upload;
- charge;
- refund;
- payout;
- transfer;
- payment initiation.

If a provider cannot enforce appropriate read-only access, CashPatch must fail closed or require a user-generated export instead.

## Banking

Banking is Account Information Services only. CashPatch may read account metadata, balances and transactions from an explicitly connected read-only provider and analyze them locally.

It must never initiate payments, transfers, standing orders, refunds, payouts or any other banking write operation.

## AI conversation review

Conversation analysis is supported only through legitimate, user-approved read paths:

- user-selected provider exports;
- user-selected local export files;
- official provider read-only APIs where available.

CashPatch does not scrape browser passwords, steal session cookies, bypass provider security or silently inspect sessions.

Conversation analyzers look for evidence-backed issues such as:

- contradictory decisions/instructions;
- forgotten commitments or tasks;
- unresolved risks;
- cost or contract mistakes;
- unsupported assumptions;
- repeated work and inefficiency.

Content is treated as untrusted data and cannot grant CashPatch capabilities.

## Password vault

The optional vault is local only and accepts only credentials the user deliberately adds/imports.

Security baseline:

- Argon2id key derivation from master passphrase;
- XChaCha20-Poly1305 authenticated encryption;
- random salts/nonces;
- auto-lock;
- short-lived secret reveal/clipboard handling;
- no plaintext secret logs;
- no cloud sync;
- no autonomous login or credential replay.

CashPatch does not harvest credentials from browsers, applications or the OS.

## Network egress

Native egress is default-deny. The only permitted classes are:

1. CashPatch account pairing/entitlement control plane;
2. signed update checks/downloads;
3. vulnerability-feed downloads into a local cache;
4. explicitly connected read-only provider APIs;
5. loopback local-AI endpoints.

Scan contents, document bodies, conversations, password-vault data, financial payloads, findings and report bodies are never uploaded to CashPatch cloud.

## Cloud role

CashPatch cloud is a minimal control plane, not the audit engine.

Allowed responsibilities:

- account authentication;
- device pairing;
- subscription/entitlement state;
- update-channel metadata;
- non-content connector metadata where needed.

Forbidden cloud storage:

- local file trees;
- scanned documents;
- mailbox/conversation contents;
- passwords/secrets;
- bank transaction payloads;
- local findings/evidence;
- scan reports.

## Filesystem and system inspection

Collectors use native read-only APIs and normal filesystem reads. They do not elevate privileges or bypass OS protections.

Rules:

- explicit consent before inventory/content scan;
- symlink following disabled unless a future explicit safe mode is designed;
- permission-denied entries recorded as boundaries, not bypassed;
- caches/build trees skipped where appropriate;
- file-size and resource limits;
- CPU/RAM/IO throttling;
- malformed files fail per item instead of aborting the whole audit;
- no file create/edit/move/delete as a remediation action.

## Browser boundary

Browser observation, if implemented, is separately opt-in and read-only. CashPatch must not extract passwords or session cookies, submit forms, click, type, navigate autonomously or upload files.

Prefer official APIs or user exports over DOM observation.

## Updates

Updates are download-only. Production update artifacts must be signed and cryptographically verified. Downloading an update never uploads customer scan data.

Public production release requires platform release identity:

- macOS: Developer ID signing + notarization;
- Windows: code signing.

Internal QA may use unsigned/ad-hoc installers with the documented limitations, but those builds must still pass native install/start E2E gates.

## Findings contract

Each finding should contain:

- category;
- severity;
- confidence;
- concise title;
- explanation;
- bounded evidence/source reference;
- possible monetary impact when defensible;
- recommended human remediation;
- explicit confirmation that CashPatch changed nothing.

## Non-negotiable tests

CI and E2E must continuously prove:

- no scan starts automatically;
- Quick Scan requires consent;
- Full Scan requires a second confirmation;
- pause/cancel work;
- unknown network destinations are blocked;
- local AI is loopback-only;
- connector write capabilities remain absent;
- Banking remains AIS-only;
- vault crypto/lock boundaries hold;
- native Windows installer installs/runs/uninstalls;
- native macOS DMG verifies/copies/signature-checks/runs;
- no damaged/beschädigt Gatekeeper class failure is accepted as PASS.
