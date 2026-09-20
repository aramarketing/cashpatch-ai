# CashPatch App 0.3

Production-oriented Next.js 16 + Supabase app shell for CashPatch.

## Implemented
- Supabase magic-link auth
- Next.js proxy session refresh using `getClaims()`
- Atomic workspace creation via `create_workspace` RPC
- Real workspace + findings reads protected by RLS
- Finding status updates through Server Actions
- Premium responsive dashboard matching the CashPatch visual system

## Environment
Copy `.env.example` to `.env.local` and set the Supabase publishable key.

## Important security hold
`private.oauth_credentials` currently has RLS disabled in Supabase. Do not store production OAuth tokens there until the deliberate RLS/private-schema decision is applied.


## Build 0.4 additions
- Stripe Checkout + Customer Portal + webhook synchronization
- Four live Stripe test prices using stable lookup keys
- Server-side CSV ingest pipeline into Supabase
- Deterministic leak engine tested against the included CSV template

See `BUILD_STATUS.md` and `QA_REPORT.md`.
