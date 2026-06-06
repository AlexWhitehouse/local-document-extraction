# Operator Go-Live Checklist and Manual Stripe Verification

Status: ready-for-human

## What to build

Complete the human-in-the-loop production readiness pass for live billing. An operator must confirm Stripe account readiness, live catalog and key setup, live webhook configuration, test-mode verification, production deploy preflight, rollback/pause procedures, and the exact gate for any low-risk live payment smoke test.

## Acceptance criteria

- [ ] Stripe account live-readiness is confirmed, including account activation, Dashboard access, strong 2FA/passkeys, business profile, payout readiness, support contact, tax/VAT/GST approach, and any Stripe compliance requests.
- [ ] Live-mode Products/Prices are created or confirmed separately from test mode, and the Worker production configuration points at live Price IDs.
- [ ] A live restricted API key is created with the documented least-privilege permissions, or a temporary secret-key exception is documented with owner, expiry, and rotation plan.
- [ ] The live account-scoped webhook endpoint is configured for `https://extract.t3m.uk/v1/billing/stripe/webhook` with the exact supported event allowlist and correct event API version.
- [ ] A Stripe webhook IP allowlisting decision is recorded, including compensating controls if Cloudflare Worker routing makes allowlisting impractical.
- [ ] Stripe test-mode manual verification is run with Stripe CLI or Dashboard flows for Credit packs, delayed payments, subscription start/upgrade/downgrade/cancel/reversal/deletion, payment-required Plan override, Enterprise annual upfront, Enterprise ramp-up, Enterprise overage, failed renewal, payment recovery, duplicate replay, and out-of-order delivery where practical.
- [ ] A production deploy preflight is completed without printing secrets, including remote D1 migrations, Durable Object migrations, required secrets, Cron Trigger, custom domain health, and frontend asset build.
- [ ] A rollback/pause runbook is documented for stopping new Checkout creation, disabling or narrowing live webhooks, rolling back the Worker, rotating secrets, and running reconciliation after recovery.
- [ ] Any live payment smoke test is explicitly approved as a low-risk business action after all other launch blockers are closed.

## Blocked by

- [03-stripe-api-safety-restricted-key-contract.md](.scratch/workspace-billing-production-readiness/issues/03-stripe-api-safety-restricted-key-contract.md)
- [10-billing-reconciliation-production-coverage.md](.scratch/workspace-billing-production-readiness/issues/10-billing-reconciliation-production-coverage.md)
- [11-scheduled-billing-runtime-observability.md](.scratch/workspace-billing-production-readiness/issues/11-scheduled-billing-runtime-observability.md)
- [12-worker-production-deploy-secret-preflight.md](.scratch/workspace-billing-production-readiness/issues/12-worker-production-deploy-secret-preflight.md)
