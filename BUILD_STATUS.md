# CashPatch Build Status — 0.4

## Live backend already configured
- Supabase project: `cashpatch-ai` in `eu-central-1`
- Core schema, RLS, workspace ownership, findings, scans, drafts, billing tables
- Atomic workspace bootstrap via `SECURITY INVOKER` RPC
- Billing account read access limited to workspace members
- Internal sync/token tables remain client-blocked

## Stripe test-mode already configured
Products:
- CashPatch Standard
- CashPatch Pro

Prices:
- `cashpatch_standard_monthly` — €49/month
- `cashpatch_standard_yearly` — €490/year
- `cashpatch_pro_monthly` — €99/month
- `cashpatch_pro_yearly` — €990/year

## Application code implemented
- Magic-link authentication
- Next.js 16 proxy session refresh via Supabase `getClaims()`
- Workspace onboarding
- RLS-protected dashboard
- Recovery Queue
- Finding status actions
- CSV import API
- Deterministic money-leak scoring engine
- Stripe hosted Checkout endpoint
- Stripe Customer Portal endpoint
- Signed Stripe webhook endpoint
- Billing status synchronization into Supabase

## Verified engine test
The supplied CSV template creates 4 findings:
- Quote silent: €4,800
- Invoice overdue: €2,650
- Partial invoice: €1,400 outstanding from €4,200 total / €2,800 paid
- Renewal: €1,188
Total potential: €10,038

## Environment still required for deployed app
Server-side secrets must be set in Vercel (never in client code):
- `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Client-safe variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Deployment blocker
The connected Vercel tools in this session can inspect existing projects, but cannot create/deploy a new project from the `/mnt/data/cashpatch-app` source. GitHub is connected but currently has no `cashpatch` repo and the available connector actions do not expose repository creation.

Fastest handoff: create one empty private GitHub repository named `cashpatch-ai` (or a blank Vercel project linked to it). After that, the repository-writing tools can populate it and Vercel can build from Git.

## Security decision pending
Supabase currently reports `private.oauth_credentials` with RLS disabled. It contains zero rows today. Do not store production OAuth credentials there yet.

Recommended remediation to approve before OAuth goes live:
```sql
ALTER TABLE private.oauth_credentials ENABLE ROW LEVEL SECURITY;
```
with **no client policies**, so only privileged server-side code can access it. This remediation has intentionally NOT been auto-applied because Supabase explicitly flags it as a deliberate access-control decision.
