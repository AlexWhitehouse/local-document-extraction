# Stripe Credit Pack Purchases

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add owner-initiated Stripe Checkout for Credit pack purchases. A Workspace owner should be able to choose a fixed Credit pack for the Workspace's current non-enterprise plan, go through a Stripe Checkout Session, and receive Purchased Credits only after successful Stripe payment events. Pending Checkout Sessions should not appear as balance or Owner billing activity.

This slice also establishes Stripe Customer mapping, signed/idempotent webhook processing, minimal processed Stripe billing event records in D1, and Stripe gateway conventions used by later subscription and invoice slices.

## Acceptance criteria

- [ ] Each Workspace has at most one Stripe Customer representing the Workspace, not the owner user.
- [ ] Workspace ownership transfer preserves the Stripe Customer and updates billing contact email when applicable.
- [ ] Credit pack Checkout can be started only by a session-authenticated Workspace owner.
- [ ] Workspace API keys cannot start Credit pack Checkout.
- [ ] Credit pack Checkout validates that the selected Stripe Price matches the Workspace's current non-enterprise plan and selected pack size.
- [ ] Checkout Session creation attaches Workspace metadata and omits `payment_method_types`.
- [ ] Stripe Tax automatic tax is enabled where supported.
- [ ] Stripe API writes use idempotency keys.
- [ ] Stripe webhooks verify Stripe signatures before processing.
- [ ] Minimal processed Stripe billing event records are stored in D1 for idempotency and debugging.
- [ ] Duplicate Stripe events do not duplicate Purchased Credit grants.
- [ ] Purchased Credits are granted only after successful Stripe payment events.
- [ ] Pending Checkout Sessions do not appear as available balance or Owner billing activity.
- [ ] Owner Billing page refreshes after Checkout completion/cancel return and shows paid Credits after webhook processing.
- [ ] Tests cover Checkout authorization, price validation, Stripe request shape, webhook signature/idempotency, Credit grant creation, duplicate event handling, and owner UI behavior.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/02-workspace-billing-ledger-with-manual-credit-grants.md
- .scratch/workspace-billing/issues/05-stripe-dashboard-test-mode-catalog-setup.md

