# CashPatch Connector Security Model

CashPatch is a review-only system.

## Non-negotiable rule

A connected external system may be read, searched, synchronized and analyzed. CashPatch must never mutate it.

CashPatch may create findings, explanations, internal drafts and recommended next actions inside CashPatch itself. Those artifacts are advisory only. CashPatch must not execute the recommended action in the connected source.

## Provider permissions

Use provider-enforced read-only scopes whenever the provider offers them.

Examples include mail read scopes instead of mail read/write scopes, CRM object read scopes instead of write scopes, restricted payment keys with read access only, and bank-account access limited to account information such as balances and transactions.

If a provider cannot issue a credential that is technically restricted to read-only access, CashPatch must require a dedicated source account whose permissions are read-only. If neither option is possible, that integration is not eligible for production connection.

## Banking

Banking integrations are account-information-only.

Allowed:
- account list
- account identity/metadata
- balances
- booked and pending transactions
- transaction counterparties and descriptions
- recurring-transaction detection where exposed read-only

Forbidden:
- payment initiation
- transfer creation
- beneficiary creation or modification
- direct debit creation
- card controls
- refunds
- payouts
- any write/payment scope

CashPatch must use a licensed Open Banking / account-information provider or another compliant bank API integration. The customer authenticates with the bank/provider; CashPatch must not ask the customer to type online-banking passwords directly into CashPatch.

## Computer and browser agents

The desktop agent is observer-only:
- screen capture / OCR / local analysis may be used;
- approved folders may be opened read-only;
- it must not request or use keyboard/mouse automation;
- it must not create, edit, rename, move or delete files;
- it must not launch transactions or submit forms.

The browser agent is observer-only:
- it may inspect approved pages and extract permitted data;
- it must not navigate on the user's behalf, click buttons, type, upload files or submit forms;
- it must expose no action API to CashPatch.

## Backend enforcement

- source_connections.permission_mode is constrained to review_only.
- source_connections.external_write_allowed is constrained to false.
- write-like capabilities are rejected by a database CHECK constraint.
- private.oauth_credentials has RLS enabled and no browser policies.
- anon and authenticated roles have no privileges on private.oauth_credentials.
- connector code uses review-only adapters and exposes no mutation primitive.
- internal action drafts cannot enter a sent state.

## Fail closed

If read-only access cannot be guaranteed, the connector must fail closed and remain unavailable.
