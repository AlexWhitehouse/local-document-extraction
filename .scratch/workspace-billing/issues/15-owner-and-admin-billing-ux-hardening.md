# Owner And Admin Billing UX Hardening

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Harden the owner Billing page, Application admin billing view, blocked-upload experience, toasts, empty states, loading states, and error handling after the core billing paths exist. This slice should make billing understandable and ergonomic for Workspace owners, non-owner members, and Application admins without adding new billing domain rules.

## Acceptance criteria

- [ ] Owner Billing page presents current entitlement, scheduled changes, available Credits, remaining page capacity, Included Credit renewal, usage, invoices, payment setup, Credit pack actions, subscription actions, and Owner billing activity clearly.
- [ ] Owner Billing page never exposes internal admin notes, raw Stripe identifiers, reconciliation internals, or Application admin billing audit details.
- [ ] Non-owner Workspace members never see Billing page navigation or owner-only billing controls.
- [ ] Non-owner blocked-action UI shows only limited Billing operational status.
- [ ] Upload UI disables obvious blocked submissions before file selection using advisory entitlement summaries.
- [ ] Upload UI handles final backend billing rejection after PDF page count with actionable feedback.
- [ ] Credit pack Checkout, subscription starts, portal links, and invoice links have loading, success, cancellation, and failure states.
- [ ] Application admin billing view presents Plan overrides, No-billing mode, Goodwill Credits, payment-required overrides, Enterprise terms, invoice state, collection mode, invoice review mode, audit entries, and reconciliation drift/status coherently.
- [ ] Billing actions use Action toasts or inline validation consistently with the existing app.
- [ ] Billing UI fits the existing app layout and responsive constraints.
- [ ] Tests cover owner page visibility, non-owner boundaries, blocked upload copy/state, owner activity privacy, admin billing controls, invoice/Checkout/Portal states, and important error states.
- [ ] `npm run build --prefix frontend` passes.

## Blocked by

- .scratch/workspace-billing/issues/08-subscription-changes-cancellation-and-unpaid-state.md
- .scratch/workspace-billing/issues/10-application-admin-plan-overrides-and-no-billing-mode.md
- .scratch/workspace-billing/issues/11-payment-required-admin-overrides.md
- .scratch/workspace-billing/issues/13-enterprise-annual-commitment-and-overage.md

