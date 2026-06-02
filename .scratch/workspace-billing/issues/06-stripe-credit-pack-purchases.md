# Stripe Credit Pack Purchases

Category: enhancement
Type: AFK
Status: completed

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add owner-initiated Stripe Checkout for Credit pack purchases. A Workspace owner should be able to choose a fixed Credit pack for the Workspace's current non-enterprise plan, go through a Stripe Checkout Session, and receive Purchased Credits only after successful Stripe payment events. Pending Checkout Sessions should not appear as balance or Owner billing activity.

This slice also establishes Stripe Customer mapping, signed/idempotent webhook processing, minimal processed Stripe billing event records in D1, and Stripe gateway conventions used by later subscription and invoice slices.

## Acceptance criteria

- [x] Each Workspace has at most one Stripe Customer representing the Workspace, not the owner user.
- [x] Workspace ownership transfer preserves the Stripe Customer and updates billing contact email when applicable.
- [x] Credit pack Checkout can be started only by a session-authenticated Workspace owner.
- [x] Workspace API keys cannot start Credit pack Checkout.
- [x] Credit pack Checkout validates that the selected Stripe Price matches the Workspace's current non-enterprise plan and selected pack size.
- [x] Checkout Session creation attaches Workspace metadata and omits `payment_method_types`.
- [x] Stripe Tax automatic tax is enabled where supported.
- [x] Stripe API writes use idempotency keys.
- [x] Stripe webhooks verify Stripe signatures before processing.
- [x] Minimal processed Stripe billing event records are stored in D1 for idempotency and debugging.
- [x] Duplicate Stripe events do not duplicate Purchased Credit grants.
- [x] Purchased Credits are granted only after successful Stripe payment events.
- [x] Pending Checkout Sessions do not appear as available balance or Owner billing activity.
- [x] Owner Billing page refreshes after Checkout completion/cancel return and shows paid Credits after webhook processing.
- [x] Tests cover Checkout authorization, price validation, Stripe request shape, webhook signature/idempotency, Credit grant creation, duplicate event handling, and owner UI behavior.
- [x] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/02-workspace-billing-ledger-with-manual-credit-grants.md
- .scratch/workspace-billing/issues/05-stripe-dashboard-test-mode-catalog-setup.md

## Implementation notes

- Added owner-only Credit pack Checkout creation backed by Workspace-scoped Stripe Customers, plan/pack Price lookup, automatic tax, Workspace metadata, and Stripe idempotency keys.
- Added signed Stripe webhook processing for paid Credit pack Checkout completions, D1 processed-event records, and idempotent Purchased Credit ledger grants.
- Added ownership-transfer contact sync for existing Stripe Customers.
- Added Billing UI Credit pack buttons and session-scoped Checkout return handling so the app reopens Billing after success/cancel return.
- Configured non-secret Stripe test catalog Product/Price IDs and Checkout return URLs in `backend/wrangler.jsonc`; `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` remain outside source as secrets.

## Verification

- `npm run test --prefix backend`
- `npm run test --prefix frontend`
- `npm run typecheck --prefix backend`
- `npm run build --prefix frontend`
