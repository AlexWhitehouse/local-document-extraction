# PRD: Workspace Invitation Visibility and Actions

Status: needs-triage

## Problem Statement

Users can invite people to workspaces, but the invitation lifecycle is not visible enough to either side. Workspace owners and admins cannot see pending invited users and their status from workspace management, and invited users cannot see pending workspace invitations in the workspaces list or accept/decline them from an invitation-focused view.

This makes collaboration unclear. Inviters cannot tell whether an invitation is pending or nearing expiry, invitees do not have an in-app path to discover and respond to invitations, and the UI does not distinguish accepted workspace access from a workspace invitation that is only an offer.

## Solution

Expose workspace invitations as first-class in-app objects while preserving the domain boundary that a workspace invitation is not workspace access until accepted.

Owners and admins will see actionable pending workspace invitations in a separate pending invitations section in workspace access management. Each summary will show invited email, offered role, pending status, inviter identity, invited time, and expiry. Owners and admins can cancel pending invitations after confirmation.

Invitees will see actionable pending workspace invitations merged into the visible workspaces list after accepted workspaces. Invited entries will be outlined in orange and clearly marked as invited, including the offered role. Selecting an invited workspace will not make it the active workspace context. Instead, the Workspaces page will show a locked invitation detail view with workspace name, invited email, offered role, inviter, invited time, expiry, and accept/decline actions.

Accepting a workspace invitation creates workspace membership, preserves any existing membership role if one already exists, refreshes workspace state, and switches the user into that workspace. Declining an invitation marks it `cancelled`, removes it from the invitee's workspace list, and does not require a confirmation prompt.

## User Stories

1. As a workspace owner, I want to see pending invitations sent from my workspace, so that I understand who has been invited but has not joined.
2. As a workspace admin, I want to see pending invitations sent from my workspace, so that I can help manage workspace access.
3. As a workspace member, I want pending invitation management hidden from me, so that access-management authority remains owner/admin-only.
4. As a workspace owner, I want pending invitations separate from current workspace members, so that I do not confuse invited people with users who already have access.
5. As a workspace admin, I want pending invitations separate from current workspace members, so that I do not try to manage an invitee like a member.
6. As a workspace owner, I want to see the invited email for each pending invitation, so that I can verify the intended recipient.
7. As a workspace admin, I want to see the invited email for each pending invitation, so that I can catch mistakes before the invitation is accepted.
8. As a workspace owner, I want to see the offered role for each pending invitation, so that I know what access the invitee will receive.
9. As a workspace admin, I want to see the offered role for each pending invitation, so that I can validate admin/member invite intent.
10. As a workspace owner, I want to see who sent each pending invitation, so that I can understand responsibility for workspace access offers.
11. As a workspace admin, I want to see who sent each pending invitation, so that multiple admins can coordinate invite management.
12. As a workspace owner, I want inviter identity shown by name when available and email otherwise, so that the display is human-readable and unambiguous.
13. As a workspace admin, I want inviter identity shown by name when available and email otherwise, so that I can identify the inviter even if a profile name is missing.
14. As a workspace owner, I want to see when each invitation was created, so that I know how long it has been pending.
15. As a workspace admin, I want to see when each invitation was created, so that I can follow up on stale invitations.
16. As a workspace owner, I want to see when each invitation expires, so that I know when it will stop being actionable.
17. As a workspace admin, I want to see when each invitation expires, so that I can decide whether to cancel and re-invite.
18. As a workspace owner, I want pending invitation status shown with expiry, so that status is more informative than just “Pending”.
19. As a workspace admin, I want pending invitation status shown with expiry, so that I can understand the active invitation lifecycle.
20. As a workspace owner, I want accepted, cancelled, and expired invitation history excluded from workspace invitation management, so that the panel remains focused on actionable work.
21. As a workspace admin, I want accepted invitees to appear as current users after acceptance, so that invitation management does not duplicate membership management.
22. As a workspace owner, I want cancelled and expired invitations hidden from the pending invitation list, so that I do not manage non-actionable entries.
23. As a workspace owner, I want to cancel a pending invitation, so that I can revoke an offer sent to the wrong email or role.
24. As a workspace admin, I want to cancel a pending invitation, so that I can help correct workspace access mistakes.
25. As a workspace owner, I want a confirmation prompt before cancelling someone else's invitation, so that I do not revoke access offers accidentally.
26. As a workspace admin, I want a confirmation prompt before cancelling someone else's invitation, so that pending access changes are deliberate.
27. As an invited user, I want pending workspace invitations to appear in my workspaces list, so that I can discover invitations without visiting a separate inbox.
28. As an invited user, I want invited workspaces outlined in orange, so that I can distinguish invitations from accepted workspace access.
29. As an invited user, I want invited workspace entries labeled as invited, so that I know I cannot use them until accepting.
30. As an invited user, I want invited workspace entries to show the offered role, so that I understand the access I will receive.
31. As an invited user, I want accepted workspaces listed before invited workspace entries, so that my existing usable workspaces remain primary.
32. As an invited user, I want invited workspace entries ordered by latest update first within the invited group, so that recent invitations are easiest to find.
33. As an invited user, I want the workspaces count to include invited workspace entries, so that the sidebar count matches the visible list.
34. As an invited user, I want workspace search to find invited entries by workspace name, workspace id, inviter name, inviter email, invited email, and offered role, so that I can locate an invitation quickly.
35. As an invited user, I want selecting an invited workspace to open an invitation detail view, so that I can review the offer before acting.
36. As an invited user, I want selecting an invited workspace not to activate workspace API access, so that no templates, documents, jobs, API keys, or user management are exposed before acceptance.
37. As an invited user, I want the selected invited workspace to show a locked state rather than API readiness from another workspace, so that the UI is not misleading.
38. As an invited user, I want the normal workspace settings cards replaced by invitation details while an invitation is selected, so that I only see actions relevant to the invitation.
39. As an invited user, I want to see the workspace's current name on the invitation detail view, so that I know which workspace I will join.
40. As an invited user, I want to see who invited me by inviter name when available and email otherwise, so that I can recognize the source of the invitation.
41. As an invited user, I want to see the invited email address, so that I understand why this account is eligible for the invitation.
42. As an invited user, I want to see the offered role before accepting, so that I understand my future access level.
43. As an invited user, I want to see the absolute invited time, so that I know when the offer was created.
44. As an invited user, I want to see the absolute expiry time, so that I know how long I can act on the invitation.
45. As an invited user, I want to accept an invitation from the detail view, so that I can join the workspace intentionally.
46. As an invited user, I want acceptance to switch me into the accepted workspace, so that I can immediately start using it.
47. As an invited user, I want acceptance to create the intended workspace membership, so that my workspace access matches the offered role.
48. As an invited user who is already a member due to a race or manual change, I want accepting an invitation not to overwrite my existing role, so that membership remains authoritative.
49. As an invited user, I want to decline an invitation from the detail view, so that I can remove an unwanted workspace offer.
50. As an invited user, I want decline to remove the invited workspace from my list immediately, so that non-actionable invitations disappear.
51. As an invited user, I want decline not to require a confirmation prompt, so that rejecting my own access offer is lightweight.
52. As an invited user, I want expired invitations hidden from my workspace list, so that I only see actionable invitations.
53. As an invited user, I want an expired invitation to be rejected if I try to accept it, so that workspace access cannot be granted after expiry.
54. As an invited user, I want invitations matched to my current account email, so that invitations cannot be claimed by another account.
55. As an invited user, I want invitations to remain valid if the inviter is later demoted, so that issued offers are stable unless cancelled or expired.
56. As an invited user, I want invitations to disappear if the workspace is deleted, so that I cannot accept an invitation to a non-existent workspace.
57. As a workspace owner, I want invitation creation to reject emails that already belong to current workspace members, so that a member does not also appear invited.
58. As a workspace admin, I want invitation creation to reject emails that already belong to current workspace members, so that pending invitations do not duplicate existing access.
59. As a workspace owner, I want duplicate pending invitations to the same normalized email blocked, so that invite state stays clear.
60. As a workspace admin, I want duplicate pending invitations to the same normalized email blocked, so that the pending invitation list remains understandable.
61. As a workspace owner, I want admins to continue being able to invite admins and members, so that existing role policy is preserved.
62. As a workspace admin, I want to invite admins and members, so that I can continue managing collaboration under the current rules.
63. As a product user, I want workspace invitations to be in-app only for now, so that the feature does not depend on email delivery setup.
64. As a backend maintainer, I want invitee decline and owner/admin cancellation to use distinct authorization paths, so that each action is secured by the right rule.
65. As a backend maintainer, I want decline and cancellation to share the same terminal `cancelled` status, so that no schema migration is required for this feature.
66. As a backend maintainer, I want workspace invitation summaries to use one consistent response shape where authorization allows, so that frontend branching remains minimal.
67. As a frontend maintainer, I want invited workspace selection tracked separately from active workspace context, so that existing workspace API effects do not run against invitations.
68. As a frontend maintainer, I want invitation state loaded with workspaces after sign-in, so that sidebar counts and workspace lists are correct globally.
69. As a backend maintainer, I want `Workspace policy` to own invitation lifecycle rules, so that route handlers do not reimplement membership and invitation decisions.
70. As an AFK agent, I want the invitation lifecycle specified in one PRD, so that backend API, policy tests, and frontend behavior can be implemented consistently.

## Implementation Decisions

- Preserve the domain boundary between `Workspace` and `Workspace invitation`: an invitation may be displayed beside workspaces but does not create workspace access until accepted.
- Use the existing `cancelled` invitation status for both invitee decline and owner/admin cancellation.
- Do not introduce a `declined` status in this feature.
- Treat invitation delivery as in-app only. Outbound email notifications are out of scope.
- List only actionable pending invitations in both invitee-facing and workspace-management views.
- Hide expired invitations from invitee workspace lists and pending workspace-management lists.
- Keep accepted, cancelled, and expired invitation history out of the workspace access-management UI.
- Keep current users and pending invitations in separate access-management sections.
- Owners and admins can see pending invitations sent from their workspace.
- Members cannot see workspace pending invitation management.
- Owners and admins can cancel pending workspace invitations after a confirmation prompt.
- Invitees can decline their own invitations without a confirmation prompt.
- Invitee decline and owner/admin cancellation should be separate API routes with separate authorization rules, backed by shared `Workspace policy` behavior that sets status to `cancelled`.
- Add a workspace-scoped pending invitations endpoint for owners/admins rather than overloading the workspace users endpoint.
- Keep the existing users endpoint focused on current workspace members.
- Expand created invitation responses and invitation listing responses to include invitation summary data: invitation id, workspace id, workspace current name, invited email, offered role, pending status, inviter id, inviter name, inviter email, invited time, expiry, and update time where useful for sorting.
- Use the same invitation summary shape for invitee-facing and workspace-management listings where authorization allows.
- The accept response should remain action-oriented with success, workspace id, and accepted role so the frontend can switch workspace context.
- Decline and cancellation responses can be minimal with success, invitation id, and `cancelled` status.
- Invite creation should reject a pending invitation when the normalized invited email already belongs to a current workspace member.
- Invite creation should continue rejecting duplicate pending invitations by normalized email and workspace.
- Invite creation should keep the current role policy: owners and admins can invite both admins and members.
- Accepting an invitation should not overwrite an existing workspace membership or change its role if membership already exists.
- Accepting an invitation should create membership and move the user into that workspace when no membership already exists.
- Invitation acceptance should only require the invitation to be pending, unexpired, matched to the signed-in user's current email, and associated with an existing workspace.
- Invitation validity should not depend on the inviter still being owner/admin at acceptance time.
- Deleting a workspace should delete its workspace invitations through existing cascade behavior.
- Account email is not user-editable; invitations should match the signed-in user's current normalized account email.
- Use the workspace's current name in invitation views rather than snapshotting the name at invite time.
- Show inviter name when available, falling back to inviter email.
- Show invited and expiry times as human-readable absolute timestamps.
- Use `created_at` for “invited at”.
- Use `expires_at` for expiry.
- Use `updated_at` only where needed for sorting invited workspace fallback behavior.
- Fetch invitee-facing invitations at the same time as workspaces after sign-in/session load because invitations affect the global workspace list and sidebar count.
- The visible workspaces list should merge accepted workspaces and actionable pending invitations on the frontend.
- Accepted workspaces should appear before invited workspace entries.
- Invited entries should be ordered by latest update first within the invited group.
- Users should normally always have at least one accepted workspace because they cannot delete their only workspace.
- If that invariant is broken and the user has no accepted workspaces but has invitations, auto-select the latest-updated invitation.
- Invited workspace list items should be outlined in orange and marked as invited.
- Invited workspace list items should show offered role.
- Invited workspace search should match workspace name, workspace id, inviter name, inviter email, invited email, and offered role.
- Track selected invited workspace/invitation separately from the active accepted workspace id.
- Selecting an invited workspace should not set active workspace context for API access.
- When an invitation is selected, show a locked invitation-specific toolbar/page state rather than API readiness, job counts, or activity from another workspace.
- Replace the normal Workspaces page settings/cards with an invitation detail view while an invitation is selected.
- The invitation detail view should include workspace name, invited email, offered role, inviter, invited time, expiry, accept action, and decline action.
- Accept and decline actions should only appear in the invitation detail view, not directly on the list item.
- The Create Workspace action may remain available while an invitation is selected, but delete workspace and workspace-management actions should not be shown for an invitation selection.
- Major backend module to modify: `Workspace policy`, which should remain the deep Module that owns durable invitation lifecycle, authorization, expiry, membership conflict, and cancellation decisions.
- Major backend module to modify: workspace API route handling, which should stay thin and delegate invitation decisions to `Workspace policy`.
- Major frontend module to modify: workspace state/list composition, which should merge accepted workspaces and invitation entries while preserving separate active workspace and selected invitation state.
- Major frontend module to modify: Workspaces page rendering, which should switch between accepted workspace management and locked invitation detail views.
- Major frontend module to modify: workspace access-management UI, which should display current users and pending invitations as separate lists.
- Potential deep frontend helper: a workspace/invitation list composition function that accepts accepted workspaces, pending invitations, selected ids, and search text, then returns display items with stable status and sorting. This can be tested independently if frontend tests are introduced later.

## Testing Decisions

- Good tests should exercise external behavior through public Module interfaces or API-level behavior, not private helper functions or SQL string details.
- Backend tests should focus on `Workspace policy` because it is the deep Module that owns workspace invitation lifecycle decisions.
- Backend tests should use the existing D1 fixture-style prior art from workspace policy tests.
- Test owner/admin/member authorization for listing workspace pending invitations.
- Test owner/admin cancellation of pending invitations.
- Test that members cannot list or cancel workspace pending invitations.
- Test invitee decline authorization by invited email.
- Test that decline and owner/admin cancellation both set status to `cancelled`.
- Test that cancelled invitations no longer appear in actionable pending lists.
- Test that expired invitations are hidden from actionable lists or marked expired before terminal errors where appropriate.
- Test invitation summaries include workspace details, invited email, offered role, status, inviter identity, invited time, and expiry.
- Test inviter name fallback to email when name is missing.
- Test invite creation rejects existing workspace members by normalized invited email.
- Test invite creation still rejects duplicate pending invitations by normalized invited email.
- Test accepting an invitation creates membership when no membership exists.
- Test accepting an invitation does not overwrite an existing membership role.
- Test accepting an invitation for a different email remains forbidden.
- Test accepting an expired invitation remains rejected and non-actionable.
- Test invitation acceptance does not require inviter to still be owner/admin.
- Test deleted workspaces remove or hide their invitations through cascade behavior.
- Test route-level mapping for new decline and cancellation endpoints at a thin level, including HTTP status/error mapping.
- Frontend verification should cover visible behavior: orange invited workspace entries, accepted-first ordering, invited detail view, locked toolbar state, accept switching workspace, decline removing the invitation, and pending invitations separated from current users.
- If frontend tests are added, test the extracted workspace/invitation list composition helper rather than brittle DOM implementation details.
- Existing repo verification commands should be used after implementation: backend typecheck and frontend production build.
- Do not invent unrelated lint or test scripts.

## Out of Scope

- Sending invitation emails or integrating with an email provider.
- Resending invitations.
- Full invitation audit history for accepted, cancelled, declined, or expired invitations.
- Introducing a separate `declined` status.
- Snapshotting workspace names at invitation time.
- Making account email user-editable.
- Supporting old email addresses after an account email change.
- Changing custom role semantics or adding new workspace roles.
- Restricting admins from inviting admins.
- Requiring inviter role revalidation at acceptance time.
- Making invited workspace entries grant API access before acceptance.
- Showing templates, documents, jobs, API key, workspace rename, delete, or user management for a selected invited workspace.
- Adding direct accept/decline controls to the workspace list item.
- Replacing existing workspace deletion cascade behavior.
- Building a general notification center.

## Further Notes

- The backend context glossary has been updated with the resolved `Workspace invitation` rules.
- The existing database status vocabulary already supports `cancelled`, so this feature should not need a migration solely for decline/cancellation status.
- The current backend already has invite creation, invitee pending invitation listing, and invitation acceptance foundations.
- The current backend does not yet have decline, owner/admin cancellation, or workspace-scoped pending invitation listing.
- The current frontend already has workspace listing, workspace user listing, and invite creation UI foundations.
- The current frontend does not yet merge invitation entries into the workspace list or render a locked invitation detail view.
- This PRD intentionally keeps `Workspace policy` as the durable backend decision point rather than moving invitation rules into route handlers or frontend-only behavior.
