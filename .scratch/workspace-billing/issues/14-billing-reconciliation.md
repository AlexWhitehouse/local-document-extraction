# Billing Reconciliation

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add scheduled Billing reconciliation to compare Stripe billing state, D1 billing control data, and Workspace billing ledger summaries. Reconciliation should catch missed webhooks, stale unpaid states, ungranted Included Credits, invoice status drift, and projection drift. It must be idempotent, avoid blindly rewriting ledger history, and record or surface drift for follow-up.

## Acceptance criteria

- [ ] A scheduled reconciliation entry point exists for billing.
- [ ] Reconciliation detects paid Stripe invoices whose entitlement or Credit grants were not applied.
- [ ] Reconciliation detects stale Unpaid billing state when Stripe invoices are paid, voided, or otherwise resolved.
- [ ] Reconciliation detects invoice status drift for subscription, Credit pack, override, ramp-up, annual, and overage invoices.
- [ ] Reconciliation detects missing or inconsistent processed Stripe billing event records where possible.
- [ ] Reconciliation can rebuild or compare Billing ledger balance and usage projections without mutating historical ledger entries.
- [ ] Reconciliation repairs only safe idempotent missing events/grants and records alerts or drift records for ambiguous cases.
- [ ] Duplicate reconciliation runs do not duplicate ledger entries, grants, invoices, or state changes.
- [ ] Reconciliation uses stable Stripe references and ledger idempotency keys.
- [ ] Application admin billing view exposes reconciliation drift/status enough for operational follow-up.
- [ ] Tests cover missed invoice-paid repair, stale unpaid resolution, invoice status drift, projection drift, ambiguous drift reporting, and repeated idempotent runs.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/06-stripe-credit-pack-purchases.md
- .scratch/workspace-billing/issues/07-pro-max-subscription-start.md
- .scratch/workspace-billing/issues/08-subscription-changes-cancellation-and-unpaid-state.md
- .scratch/workspace-billing/issues/12-enterprise-ramp-up-billing.md
- .scratch/workspace-billing/issues/13-enterprise-annual-commitment-and-overage.md

