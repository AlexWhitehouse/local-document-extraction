# Workspace Deletion Billing Guards

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add billing-aware Workspace deletion behavior. Deletion should stop future self-service subscription billing and deactivate billing entitlements before product/control data deletion, but it must not refund Credits or charges. Deletion should be blocked while unpaid invoices exist and should retain minimal billing records needed for financial, audit, and legal purposes.

## Acceptance criteria

- [ ] Workspace deletion is blocked while unpaid billing invoices exist.
- [ ] Allowed Workspace deletion ends future self-service subscription billing.
- [ ] Allowed Workspace deletion deactivates billing entitlements before Workspace control/product data deletion.
- [ ] Workspace deletion does not refund Credits, subscription payments, Enterprise invoices, or other billing charges.
- [ ] Workspace deletion does not create Credit refunds or reduce historical Plan page usage.
- [ ] Minimal billing records needed for financial, audit, and legal purposes are retained after deletion.
- [ ] Retained billing records may reference the deleted Workspace ID and actor user IDs.
- [ ] Retained billing records avoid retaining account emails and names beyond what Stripe or invoices already retain.
- [ ] Workspaces with active Enterprise deal terms are blocked or routed to Application admin handling before deletion completes.
- [ ] Tests cover deletion with unpaid invoices, deletion with active subscription and no unpaid invoices, no-refund behavior, retained record shape, and Enterprise handling.
- [ ] `npm run typecheck --prefix backend` passes.

## Blocked by

- .scratch/workspace-billing/issues/07-pro-max-subscription-start.md
- .scratch/workspace-billing/issues/08-subscription-changes-cancellation-and-unpaid-state.md

