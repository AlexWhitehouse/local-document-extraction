# End-To-End Billing Verification

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Perform the final verification and hardening pass for Workspace billing across backend, frontend, Stripe test mode, and documented operational flows. This slice should not introduce new product behavior; it should prove the complete system works together and clean up regressions or missing coverage found during integration.

## Acceptance criteria

- [ ] Backend typecheck passes.
- [ ] Frontend production build passes.
- [ ] Focused backend billing tests pass for plan catalog, entitlement resolver, Billing ledger, Stripe webhooks/gateway, document submission enforcement, Plan overage enforcement, admin controls, Enterprise billing, deletion guards, and reconciliation.
- [ ] Focused frontend billing tests pass for owner Billing page, non-owner boundaries, blocked upload behavior, Application admin billing view, and important action states.
- [ ] Stripe test-mode Credit pack purchase flow grants Purchased Credits exactly once.
- [ ] Stripe test-mode Pro/Max subscription start activates entitlement and Included Credits only after payment.
- [ ] Stripe test-mode upgrade/downgrade/cancellation/unpaid flows match the PRD rules.
- [ ] Stripe test-mode admin-created invoice flow activates payment-required override only after payment.
- [ ] Stripe test-mode Enterprise ramp-up and annual invoice flows match the PRD rules.
- [ ] Workspace deletion billing guards behave correctly with paid, unpaid, and Enterprise Workspaces.
- [ ] Workspace API keys cannot read billing or bypass billing entitlement checks.
- [ ] Billing operational status does not leak owner-only billing details.
- [ ] Retained billing records after Workspace deletion contain only the agreed minimal financial/audit data.
- [ ] Documentation for required Stripe test/live env vars and webhook setup is present.
- [ ] No secrets, Stripe keys, webhook secrets, raw payment method details, or raw Stripe webhook payload archives are committed.
- [ ] Any flaky or brittle billing tests are tightened to assert external behavior rather than implementation details.

## Blocked by

- .scratch/workspace-billing/issues/03-prepaid-submission-enforcement.md
- .scratch/workspace-billing/issues/04-plan-limit-overage-enforcement.md
- .scratch/workspace-billing/issues/05-stripe-dashboard-test-mode-catalog-setup.md
- .scratch/workspace-billing/issues/06-stripe-credit-pack-purchases.md
- .scratch/workspace-billing/issues/07-pro-max-subscription-start.md
- .scratch/workspace-billing/issues/08-subscription-changes-cancellation-and-unpaid-state.md
- .scratch/workspace-billing/issues/09-workspace-deletion-billing-guards.md
- .scratch/workspace-billing/issues/10-application-admin-plan-overrides-and-no-billing-mode.md
- .scratch/workspace-billing/issues/11-payment-required-admin-overrides.md
- .scratch/workspace-billing/issues/12-enterprise-ramp-up-billing.md
- .scratch/workspace-billing/issues/13-enterprise-annual-commitment-and-overage.md
- .scratch/workspace-billing/issues/14-billing-reconciliation.md
- .scratch/workspace-billing/issues/15-owner-and-admin-billing-ux-hardening.md

