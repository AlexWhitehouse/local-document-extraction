# Enterprise Ramp-Up Billing

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add Application-admin-assigned Enterprise ramp-up billing. Enterprise ramp-up should use the Enterprise limit profile, not prepaid Credits, and record Enterprise usage charges for accepted submissions. Application admins set ramp-up duration in months, defaulting to 3, and an Enterprise billing cycle start date. At each invoice period close, the app generates a ramp-up usage invoice from Billing ledger usage using tiered usage slices.

## Acceptance criteria

- [ ] Application admins can assign Enterprise ramp-up deal terms with duration in months, default 3, billing cycle start date, collection method, and reason.
- [ ] Enterprise ramp-up uses Enterprise limit profile and does not use prepaid Credits.
- [ ] Enterprise ramp-up has no standard hard monthly Plan page limit.
- [ ] Accepted Enterprise ramp-up submissions record Enterprise usage charge entries before Source file storage and job creation.
- [ ] Enterprise usage charge entries include the same submission metadata as Credit reservations.
- [ ] Enterprise ramp-up usage bands are tiered by slice: 0-10,000 at £0.14, 10,001-20,000 at £0.13, 20,001-40,000 at £0.12, 40,001-60,000 at £0.11, 60,001+ at £0.10.
- [ ] Ramp-up invoice periods align to the Enterprise billing cycle start date.
- [ ] Ramp-up invoices are generated automatically after each monthly invoice period closes from Billing ledger usage.
- [ ] Ramp-up invoices use explicit Stripe invoice items derived from usage and tiered pricing.
- [ ] Ramp-up invoices finalize automatically unless Enterprise invoice review mode is enabled.
- [ ] Ramp-up invoices are visible and payable by the Workspace owner.
- [ ] Overdue ramp-up invoices suspend Enterprise entitlement until paid.
- [ ] Suspended or expired ramp-up falls back to active self-service subscription entitlement if one exists, otherwise Free.
- [ ] Tests cover ramp-up assignment, entitlement precedence, usage entries, tiered pricing, invoice generation, review mode, overdue suspension, fallback, and owner/admin UI.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/05-stripe-dashboard-test-mode-catalog-setup.md
- .scratch/workspace-billing/issues/10-application-admin-plan-overrides-and-no-billing-mode.md

