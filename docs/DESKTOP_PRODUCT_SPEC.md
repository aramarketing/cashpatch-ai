# CashPatch Desktop Product Specification

## Product form

CashPatch is a downloadable and installable desktop application for macOS and Windows.

The web application is reduced to:
- account management
- subscription and billing
- device pairing
- download page
- release notes
- support

The desktop application is the primary product.

## Desktop stack

- Tauri 2 desktop shell
- Rust local service
- React/TypeScript UI
- local encrypted database
- OS keychain/credential vault
- native notifications
- signed updater
- local AI runtime
- read-only connector runtime

## Startup behavior

CashPatch can launch automatically when the user signs in to the computer.

At startup:
1. verify local installation integrity
2. check current app version
3. check for signed updates
4. verify paid entitlement
5. load local permission state
6. start only approved read-only connectors
7. start local detection engine
8. show tray/menu-bar status

If entitlement is not valid, monitoring does not start.

## Paid entitlement

CashPatch must only perform monitoring and analysis while the subscription is valid.

Source of truth:
Stripe -> CashPatch webhook -> Supabase billing_accounts -> desktop entitlement endpoint.

Allowed paid states:
- active

All other states disable monitoring:
- free
- trialing unless explicitly converted to paid entitlement
- past_due
- canceled
- unpaid
- incomplete
- incomplete_expired
- paused

The desktop app checks entitlement:
- at launch
- when waking from sleep
- when network connectivity returns
- periodically while running

A short signed offline lease may be cached so temporary internet loss does not break the app. The lease must expire automatically and cannot be extended locally.

When entitlement expires:
- source monitoring stops
- scheduled synchronization stops
- local AI analysis stops
- existing findings remain viewable
- the interface shows a subscription-required screen
- the user can open the billing portal

The local client must never be able to grant itself entitlement.

## Device binding

Each installation has a generated device identity.

CashPatch stores:
- device public ID
- platform
- architecture
- app version
- device public key
- last-seen timestamp

Private device secrets stay only in the OS keychain.

A user pairs a new installation through the web account:
1. desktop shows a short pairing code
2. desktop opens the CashPatch website
3. user signs in
4. user approves the detected device
5. cloud binds device to the paid workspace
6. desktop receives a device credential
7. credential is stored in Keychain / Windows Credential Manager

Devices can be revoked remotely.

## Permission discovery

CashPatch discovers what can be connected without reading private content first.

It may detect:
- installed supported desktop applications
- supported browsers
- available local AI runtimes
- already-running local API endpoints
- previously approved folders
- already-configured CashPatch connectors

It must not silently inspect private file contents, mailbox contents or browser history before permission is granted.

For every missing permission, CashPatch shows:
- what it wants to read
- why it is useful
- exactly which permission is requested
- explicit confirmation that it is read-only
- a Connect / Grant access button
- a link or deep-link to the exact provider or operating-system permission screen

Examples:
- Gmail -> opens Google OAuth read-only consent
- Outlook -> opens Microsoft read-only OAuth consent
- HubSpot -> opens HubSpot read-only OAuth consent
- local folder -> opens native folder chooser
- macOS privacy permission -> opens the relevant System Settings pane where possible
- browser observer -> opens extension install/permission flow
- local model missing -> opens one-click local model setup

## Review-only guarantee

All connected systems are read-only.

CashPatch may:
- read
- list
- search
- inspect
- synchronize
- analyze
- notify
- create internal findings
- create internal recommendations

CashPatch may not:
- send email or messages
- create/update/delete CRM records
- create/update/delete project tasks
- click or type in external software
- submit browser forms
- upload or modify files
- change settings in connected services
- create invoices
- charge/refund/pay/transfer money

If a provider cannot technically guarantee read-only access, the connector must fail closed.

## Local AI

The primary intelligence layer runs on the user's computer.

First implementation:
- detect Ollama / LM Studio / compatible local endpoints
- offer one-click setup if no local runtime is present

Later production implementation:
- bundle or automatically download a supported quantized model
- hardware-aware model selection
- deterministic rules before LLM analysis
- no external write tools exposed to the model

The local AI continuously correlates approved data across sources.

## Interface

The desktop application has its own interface.

Primary navigation:
- Watchtower / Overview
- Findings
- Sources
- Connections requiring permission
- Notifications
- Local AI
- Activity log
- Subscription
- Settings

Home screen shows:
- monitoring state
- paid entitlement state
- connected sources
- missing permissions
- latest findings
- highest-value risks
- last successful scan
- update status
- confirmation: "Review only — no source changes"

The app also lives in the system tray / macOS menu bar.

## Notifications

CashPatch alerts the user when a meaningful finding appears.

Default channels:
- native desktop notification
- in-app finding inbox

Optional:
- daily digest
- urgent-only mode

Notifications contain:
- finding title
- monetary value or risk
- source(s)
- confidence
- reason
- button to open CashPatch finding

No action is executed from the notification.

## Automatic updates

CashPatch uses signed application updates.

Updater behavior:
- check at startup
- check periodically while running
- download only signed update artifacts
- verify signature before install
- show release notes
- support required minimum versions for security fixes

Recommended implementation:
- Tauri updater
- signed update artifacts
- CI builds for macOS and Windows
- staged release channels: stable / beta
- cloud endpoint controls current and minimum supported versions

The updater signing private key must never be stored in the repository.

## Release distribution

macOS:
- DMG installer
- Apple code signing
- notarization for public distribution

Windows:
- NSIS or MSI installer
- code signing recommended to avoid SmartScreen warnings

Development builds can be produced before commercial signing is purchased.

## Background operation

CashPatch runs quietly in the background.

Preferred behavior:
- event-driven where APIs/webhooks permit
- scheduled read-only sync otherwise
- low-power idle mode
- pause button
- no monitoring when entitlement is invalid
- automatic resume after payment is restored and entitlement becomes valid

## Update and subscription trust chain

Stripe is the billing source of truth.

No client-side flag can unlock the app.

Flow:
1. Stripe subscription changes
2. webhook updates server billing state
3. desktop requests signed entitlement
4. server checks workspace + subscription + device
5. server grants or denies short-lived lease
6. desktop verifies lease
7. monitoring is enabled only while the lease is valid

A modified local UI alone cannot create a valid server-signed entitlement.

## Product principle

CashPatch is an installed local business watchdog.

It discovers supported systems, asks for the minimum read-only permission it needs, links the user directly to the correct permission flow, watches continuously, updates itself, and stops monitoring when there is no valid paid subscription.

CashPatch watches. The human decides.
