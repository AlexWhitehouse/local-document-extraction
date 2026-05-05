# Workspace Context PRD

Status: needs-triage

## Problem Statement

Workspace context behavior is currently hard to understand, change, and test because selection, locked Workspace invitation state, Workspace access, Workspace user permissions, Workspace invitation actions, member actions, persistence, logging, network requests, and rendering are interleaved.

From the user's perspective, this creates risk around basic Workspace behavior: selecting a Workspace, selecting a pending Workspace invitation, accepting or declining a Workspace invitation, switching after acceptance, and managing Workspace users should feel predictable. From the maintainer's perspective, the current shape has weak locality: a small Workspace context change requires tracing distant logic and many implicit ordering rules.

## Solution

Create a deeper Workspace context Module that owns the pure Workspace context rules behind a small, stable interface. Workspace context is the currently selected Workspace or pending Workspace invitation that determines what the user can see and do.

The Module should own Workspace and Workspace invitation list normalization, accepted Workspace versus pending Workspace invitation selection, locked pending Workspace invitation behavior, action guards, post-action selection decisions, refresh ordering decisions, Workspace user permissions, Workspace invitation management transitions, and member action transitions.

The App should remain the adapter for browser and runtime effects: network requests, localStorage, confirmation prompts, logging, React rendering, and state storage. The App should call the Workspace context Module for decisions rather than reimplementing those decisions inline.

## User Stories

1. As a signed-in user, I want to see my accepted Workspaces before pending Workspace invitations, so that my usable Workspace access is easy to find.
2. As a signed-in user, I want pending Workspace invitations ordered by latest update, so that the most relevant pending offer appears first.
3. As a signed-in user, I want to search accepted Workspaces and pending Workspace invitations together, so that I can quickly find the Workspace context I need.
4. As a signed-in user, I want selecting an accepted Workspace to make it the active Workspace context, so that subsequent work happens in the correct Workspace.
5. As a signed-in user, I want selecting a pending Workspace invitation to show invitation details without granting Workspace access, so that I understand the offer before accepting it.
6. As a signed-in user, I want a selected pending Workspace invitation to show a locked state, so that I do not mistake it for usable Workspace access.
7. As a signed-in user, I want pending Workspace invitation context to disable document and template actions that require Workspace access, so that I cannot accidentally act in the wrong Workspace.
8. As an invitee, I want to see the Workspace name on a pending Workspace invitation, so that I know what I am being invited to join.
9. As an invitee, I want to see the role offered by a pending Workspace invitation, so that I know what access I would receive.
10. As an invitee, I want to see who invited me to a Workspace, so that I can evaluate whether to accept the invitation.
11. As an invitee, I want to see which email address was invited, so that I know why the Workspace invitation appears for me.
12. As an invitee, I want to see when a Workspace invitation was sent, so that I can judge its recency.
13. As an invitee, I want to see when a Workspace invitation expires, so that I know whether I need to act soon.
14. As an invitee, I want to accept a pending Workspace invitation from the invitation detail view, so that I intentionally create Workspace membership.
15. As an invitee, I want accepting a Workspace invitation to move me into the accepted Workspace context, so that I can start using the Workspace immediately.
16. As an invitee, I want accepting a Workspace invitation to refresh my accepted Workspace list and pending Workspace invitation list, so that the UI reflects my new membership.
17. As an invitee, I want accepting a Workspace invitation to clear the selected pending Workspace invitation, so that the UI no longer shows locked invitation state.
18. As an invitee, I want accepting a Workspace invitation to restore any saved Workspace API key for the accepted Workspace, so that existing key-based access continues to work.
19. As an invitee, I want accepting a Workspace invitation to fall back safely when the accepted Workspace cannot be resolved, so that the UI does not enter an inconsistent state.
20. As an invitee, I want declining a Workspace invitation to remove it from my pending Workspace invitation list, so that declined invitations stop appearing as actionable.
21. As an invitee, I want declining my own Workspace invitation to happen without a confirmation prompt, so that declining is not unnecessarily heavy.
22. As an invitee, I want declining a Workspace invitation to keep me out of that Workspace, so that Workspace access is only created by acceptance.
23. As an invitee, I want stale selected Workspace invitations to fall back to accepted Workspace context when possible, so that deleted, accepted, expired, or declined invitations do not leave the UI stuck.
24. As a signed-in user with no accepted Workspaces and at least one pending Workspace invitation, I want the latest pending Workspace invitation selected, so that I can act on the only available Workspace context.
25. As a signed-in user with no accepted Workspaces or pending Workspace invitations, I want a safe default Workspace context display, so that the UI remains understandable.
26. As a signed-in user, I want Workspace context switching to preserve Workspace-specific API keys, so that switching does not require re-entering saved access.
27. As a signed-in user, I want Workspace context switching to clear pending Workspace invitation selection, so that accepted Workspace access is not mixed with invitation state.
28. As a signed-in user, I want the active Workspace name to stay aligned with the selected Workspace context, so that labels and actions are consistent.
29. As a signed-in user, I want Workspace context persistence to keep enough state to restore my last useful context, so that reloads are not disruptive.
30. As a signed-in user, I want browser persistence to stay outside the Workspace context rules, so that persistence failures do not change Workspace behavior.
31. As a Workspace owner, I want to see Workspace users for the selected accepted Workspace, so that I can manage access.
32. As a Workspace admin, I want to see Workspace users for the selected accepted Workspace, so that I can manage access within my role.
33. As a Workspace member, I do not want owner/admin-only user management controls shown as available, so that I understand what I can do.
34. As a Workspace owner, I want to see pending Workspace invitations sent from the selected Workspace, so that I can manage outstanding access offers.
35. As a Workspace admin, I want to see pending Workspace invitations sent from the selected Workspace, so that I can manage outstanding access offers.
36. As a Workspace member, I do not want pending Workspace invitation management shown as available, so that I do not attempt unauthorized actions.
37. As a Workspace owner, I want to invite a user by email and role, so that I can grant Workspace access.
38. As a Workspace admin, I want to invite a user by email and role, so that I can grant Workspace access where allowed.
39. As a Workspace owner or admin, I want invite actions to refresh pending Workspace invitations, so that the access-management list is current.
40. As a Workspace owner or admin, I want invalid invite input to be caught before the action runs, so that errors are clear and local.
41. As a Workspace owner or admin, I want to cancel a pending Workspace invitation, so that obsolete access offers are no longer actionable.
42. As a Workspace owner or admin, I want cancellation of someone else's pending Workspace invitation to require confirmation, so that destructive access-management actions are intentional.
43. As a Workspace owner or admin, I want cancelling a Workspace invitation to refresh pending Workspace invitations, so that the cancelled invitation disappears.
44. As a Workspace owner, I want to change Workspace member roles where allowed, so that Workspace access reflects team responsibilities.
45. As a Workspace admin, I want to change Workspace member roles where allowed, so that Workspace access reflects team responsibilities within my authority.
46. As a Workspace owner, I want to remove Workspace members where allowed, so that former collaborators lose access.
47. As a Workspace admin, I want to remove Workspace members where allowed, so that former collaborators lose access within my authority.
48. As a Workspace owner, I want owner transfer actions to follow Workspace policy, so that Workspace ownership remains valid.
49. As a Workspace user, I want member actions to refresh Workspace users, Workspaces, and relevant Workspace context after completion, so that access-management state remains current.
50. As a Workspace user, I want member action failures to leave Workspace context unchanged unless a refresh proves otherwise, so that failed actions do not corrupt local state.
51. As a maintainer, I want Workspace context rules in one Module, so that changes to Workspace selection and access-management behavior have strong locality.
52. As a maintainer, I want the Workspace context Module to have a small pure interface, so that tests can exercise behavior without rendering the full App.
53. As a maintainer, I want network requests outside the Workspace context Module, so that the Module stays deterministic and easy to test.
54. As a maintainer, I want logging outside the Workspace context Module, so that wording changes do not affect behavior tests.
55. As a maintainer, I want confirmation prompts outside the Workspace context Module, so that browser interaction remains an adapter concern.
56. As a maintainer, I want React rendering outside the Workspace context Module, so that Workspace context behavior can be tested independently from presentation.
57. As an AI coding agent, I want Workspace context behavior named consistently with the domain glossary, so that I can navigate the codebase without rediscovering implicit concepts.

## Implementation Decisions

- Build or deepen a Workspace context Module whose interface models pure transitions from current Workspace context state plus an event or action result into next Workspace context state plus required effects.
- Treat Workspace context as a domain concept covering either an accepted Workspace or a pending Workspace invitation.
- Keep browser persistence outside the Workspace context Module. The App remains the adapter for localStorage.
- Keep network requests outside the Workspace context Module. The App remains the adapter for request execution and response retrieval.
- Keep confirmation prompts outside the Workspace context Module. The Workspace context Module can indicate when confirmation is required, but it should not call browser prompt functions.
- Keep logging outside the Workspace context Module. The Module can expose outcomes; the App decides user-facing log text.
- Keep React state and rendering outside the Workspace context Module. The App uses Module outputs to update state and render.
- The Workspace context Module owns normalization of accepted Workspaces and pending Workspace invitations into the selectable Workspace context list.
- The Workspace context Module owns the rule that accepted Workspaces appear before pending Workspace invitations.
- The Workspace context Module owns the rule that pending Workspace invitations are ordered by latest update when displayed beside Workspaces.
- The Workspace context Module owns selection of accepted Workspace context.
- The Workspace context Module owns selection of pending Workspace invitation context.
- The Workspace context Module owns locked pending Workspace invitation behavior: pending Workspace invitation context does not grant Workspace API access.
- The Workspace context Module owns stale Workspace invitation fallback behavior.
- The Workspace context Module owns the decision that accepting a Workspace invitation selects the accepted Workspace when the accepted Workspace can be resolved.
- The Workspace context Module owns the decision that declining a Workspace invitation clears pending Workspace invitation context.
- The Workspace context Module owns the refresh ordering decisions required after accept, decline, invite, cancel, and member actions.
- The Workspace context Module owns role-derived Workspace user permissions for owner, admin, and member contexts.
- The Workspace context Module owns Workspace invitation management availability for owner/admin contexts.
- The Workspace context Module owns Workspace user management transition decisions for invite, cancel, role change, removal, and owner transfer actions.
- Existing backend Workspace policy remains the durable authority for role capabilities, invitation lifecycle, owner transfer, Workspace deletion eligibility, Workspace API key rotation, and new-user Workspace bootstrap.
- The frontend Workspace context Module must not duplicate durable Workspace policy. It should model frontend context transitions and permissions for display and action availability, while backend Workspace policy remains authoritative.
- No schema changes are planned.
- No backend route contract changes are planned for the first implementation.
- The first implementation should be staged: selection plus Workspace invitation accept/decline transitions first, then Workspace user management transitions once the initial interface is proven.
- Existing App behavior should be preserved unless the new Workspace context rules clarify an existing inconsistency.
- The existing narrow Workspace selection helper should either be absorbed into the deeper Workspace context Module or become an internal implementation detail of that Module.

## Testing Decisions

- Good tests should exercise external behavior through the Workspace context Module interface, not internal helper functions or implementation details.
- Tests should assert observable Workspace context outcomes: selected context, locked state, access availability, required effects, and refresh decisions.
- Tests should not render the full App when verifying Workspace context rules.
- Tests should not mock React state transitions for pure Workspace context behavior.
- Tests should not depend on browser localStorage, fetch, confirmation prompts, or logging for pure Workspace context behavior.
- The Workspace context Module should be tested for accepted Workspace selection.
- The Workspace context Module should be tested for pending Workspace invitation selection.
- The Workspace context Module should be tested for locked pending Workspace invitation access behavior.
- The Workspace context Module should be tested for stale pending Workspace invitation fallback.
- The Workspace context Module should be tested for list normalization and ordering of accepted Workspaces and pending Workspace invitations.
- The Workspace context Module should be tested for accepting a Workspace invitation and selecting the accepted Workspace after refresh.
- The Workspace context Module should be tested for declining a Workspace invitation and clearing pending Workspace invitation context.
- The Workspace context Module should be tested for preserving Workspace-specific API key restoration decisions.
- The Workspace context Module should be tested for owner, admin, and member permission decisions.
- The Workspace context Module should be tested for Workspace invitation management availability.
- The Workspace context Module should be tested for invite, cancel, role change, removal, and owner transfer transition outcomes.
- Existing tests for the current Workspace selection helper are prior art for pure Workspace context tests.
- Frontend Vitest tests are appropriate prior art for the new pure Module tests.
- Full App rendering tests are not required for the first pass unless integration regressions appear.
- Backend Workspace policy tests remain the appropriate place to verify durable authorization and mutation behavior.

## Out of Scope

- Changing backend Workspace policy semantics is out of scope.
- Changing database schema is out of scope.
- Changing backend route contracts is out of scope for the first implementation.
- Reworking authentication is out of scope.
- Moving localStorage persistence into the Workspace context Module is out of scope.
- Moving network requests into the Workspace context Module is out of scope.
- Moving logging into the Workspace context Module is out of scope.
- Moving confirmation prompts into the Workspace context Module is out of scope.
- Rewriting the full App layout or visual design is out of scope.
- Deepening Template definition, Job lifecycle, backend route dispatch, Workspace deletion cleanup, or starter template bootstrap is out of scope for this PRD.
- Creating outbound email behavior for Workspace invitations is out of scope.

## Further Notes

The primary architectural goal is locality and leverage. Workspace context should become a deep Module: a lot of behavior behind a small pure interface. The App should become an adapter around that interface rather than the place where Workspace context rules are discovered and maintained.

This PRD follows the domain glossary language for Workspace policy, Workspace, Workspace context, and Workspace invitation. No ADR conflicts were found during exploration.

Verification commands relevant to implementation include the frontend test script, frontend production build, and backend typecheck when backend types are touched.
