# Payment-Required Admin Overrides

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Allow Application admins to create payment-required Free/Pro/Max Plan overrides. The override should create an owner-visible Stripe invoice, use automatic collection when a default payment method exists or hosted/manual payment otherwise, and activate the target entitlement only after the required invoice is paid.

## Acceptance criteria

- [ ] Application admins can create a payment-required Plan override targeting Free, Pro, or Max with start, end, reason, and creating admin.
- [ ] A payment-required Plan override creates an owner-visible Stripe invoice for the Workspace.
- [ ] Payment-required override invoices use automatic collection by default when the Workspace has a default payment method.
- [ ] Payment-required override invoices can be paid manually by the Workspace owner through the billing page when automatic collection is unavailable.
- [ ] Application admins can select manual invoice collection when needed.
- [ ] Paid override entitlements activate only after the required invoice is paid.
- [ ] Unpaid payment-required overrides do not grant paid entitlements or Included Credits.
- [ ] Override invoice status appears in owner Billing page and Application admin billing view.
- [ ] Stripe invoice items use explicit amounts derived from the override terms.
- [ ] Stripe API writes use idempotency keys and webhook events are processed idempotently.
- [ ] Application admin billing audit log records override creation and payment state changes.
- [ ] Tests cover invoice creation, automatic/manual collection mode, paid activation, unpaid non-activation, owner visibility, admin visibility, duplicate webhook handling, and audit logging.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/05-stripe-dashboard-test-mode-catalog-setup.md
- .scratch/workspace-billing/issues/10-application-admin-plan-overrides-and-no-billing-mode.md

