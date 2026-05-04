# PRD: Workspace Policy Module

Status: completed

## Problem Statement

Workspace policy is currently difficult to reason about because workspace membership rules, invitation lifecycle, owner transfer, deletion eligibility, workspace API key rotation, and new-user workspace bootstrap are spread across multiple backend modules. A maintainer has to follow route handling, auth checks, Better Auth hooks, D1 queries, role checks, cascade deletion, and starter template creation to understand one workspace action.

This makes the backend harder to change safely. It also makes the workspace rules hard to test through a stable interface because the durable behaviour is embedded in request handlers and auth-provider hooks rather than concentrated behind a deep Module.

## Solution

Create a deep `Workspace policy` Module with a capability-specific Interface. The Module will own D1 reads and writes needed to make workspace decisions durable. Callers will pass intent, such as authorizing workspace access, inviting a member, accepting an invitation, transferring ownership, rotating a workspace API key, deleting a workspace, or bootstrapping a new user workspace.

Route handlers and Better Auth hooks become thin callers. They should not load membership rows, inspect roles, hash workspace API keys, expire invitations, coordinate owner transfer writes, or know bootstrap details.

The first implementation should preserve current behaviour while improving locality and testability.

## User Stories

1. As a backend maintainer, I want workspace role rules in one Module, so that I can understand owner/admin/member behaviour without tracing many callers.
2. As a backend maintainer, I want route handlers to call `Workspace policy` by intent, so that workspace behaviour is not duplicated across request paths.
3. As a backend maintainer, I want `Workspace policy` to own membership reads, so that callers do not reimplement role checks from D1 rows.
4. As a backend maintainer, I want `Workspace policy` to own membership writes, so that owner transfer and invitation acceptance remain durable and consistent.
5. As a backend maintainer, I want workspace API key hashing in one place, so that create, rotate, and authenticate paths cannot drift.
6. As a backend maintainer, I want invitation email normalization in one place, so that duplicate invitation and acceptance checks are consistent.
7. As a backend maintainer, I want invitation expiry handled by `Workspace policy`, so that expired invitations are durably marked before returning an error.
8. As a backend maintainer, I want owner transfer handled as one workspace policy operation, so that the workspace has exactly one owner afterward.
9. As a backend maintainer, I want deletion eligibility handled by `Workspace policy`, so that owner-only and last-workspace rules are not split from deletion.
10. As a backend maintainer, I want workspace deletion to use the existing cascade deletion behaviour through the policy decision, so that destructive cleanup still happens safely.
11. As a backend maintainer, I want Better Auth hooks to call new-user workspace bootstrap, so that auth-provider code does not own workspace and template SQL.
12. As a backend maintainer, I want bootstrap to be idempotent, so that a user with an existing membership does not receive duplicate workspaces.
13. As a backend maintainer, I want starter template details outside `Workspace policy` over time, so that template rules can become their own deep Module later.
14. As a workspace owner, I want to create a workspace, so that I can separate extraction work by workspace.
15. As a workspace owner, I want to receive a workspace API key when creating a workspace, so that workspace-scoped extraction can be automated.
16. As a workspace owner, I want workspace API key plaintext returned only once, so that key handling remains secure.
17. As a workspace owner, I want to rotate a workspace API key, so that compromised or stale keys can be invalidated.
18. As a workspace owner, I want to update workspace settings, so that the workspace remains understandable to members.
19. As a workspace admin, I want to update workspace settings, so that I can help manage the workspace without being owner.
20. As a workspace member, I want to be prevented from changing workspace settings, so that workspace administration stays controlled.
21. As a workspace owner, I want to invite admins or members, so that other users can collaborate in the workspace.
22. As a workspace admin, I want to invite admins or members, so that I can help manage collaboration.
23. As a workspace member, I want to be prevented from inviting users, so that membership changes stay controlled.
24. As an invited user, I want to list pending invitations for my email, so that I can join the right workspace.
25. As an invited user, I want to accept a pending invitation, so that I become a workspace member with the intended role.
26. As an invited user, I want invitations for other email addresses to be rejected, so that workspace access cannot be claimed by the wrong user.
27. As a workspace owner, I want duplicate pending invitations to the same email blocked, so that membership workflows stay clear.
28. As a workspace owner, I want to list workspace users, so that I can understand who has access.
29. As a workspace admin, I want to list workspace users, so that I can help manage access.
30. As a workspace member, I want to list workspace users if membership permits it, so that I can understand the collaboration context.
31. As a workspace owner, I want to remove admins or members, so that I can revoke access.
32. As a workspace admin, I want to remove member users, so that I can help manage access.
33. As a workspace admin, I want to be prevented from removing owners or admins, so that higher-privilege users are protected.
34. As a workspace owner, I want to promote a member to admin, so that trusted users can manage the workspace.
35. As a workspace admin, I want to be prevented from promoting users, so that admin assignment remains owner-controlled.
36. As a workspace owner, I want to transfer ownership to another member, so that ownership can move without deleting the workspace.
37. As a workspace owner, I want owner transfer to demote the previous owner to admin, so that the workspace retains administrative continuity.
38. As a workspace owner, I want removal of the current owner blocked, so that a workspace cannot lose its owner accidentally.
39. As a workspace owner, I want to delete a workspace only when I have another workspace, so that I do not delete my last workspace by mistake.
40. As a workspace admin, I want to be prevented from deleting the workspace, so that destructive actions stay owner-only.
41. As a workspace member, I want to be prevented from deleting the workspace, so that destructive actions stay controlled.
42. As a caller using a workspace API key, I want workspace access to resolve without user membership context, so that automated extraction remains possible.
43. As a caller using a session, I want workspace access to require a workspace id, so that session requests are scoped to the intended workspace.
44. As a backend maintainer, I want workspace policy errors to map cleanly to HTTP responses, so that callers receive current error semantics.
45. As a backend maintainer, I want D1 fixture tests for workspace policy behaviour, so that refactors can preserve durable rules.
46. As an AFK agent, I want workspace policy concentrated behind a stable Interface, so that I can make future backend changes without rediscovering scattered invariants.

## Implementation Decisions

- Build a deep `Workspace policy` Module with a capability-specific Interface rather than a generic command Interface.
- The Module should expose intent-shaped methods for authorizing workspace access, listing workspaces, creating a workspace, updating a workspace, deleting a workspace, listing members, inviting members, listing invitations by email, accepting invitations, removing members, promoting admins, transferring ownership, rotating workspace API keys, and bootstrapping a new user workspace.
- `Workspace policy` owns D1 reads and writes for membership, invitation, owner transfer, deletion eligibility, workspace API key rotation, and bootstrap decisions.
- Callers must not load workspace membership rows and reimplement role checks.
- The auth path should ask `Workspace policy` to authorize a workspace for either session-based access or workspace API key access.
- Better Auth remains an Adapter/caller. It should call new-user workspace bootstrap rather than owning workspace creation SQL.
- Workspace API key generation and hashing should be consolidated behind `Workspace policy`.
- The raw workspace API key should only be returned at workspace creation, bootstrap creation, or rotation time. Only the hash should be persisted.
- Invitation email normalization, duplicate pending invitation detection, invitation expiry marking, and invitation acceptance ordering belong inside `Workspace policy`.
- Owner transfer should be one workspace policy operation that demotes the previous owner, promotes the target member, and updates the workspace owner reference consistently.
- Workspace deletion should re-check eligibility inside the mutation, including owner-only and last-workspace rules.
- Existing cascade deletion should remain the cleanup mechanism, called after `Workspace policy` approves deletion.
- Starter template details should not become permanent `Workspace policy` knowledge. Bootstrap should orchestrate starter template creation through a small temporary Adapter that can later be replaced by a template Module.
- No schema changes are expected for the first implementation; the goal is behavioural preservation and architectural deepening.
- Route response contracts should remain compatible with existing responses unless a later implementation issue explicitly changes them.
- Use typed workspace policy errors internally, then map them to current HTTP error codes and messages at the caller edge.

## Testing Decisions

- Good tests should exercise external behaviour through the `Workspace policy` Interface, not private helper functions or implementation details.
- Tests should verify durable outcomes in D1 fixtures because D1 is local-substitutable and `Workspace policy` owns D1 reads and writes.
- Tests should cover owner/admin/member capability rules.
- Tests should cover workspace creation and workspace API key rotation, including hash persistence and one-time plaintext return behaviour.
- Tests should cover invitation creation, duplicate pending invitation rejection, email normalization, invitation expiry, wrong-email rejection, and successful acceptance.
- Tests should cover member removal rules for owner, admin, and member actors.
- Tests should cover admin promotion rules.
- Tests should cover owner transfer, including the exactly-one-owner invariant.
- Tests should cover workspace deletion eligibility, including owner-only and last-workspace rejection.
- Tests should cover new-user workspace bootstrap idempotency.
- Tests should cover auth integration at a thin level: session workspace access and workspace API key access should delegate to `Workspace policy`.
- Tests should avoid asserting SQL shape, private helper names, or the exact sequence of internal function calls.
- Prior art is limited: the repo currently has no formal test scripts defined. The first tests may require introducing a focused backend test harness or documenting a manual D1 fixture approach before broad coverage is added.

## Out of Scope

- Changing the public route contracts for workspace, invitation, membership, profile, template, extraction job, or auth endpoints.
- Redesigning the route dispatch Module.
- Creating a generic persistence layer or generic store port for D1.
- Redesigning Better Auth configuration.
- Redesigning template field definition, extraction job lifecycle, AI Gateway extraction, or source image/document lifecycle.
- Changing database schema unless implementation discovers a required invariant that cannot be preserved safely with the current schema.
- Replacing cascade deletion with a new cleanup Module.
- Building a full audit log, billing plan rules, custom roles, organization-level roles, or enterprise membership controls.

## Further Notes

- The agreed architecture direction is documented in the backend context glossary under `Workspace policy`.
- This work is primarily an architectural deepening effort: the desired user-visible behaviour is unchanged, but the backend should become easier to test and safer to modify.
- The recommended first implementation sequence is to move access checks first, then read operations, then low-risk mutations, then invitation lifecycle, then membership management, then deletion eligibility, then bootstrap orchestration.
- Backend typecheck should be used as the main verification command after implementation slices.

## Comments

> *This was generated by AI during triage.*

## Completion Notes

All Workspace policy implementation issues are marked complete/done. Focused backend verification passed for the Workspace policy test harness and workspace deletion route tests, and backend typecheck succeeded.
