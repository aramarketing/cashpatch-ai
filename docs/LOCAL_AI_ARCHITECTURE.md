# CashPatch Local AI Architecture

## Product core

CashPatch is a local-first, review-only business observer.

A lightweight desktop application runs continuously on the user's computer and connects to approved business systems. It monitors signals, performs local analysis, creates evidence-backed findings, and notifies the user when something appears financially important or operationally wrong.

CashPatch never executes actions in connected systems.

## Core promise

**CashPatch watches. The human decides.**

The local agent may:
- read approved data
- search approved systems
- watch approved folders and browser pages
- synchronize read-only data
- analyze locally
- correlate events across systems
- detect anomalies, missing follow-ups, overdue money and stalled work
- create findings and draft recommendations
- notify the user

The local agent must never:
- send email or messages
- edit CRM or project-management records
- create, update or delete tasks
- click or type in external applications
- submit forms
- upload files
- modify, move, rename or delete files
- create invoices
- charge, refund, transfer or pay money
- approve or execute recommendations

## Architecture

### 1. CashPatch Desktop App

Cross-platform application for macOS and Windows.

Responsibilities:
- system tray / menu-bar presence
- first-run onboarding
- local permission management
- source connections
- local model management
- notification center
- finding review
- health/status display
- local audit log

Recommended implementation:
- Tauri desktop shell
- Rust background service
- TypeScript/React UI
- local encrypted SQLite database
- OS keychain / secure credential storage

### 2. Local AI Runtime

Default mode is local inference.

MVP:
- connect to a local OpenAI-compatible runtime such as Ollama or LM Studio
- support local models selected by the user

Production:
- optionally bundle a small quantized model with the installer
- allow a larger local model when hardware permits
- deterministic detection rules run before LLM analysis
- LLM output is advisory and must include evidence references

The local model is used for:
- classification
- entity extraction
- relationship detection
- anomaly explanation
- summarization
- ranking
- semantic matching

The local model is not given external write tools.

### 3. Connector Runtime

Every connector implements a common read-only interface.

Supported connection methods:
- OAuth2 with read-only scopes
- restricted API keys
- inbound webhooks
- MCP servers exposing read-only tools
- local filesystem observers
- browser observer extension
- local application adapters

Common capabilities:
- list
- read
- search
- inspect
- sync
- receive events

Forbidden capabilities:
- create
- update
- delete
- send
- execute
- click
- type
- upload
- submit
- charge
- refund
- payout

If a provider cannot guarantee read-only access, the connector must fail closed.

### 4. Local Event Bus

All source data is normalized into local events.

Examples:
- quote_sent
- quote_no_reply
- invoice_due
- invoice_overdue
- payment_failed
- deal_stalled
- project_blocked
- renewal_upcoming
- customer_promised_payment
- customer_silent
- task_overdue
- subscription_changed
- duplicate_charge
- unusual_refund
- bank_balance_change
- bank_transaction_received
- invoice_payment_missing
- invoice_payment_matched
- duplicate_bank_charge
- recurring_cost_increase
- unexpected_bank_fee
- missing_followup

Each event includes:
- source
- source reference
- timestamp
- counterparty
- optional monetary value
- evidence
- confidence
- sensitivity classification

### 5. Detection Engine

Pipeline:
1. deterministic rules
2. cross-source correlation
3. local AI classification
4. confidence scoring
5. financial impact estimate
6. deduplication
7. finding creation

Only sufficiently strong findings trigger notifications.

### 6. Notification Engine

CashPatch should feel like a quiet business watchdog.

Notification channels:
- native desktop notification
- in-app inbox
- optional daily digest
- optional urgent alert

Examples:
- "€4,800 quote has had no reply for 9 days."
- "Invoice for €2,650 is 14 days overdue."
- "A deal worth €12,000 has had no activity for 18 days."
- "Project delivery is blocked and the next invoice milestone may slip."
- "Customer promised payment Friday; no payment is visible."
- "Subscription renewal increased 31% versus the previous term."

Each alert must show:
- why it was triggered
- evidence
- financial value or risk
- confidence
- recommended human action

### 7. Privacy Model

Default:
- raw source data stays local
- local model performs analysis
- cloud receives only user-approved findings, metadata and billing/account state

Optional modes:
- Local only
- Local analysis + cloud sync of findings
- Team sync

Never upload complete mailboxes, file trees or CRM datasets by default.

### 8. Computer Observer

The desktop agent may observe approved local areas.

Filesystem:
- explicit folder allowlist
- read-only file handles
- filesystem watchers
- no create/update/delete permissions

Applications:
- prefer official read-only APIs
- otherwise use exported/read-only local data where available

Screen observation:
- explicit opt-in
- selected app/window only
- local processing
- screenshots are ephemeral unless user explicitly chooses retention

No keyboard or mouse automation.

### 9. Browser Observer

Browser extension:
- explicit site allowlist
- read-only DOM inspection
- no form submission
- no keyboard input
- no automated clicking
- no navigation automation
- no uploads

The extension emits structured observations to the local desktop agent.

### 10. Cloud role

CashPatch Cloud is optional coordination infrastructure, not the primary intelligence layer.

Cloud responsibilities:
- account
- subscription
- connector metadata
- finding sync
- team access
- encrypted backup of allowed metadata
- software updates
- remote configuration of detection rules

Local agent remains the source of truth for raw business data.

## Always-on behavior

The agent starts with the operating system and remains idle with low resource use.

Triggers:
- filesystem changes
- provider webhooks
- scheduled sync
- mail/calendar sync
- browser observations
- CRM/project-management polling
- payment events

Recommended default cadence:
- event-driven where possible
- every 5-15 minutes for active systems
- slower cadence for low-change systems

The user can pause all monitoring instantly.

## Trust features

Every finding must expose:
- source systems
- evidence references
- timestamp
- confidence
- reason
- what CashPatch did
- confirmation that no source was changed

A local audit log records every read/sync/analyze operation.

## Future connector strategy

Priority order:
1. Banking: PSD2/Open Banking account information (balances + transactions only)
2. Email: Gmail, Outlook
3. Payments: Stripe, PayPal
4. CRM: HubSpot, Salesforce, Pipedrive, Zoho, Dynamics 365
5. Project management: Asana, ClickUp, Trello, monday.com, Jira, Notion, Linear
6. Accounting: Xero, QuickBooks, Lexoffice, sevDesk
7. Commerce: Shopify, WooCommerce
8. Communication: Slack, Teams
9. AI: OpenAI, Claude, Gemini, Perplexity, local models
10. Universal: MCP, REST/OpenAPI, webhooks
11. Computer/browser observers

## Product principle

CashPatch is not another CRM, accounting package or automation platform.

It is a local business watchdog sitting above existing systems.

It watches everything the user permits, changes nothing, and surfaces what deserves human attention.
