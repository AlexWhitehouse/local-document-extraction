# Stripe Dashboard/Test-Mode Catalog Setup

Category: enhancement
Type: HITL
Status: ready-for-human

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Create or confirm the Stripe test-mode billing catalog and configuration needed by the implementation slices. This is a human-in-the-loop setup slice because it requires access to Stripe Dashboard and decisions about real Stripe resources. The app should receive only environment configuration and secrets; no Stripe secret values should be committed.

Set up test-mode Products/Prices for Pro, Max, and every Credit pack plan/size combination; configure Stripe Tax registrations/settings as appropriate; create a restricted API key with least-privilege permissions; configure the webhook endpoint event scope; and document the environment variable names that implementation slices will consume.

## Acceptance criteria

- [ ] Stripe test mode contains pre-created monthly recurring Prices for Pro (£50/month) and Max (£200/month).
- [ ] Stripe test mode contains pre-created one-time Prices for Credit packs for each Free/Pro/Max and 100/500/1,000/5,000 combination.
- [ ] The Free plan has no recurring Stripe Price.
- [ ] Stripe product and price IDs are mapped to documented environment variable names.
- [ ] Stripe Tax setup is reviewed and automatic tax can be enabled for Checkout Sessions, Subscriptions, and Invoices.
- [ ] A restricted API key is created or identified for backend billing operations with least required permissions.
- [ ] A webhook signing secret is available for local/test webhook verification.
- [ ] The webhook endpoint event scope is limited to required Checkout completion, invoice payment/failure/voiding, subscription lifecycle, and customer update events when needed.
- [ ] Stripe test mode and future live mode resources are kept separate.
- [ ] No Stripe API keys, webhook signing secrets, or sensitive values are committed to the repo.
- [ ] A short setup note exists for future agents explaining which env vars must be present locally and in deployment.

## Blocked by

- .scratch/workspace-billing/issues/01-billing-page-foundation-with-free-entitlement.md

