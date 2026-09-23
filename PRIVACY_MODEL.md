# CashPatch Privacy Model

CashPatch is designed to perform a deep business/computer audit **on the user's own device** while keeping customer content out of the CashPatch cloud control plane.

## Privacy promise

The default product contract is simple:

- **scan locally**;
- **analyze locally**;
- **store findings locally**;
- **export only when the user asks**;
- **never upload scan content to CashPatch**;
- **never change connected source systems**.

The cloud account exists for identity, device pairing, subscription entitlement and signed update delivery, not as a repository for the user's audit data.

## Data classes

### A. Local audit content — never uploaded to CashPatch

Examples:

- file/document contents;
- AI conversation exports;
- invoices, contracts, offers and receipts;
- local process/application inventory beyond what is required for local analysis;
- findings/evidence;
- scan history details;
- password-vault data;
- report contents;
- browser data selected for legitimate review.

This data remains on-device unless the user deliberately connects a third-party read-only source whose API must return that source data to CashPatch for local analysis. Source data fetched from a provider is processed locally and is not re-uploaded to CashPatch.

### B. Local secrets — never uploaded to CashPatch

Examples:

- vault entries;
- vault master passphrase;
- browser passwords;
- session cookies;
- local AI prompts/content;
- local connector credentials where a provider supports on-device credential storage.

CashPatch must never scrape browser password/session stores.

### C. Control-plane data — may reach CashPatch services

Minimal examples:

- CashPatch account/user ID;
- workspace/subscription status;
- paired device ID/name/platform/app version;
- hashed or protected pairing/device authentication material as required by the pairing protocol;
- update target/architecture/current version.

No scanned document body or finding evidence is required for these operations.

### D. Explicit third-party connector data

A user may deliberately connect a read-only source such as email, CRM, calendar, accounting, commerce, storage or banking account-information access.

Rules:

- connection is opt-in;
- use the minimum read scope;
- data is analyzed locally where technically possible;
- no source-system mutation is permitted;
- no CashPatch cloud persistence of fetched business content;
- disconnect/revoke must be available through the provider/CashPatch connection center.

## Consent layers

CashPatch separates consent into distinct decisions instead of treating installation as blanket permission.

1. **Device/account pairing** — links the app to a CashPatch account for entitlement/update control.
2. **Source/permission consent** — user chooses folders or read-only online sources.
3. **Quick Scan consent** — permits local metadata/scope inventory only.
4. **Full Scan consent** — second confirmation permits local content analysis within the approved scope.
5. **Conversation-review consent** — a user deliberately chooses a local export before CashPatch reads it.
6. **Report export** — user deliberately chooses a destination before any report is written.
7. **Vault creation/import** — user deliberately adds each secret; there is no silent credential collection.

## Quick Scan privacy behavior

Quick Scan is intended to estimate scope and duration without performing deep semantic review.

It may count/measure:

- files/directories;
- byte totals;
- accessible application locations;
- installed software counts;
- running-process counts;
- network-interface counts;
- autostart-entry counts;
- permission-denied boundaries.

Quick Scan should not send this information to CashPatch cloud services.

## Full Scan privacy behavior

After the user confirms, Full Scan may locally:

- hash files for duplicate detection;
- extract bounded text from supported business documents;
- detect invoice/contract/cost/security signals;
- run approved local AI over bounded text;
- compare software versions against a local vulnerability database;
- create local findings and evidence snippets.

Full Scan must not modify reviewed files.

## AI conversation review

CashPatch does not bypass provider protections or scrape private AI accounts.

Supported privacy-preserving paths are:

- user-selected official exports;
- read-only provider APIs where an appropriate legitimate API exists;
- locally available legitimate export data explicitly selected by the user.

Conversation analysis is local. Potential credentials detected in a conversation must be reported with redacted evidence rather than reproducing the suspected secret.

## Local AI

CashPatch supports local model runtimes such as Ollama, LM Studio and explicitly configured Jev-compatible/local endpoints.

- endpoints must resolve to the local machine/loopback boundary;
- there is no hidden cloud fallback;
- scanned content is not sent to hosted AI by CashPatch;
- local model output is advisory and cannot override native security policies.

The user is responsible for the separate privacy behavior of third-party local AI software installed on their computer. CashPatch should prefer runtimes configured for local inference with telemetry disabled where possible.

## Password vault privacy

The CashPatch vault is optional.

- user enters/imports credentials deliberately;
- vault data is strongly encrypted on-device;
- master passphrase is not persisted;
- no cloud sync by default;
- no autonomous login/form filling;
- no credential contents in reports or diagnostics;
- revealed values are displayed only temporarily after explicit action.

## Scan history and recovery

Scan history is local and contains summary metadata such as timestamps, counters, duration/status and finding counts. It should not contain full document bodies, passwords or raw conversation contents.

A crash/interruption journal may retain enough metadata to offer recovery, but CashPatch must never silently resume scanning. The user must explicitly confirm recovery.

## Reports

Reports are generated only after a user chooses to save them.

Reports may contain findings/evidence selected by the local scanner. Because such reports can be sensitive, CashPatch should clearly tell the user that sharing a report with another AI/person moves that data outside CashPatch's local privacy boundary.

CashPatch does not automatically upload exported reports.

## Telemetry

Product telemetry must be either absent by default or strictly content-free.

Forbidden telemetry fields include:

- filenames/paths from scanned content;
- document/message text;
- finding evidence;
- invoice/account transaction details;
- passwords/tokens/cookies;
- report content.

If diagnostic telemetry is added later, it must be explicit, minimised, documented and redacted.

## Update traffic

Update checks may transmit only the information required to select an update, such as application version, OS target and architecture. Updates are download-only from the application's perspective; the update flow is not a channel for audit-data uploads.

## Data deletion

The product should provide clear local controls to remove:

- approved folder paths;
- local scan history/recovery journal;
- optional local AI endpoint settings;
- local vault entries/vault (with deliberate confirmation);
- cached vulnerability database where appropriate;
- device pairing through account/device management.

Deleting CashPatch's cloud account/device metadata is separate from deleting local audit state because audit content is intentionally not stored in the CashPatch cloud.

## Privacy verification gates

Automated tests/review should continuously assert that:

- scan content is never included in account/entitlement requests;
- unknown network hosts are blocked;
- local AI endpoints cannot be remote hosts;
- reports require an explicit local save action;
- browser credential/session stores are not read;
- vault plaintext is absent from persisted ciphertext/logs;
- scan history contains metadata only;
- connector capability declarations remain read-only;
- banking capabilities remain account-information only;
- no background scan is started during application boot.

## Public-release disclosure

Before public release, product documentation/privacy notices must describe the exact connected providers, scopes, local storage locations, retention controls and any unavoidable provider-side data processing. This repository document defines the engineering baseline; it is not legal advice or a substitute for a jurisdiction-specific privacy notice.
