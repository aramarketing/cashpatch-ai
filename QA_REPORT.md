# CashPatch QA — 0.4

## Passed
- CSV parser compiles standalone with TypeScript
- Scoring engine compiles standalone with TypeScript
- CSV quoted cells and pipe-separated evidence parsed successfully
- Template rows parsed: 4
- Partial payment calculation: €4,200 - €2,800 = €1,400
- Test template total potential: €10,038
- Supabase workspace bootstrap migrated from SECURITY DEFINER to SECURITY INVOKER
- Supabase advisor no longer reports executable SECURITY DEFINER warning
- Billing account table now has member-only SELECT policy
- Stripe products and 4 recurring test prices created successfully
- Stripe code keeps secret keys server-only
- Checkout plan is resolved server-side from a fixed lookup-key allowlist
- Stripe webhook signature is required before billing state is synchronized

## Environment limitation
A full `next build` could not be run because this execution environment timed out while downloading npm packages. `tsc` is installed and standalone core engine modules were compiled and executed successfully. The pinned dependency versions are recorded in package.json for a reproducible remote build.

## Remaining end-to-end tests after deployment
1. Magic-link email login callback
2. First workspace creation through live RLS
3. CSV upload -> Supabase -> Recovery Queue
4. Stripe test Checkout with 4242 4242 4242 4242
5. Webhook -> billing status synchronization
6. Customer Portal return flow
7. Mobile browser visual QA
