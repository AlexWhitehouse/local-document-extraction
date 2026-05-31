# Billing Page Foundation With Free Entitlement

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Create the first end-to-end Workspace billing slice without Stripe or paid Credits. Every existing and new Workspace should resolve to the Free plan by default, expose an owner-only Billing page with current Free entitlement, zero Included Credits, current-period page capacity, plan limits, and no payment controls yet. Non-owners should not see the Billing page, but product surfaces may show limited Billing operational status when needed.

This slice should establish the code-owned non-enterprise plan catalog, Billing period anchor rules for Free Workspaces, a dedicated session-only billing summary endpoint, frontend Billing page navigation for Workspace owners, and tests that prove owner/non-owner boundaries.

## Acceptance criteria

- [ ] Existing Workspaces resolve to Free entitlement unless another billing state is present.
- [ ] Newly created Workspaces start on Free entitlement.
- [ ] Free entitlement exposes zero Included Credits, 3 Template limit, 5 top-level Template field limit, 1 table-shaped field with 5 columns, 3 member limit, 500 monthly pages, no API access, and £0.22 per-page catalog price.
- [ ] Free Billing periods use the Workspace creation time as the Billing period anchor.
- [ ] Starter Templates created for new Workspaces fit and count against Free limits.
- [ ] A dedicated owner-facing billing summary endpoint is session-only and requires Workspace billing authority.
- [ ] Workspace API keys cannot read the billing summary endpoint.
- [ ] Normal Workspace listing responses do not expose owner-only billing details.
- [ ] Workspace owners see a Billing page navigation item.
- [ ] Workspace admins and members do not see a Billing page navigation item.
- [ ] The Billing page shows current Free entitlement, available Credits separately from remaining current-period page capacity, plan limits, and next scheduled entitlement when present.
- [ ] Non-owner blocked-action surfaces can show limited Billing operational status without invoices, payment methods, exact prices paid, or owner-only controls.
- [ ] Backend tests cover Free entitlement resolution, billing summary authorization, and API-key rejection.
- [ ] Frontend tests cover owner-only Billing navigation and non-owner operational status boundaries.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

None - can start immediately

