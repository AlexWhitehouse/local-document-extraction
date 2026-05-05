# Workspace Leave PRD

Status: needs-triage

## Problem Statement

Workspace admins and members currently see the same destructive `Delete Workspace` action as owners, even though only owners are allowed to delete a Workspace. From the user's perspective, a non-owner who wants to stop participating in a Workspace needs a clear self-service `Leave Workspace` action that removes their own Workspace membership without deleting the Workspace or affecting other members.

The current behavior also blurs two different domain actions: deleting a Workspace and leaving a Workspace. Deleting is a destructive owner action. Leaving is a signed-in non-owner member action that removes only that member's access.

## Solution

Add `Leave Workspace` as a self-service action for signed-in non-owner Workspace members. Owners continue to see `Delete Workspace`; admins and members see `Leave Workspace` instead.

Leaving a Workspace removes only the current user's Workspace membership. It does not delete the Workspace, documents, templates, pending Workspace invitations, Workspace API key, or other members. If leaving would remove the user's last accepted Workspace, the system creates a replacement personal Workspace using the same starter-template bootstrap behavior as new-user Workspace bootstrap. After leaving, the user is moved into a valid accepted Workspace context, preferring the replacement personal Workspace when one was created and otherwise selecting the most recently created remaining accepted Workspace.

## User Stories

1. As a signed-in Workspace member, I want to leave a Workspace myself, so that I can remove my own access without asking an owner or admin.
2. As a signed-in Workspace admin, I want to leave a Workspace myself, so that I can stop participating without deleting the Workspace.
3. As a signed-in Workspace member, I want `Leave Workspace` instead of `Delete Workspace`, so that I understand the action affects only my membership.
4. As a signed-in Workspace admin, I want `Leave Workspace` instead of `Delete Workspace`, so that I am not shown an owner-only destructive action.
5. As a Workspace owner, I want to keep seeing `Delete Workspace`, so that the existing owner-level destructive action remains available.
6. As a Workspace owner, I want direct attempts to leave through the leave action rejected, so that the Workspace cannot be orphaned accidentally.
7. As a Workspace owner, I want to transfer ownership or delete the Workspace instead of leaving, so that ownership remains explicit.
8. As a Workspace member, I want leaving to remove only my Workspace membership, so that the Workspace continues for everyone else.
9. As a Workspace admin, I want leaving to remove only my Workspace membership, so that other members and owners keep their access.
10. As a Workspace member, I want leaving not to delete Workspace documents, so that shared work is not lost.
11. As a Workspace member, I want leaving not to delete Workspace templates, so that shared extraction setup remains available to remaining members.
12. As a Workspace member, I want leaving not to delete pending Workspace invitations, so that outstanding access offers remain valid.
13. As a Workspace member, I want pending Workspace invitations I sent to remain pending after I leave, so that inviter departure does not silently cancel access offers.
14. As a Workspace member, I want leaving not to rotate or invalidate the Workspace API key for remaining members and integrations, so that active workflows are not disrupted.
15. As a signed-in user, I want to confirm before leaving a Workspace, so that I do not remove my own access accidentally.
16. As a signed-in user, I want the leave confirmation to explain that I will lose access unless invited again, so that the consequence is clear.
17. As a signed-in user, I want the leave confirmation to use non-destructive wording, so that it is not confused with Workspace deletion.
18. As a signed-in user, I want successful leave to refresh my accepted Workspace list, so that the left Workspace disappears from my available Workspaces.
19. As a signed-in user, I want successful leave to refresh Workspace context, so that the selected Workspace is always one I can still access.
20. As a signed-in user with other accepted Workspaces, I want leaving to select another accepted Workspace, so that I can continue working immediately.
21. As a signed-in user with other accepted Workspaces, I want the next selected Workspace to be the most recently created remaining accepted Workspace, so that selection is predictable.
22. As a signed-in user leaving my last accepted Workspace, I want the system to create a replacement personal Workspace, so that I am not left without a usable Workspace context.
23. As a signed-in user leaving my last accepted Workspace, I want the replacement personal Workspace to include starter-template bootstrap, so that the new Workspace is immediately useful.
24. As a signed-in user leaving my last accepted Workspace, I want the replacement personal Workspace selected automatically, so that I land in a valid accepted Workspace context.
25. As a signed-in user leaving my last accepted Workspace, I want the replacement Workspace API key returned once and stored locally, so that API access can work immediately for that new Workspace.
26. As a signed-in user, I want locally stored API-key material for the left Workspace removed from my browser, so that I no longer retain credentials for a Workspace I left.
27. As a signed-in user, I want locally stored API-key material for remaining Workspaces preserved, so that leaving one Workspace does not disrupt others.
28. As a signed-in user, I want leaving to show a clear success message, so that I know the membership removal completed.
29. As a signed-in user, I want leave failures to keep my current Workspace context unchanged, so that a failed action does not corrupt local state.
30. As a signed-in user, I want leave failures to show clear error messaging, so that I understand whether I was blocked by role, membership, or session state.
31. As a non-member, I want leave attempts rejected, so that a user cannot act on a Workspace they do not belong to.
32. As an API-key caller, I want leave to be unavailable, so that Workspace API keys cannot remove human Workspace memberships.
33. As a signed-in user using the app with a session, I want leave to use my session identity, so that the system removes only my membership.
34. As a maintainer, I want leaving represented as a Workspace policy operation, so that membership rules stay centralized.
35. As a maintainer, I want route handling for leave to be thin, so that authorization and membership mutation do not leak out of Workspace policy.
36. As a maintainer, I want starter-template replacement creation reused from existing bootstrap behavior, so that last-Workspace leave does not create a second bootstrap concept.
37. As a maintainer, I want the frontend Workspace context Module to decide post-leave selection, so that selection behavior is testable without rendering the whole app.
38. As a maintainer, I want browser effects such as confirmation, logging, local storage, and network requests kept outside pure Workspace context rules, so that the deep Module remains deterministic.
39. As a maintainer, I want `Workspace`, `workspace member`, and `workspace membership` used consistently, so that the feature does not introduce the ambiguous term `group`.
40. As an AFK agent, I want the leave behavior specified in terms of existing Workspace policy and Workspace context concepts, so that implementation can proceed without rediscovering domain boundaries.

## Implementation Decisions

- Modify Workspace policy to add a self-service leave operation for signed-in non-owner Workspace members.
- The leave operation removes only the acting user's Workspace membership from the target Workspace.
- The leave operation rejects non-members.
- The leave operation rejects Workspace owners and should communicate that owners must delete the Workspace or transfer ownership first.
- The leave operation is session-only. Workspace API-key authentication must not be able to remove a human Workspace membership.
- If the acting user has other accepted Workspaces after leaving, no replacement Workspace is created.
- If leaving would remove the acting user's last accepted Workspace, create a replacement personal Workspace using the existing new-user Workspace bootstrap behavior, including starter-template setup.
- The leave response should include enough information for the frontend to select the next Workspace context.
- When a replacement personal Workspace is created, the leave response should include the replacement Workspace API key once, following the same security model as Workspace creation/bootstrap.
- Keep `DELETE Workspace` semantics reserved for owner-level destructive Workspace deletion.
- Add a dedicated leave API contract shaped around the action of leaving a Workspace, rather than overloading owner/admin member-management actions.
- Update the Workspace action button so owners see `Delete Workspace` and signed-in non-owner Workspace members see `Leave Workspace`.
- Keep API-key-only access behavior otherwise unchanged; this feature only gates the leave action.
- Use confirmation wording that describes access removal, not destructive Workspace deletion.
- After successful leave, refresh accepted Workspaces and select the replacement Workspace when created or the most recently created remaining accepted Workspace otherwise.
- Remove locally stored API-key material for the left Workspace after leave succeeds.
- Preserve locally stored API-key material for any remaining Workspaces.
- Do not cancel pending Workspace invitations sent by the leaver.
- Do not rotate the Workspace API key for the Workspace being left.
- Do not introduce `Group` as a domain concept; use Workspace language consistently.
- Deep module opportunity: extend Workspace policy as the durable backend Module for leave eligibility, membership removal, last-Workspace detection, and replacement bootstrap orchestration behind a small intent-shaped interface.
- Deep module opportunity: extend Workspace context as the pure frontend Module for deciding the leave request shape, refresh requirements, local context updates, and next accepted Workspace selection.
- Keep adapters thin: route handlers should translate HTTP/session details into Workspace policy calls, and the app shell should perform browser effects around Workspace context decisions.
- No schema change is expected because leaving removes rows from existing Workspace membership data and replacement creation uses existing Workspace/bootstrap data structures.

## Testing Decisions

- Good tests should exercise externally observable behavior: returned results, rejected actions, durable membership changes, replacement Workspace creation, post-action Workspace context decisions, and local API-key storage updates.
- Tests should avoid asserting internal helper call order unless the behavior cannot be observed another way.
- Add Workspace policy behavior tests for non-owner leave removing only the acting user's membership.
- Add Workspace policy behavior tests for admin leave and member leave.
- Add Workspace policy behavior tests proving owner leave is rejected.
- Add Workspace policy behavior tests proving non-member leave is rejected.
- Add Workspace policy behavior tests proving leaving does not delete the Workspace or other memberships.
- Add Workspace policy behavior tests proving leaving does not cancel pending Workspace invitations sent by the leaver.
- Add Workspace policy behavior tests proving leaving with remaining accepted Workspaces does not create a replacement Workspace.
- Add Workspace policy behavior tests proving leaving the last accepted Workspace creates a replacement personal Workspace through bootstrap behavior.
- Add Workspace policy behavior tests proving replacement Workspace creation returns one-time API-key material.
- Add route/API tests proving the leave endpoint requires a signed-in session and does not accept Workspace API-key authentication.
- Add frontend Workspace context tests for owner versus non-owner action selection.
- Add frontend Workspace context tests for successful leave selecting a replacement Workspace when returned.
- Add frontend Workspace context tests for successful leave selecting the most recently created remaining accepted Workspace when no replacement is returned.
- Add frontend Workspace context tests for leave failure preserving Workspace context.
- Add app-level or integration-oriented frontend tests only where needed to verify browser effects: confirmation prompt, request dispatch, refresh calls, and removal of local API-key material for the left Workspace.
- Prior art exists in Workspace policy behavior tests using D1-style fixtures for role, membership, invitation, deletion, and bootstrap behavior.
- Prior art exists in Workspace context tests for accepted Workspace selection, pending Workspace invitation context, action transitions, refresh requirements, and post-action context selection.
- Existing repo checks should be used rather than inventing new scripts: backend typecheck for backend changes and frontend production build for frontend changes.

## Out of Scope

- Removing or redesigning API-key-only operation across the app.
- Changing Workspace deletion behavior for owners, except keeping owner delete separate from non-owner leave.
- Adding automatic owner transfer.
- Allowing owners to leave a Workspace.
- Rotating Workspace API keys when a member leaves.
- Cancelling pending Workspace invitations when their inviter leaves.
- Adding outbound email notifications for leave events.
- Adding a Workspace audit log.
- Renaming Workspace to Group or introducing Group as a new domain concept.
- Changing account email, Better Auth identity, or invitation matching rules.
- Creating implementation tickets; this PRD only publishes the product/design specification.

## Further Notes

- The backend glossary has been updated with `Leave Workspace` as a domain term and with the resolved ambiguity that `group` means `Workspace` in this discussion.
- This PRD does not require an ADR at this stage. The feature follows existing Workspace policy and Workspace context architecture rather than introducing a hard-to-reverse architectural trade-off.
