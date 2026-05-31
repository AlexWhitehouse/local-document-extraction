# Plan Limit Overage Enforcement

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Enforce Free/Pro/Max plan resource limits without deleting existing over-limit data. The app should detect Template count, Workspace membership count, Template field count, table-shaped field count, table-column count, and API access entitlement, then block only the actions required by the PRD. Existing Templates, members, and API keys should remain visible and manageable.

This slice should make billing enforcement real even before paid subscriptions exist, using Free entitlement and manual Credit grants from prior slices.

## Acceptance criteria

- [ ] Existing over-limit Templates, Template fields, Workspace memberships, and API keys are preserved.
- [ ] Any Plan limit overage blocks new Extraction jobs until resolved or billing is restored.
- [ ] Too many Templates blocks new jobs against all Templates and blocks new Template creation.
- [ ] Too many accepted Workspace memberships blocks new jobs against all Templates and blocks new Workspace invitations.
- [ ] A Template with too many top-level fields blocks new jobs for that Template.
- [ ] A Template with too many table-shaped fields or too many Template object columns blocks new jobs for that Template.
- [ ] Saving an over-limit Template is allowed only when the save brings it within the active plan limits or billing is restored.
- [ ] A table-shaped Template field counts as one top-level Template field.
- [ ] Workspace API key generation requires active API access entitlement.
- [ ] Existing Workspace API keys are preserved when API entitlement is inactive.
- [ ] Product API requests using Workspace API keys are rejected with entitlement errors when API access entitlement is inactive, not invalid-key errors.
- [ ] Session-authenticated and API-key-authenticated product requests receive the same billing entitlement and Plan limit overage enforcement.
- [ ] Backend tests cover Template, field, table-column, membership, invitation, job submission, and API-key entitlement enforcement.
- [ ] Frontend tests cover blocked-action operational status without owner-only billing detail leakage.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/01-billing-page-foundation-with-free-entitlement.md
- .scratch/workspace-billing/issues/03-prepaid-submission-enforcement.md

