# Application Admin Plan Overrides And No-Billing Mode

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add Application admin billing controls for no-payment Plan overrides and No-billing mode. Application admins should be able to assign time-bounded Free/Pro/Max overrides without payment, grant the target plan's Included Credits for covered Billing periods, inspect active/scheduled billing state, and place a Workspace in No-billing mode with the Enterprise limit profile and no charges.

This slice should extend the Application admin surface with billing management while keeping the owner Billing page separate.

## Acceptance criteria

- [ ] Application admins can view Workspace billing state in an Application admin billing view.
- [ ] Application admins can create a no-payment-required Plan override targeting Free, Pro, or Max with start, end, reason, and creating admin.
- [ ] Active Plan override takes precedence over Enterprise, self-service subscription, and Free entitlement.
- [ ] No-payment-required Plan override activates without Stripe payment.
- [ ] No-payment-required Plan override grants target plan Included Credits for each covered Billing period.
- [ ] Plan override expiry falls back to active self-service subscription entitlement if one exists, otherwise Free.
- [ ] Plan overrides cannot target Enterprise or No-billing mode.
- [ ] Application admins can enable and disable No-billing mode for a Workspace with a reason.
- [ ] No-billing mode uses Enterprise limit profile: unlimited Templates, unlimited accepted Workspace memberships, 25 top-level Template fields, one table-shaped field with up to 20 columns.
- [ ] No-billing mode bypasses Credits, invoices, usage charges, and Plan page limit enforcement.
- [ ] No-billing submissions record No-billing usage entries with the same submission metadata as Credit reservations.
- [ ] No-billing mode does not bypass product safety limits or abuse/rate limits.
- [ ] Owner Billing page and operational summaries reflect active Plan override or No-billing entitlement.
- [ ] Application admin billing actions write audit log entries.
- [ ] Tests cover override activation/expiry, Included Credit grants, entitlement precedence, No-billing usage entries, Enterprise limit profile enforcement, audit logging, and owner/admin visibility.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/02-workspace-billing-ledger-with-manual-credit-grants.md
- .scratch/workspace-billing/issues/04-plan-limit-overage-enforcement.md

