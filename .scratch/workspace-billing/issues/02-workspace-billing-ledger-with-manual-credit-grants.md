# Workspace Billing Ledger With Manual Credit Grants

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add the per-Workspace billing Durable Object from ADR 0003 and prove the ledger with manual, no-Stripe Credit grants. An Application admin should be able to grant Goodwill Credits to a Workspace, revoke unspent manual grants, and write an Application admin billing audit entry. A Workspace owner should see the resulting Credit balance and Owner billing activity on the Billing page.

This slice establishes the append-only Billing ledger, rebuildable balance/activity summaries, D1 billing control records needed to route to the ledger, and the minimal owner/admin UI/API path for manual Credit grants.

## Acceptance criteria

- [ ] A Workspace billing Durable Object binding and lazy schema initialization path exist.
- [ ] The Billing ledger is append-only for grants, revocations, and summaries.
- [ ] Billing balances and Owner billing activity are rebuildable projections from ledger entries.
- [ ] Application admins can grant Goodwill Credits to a Workspace with a reason.
- [ ] Application admins can revoke only unspent Goodwill Credit grants.
- [ ] Manual grants and revocations write Application admin billing audit log entries with actor, timestamp, reason, before/after values, and Workspace.
- [ ] Workspace owners see updated available Credits and Owner billing activity after manual grants/revocations.
- [ ] Non-owners do not see owner billing activity or grant controls.
- [ ] Retained billing records avoid account emails/names beyond what is already required by invoices or Stripe records.
- [ ] Tests cover ledger append-only behavior, balance projection, grant/revoke idempotency, audit log creation, owner visibility, and non-owner denial.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/01-billing-page-foundation-with-free-entitlement.md

