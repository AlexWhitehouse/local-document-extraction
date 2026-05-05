# App Action Toast Feedback PRD

Status: needs-triage

## Problem Statement

Users currently receive inconsistent feedback after explicit app actions. The auth page already uses Sonner toasts for visible validation and failure feedback, but most signed-in workspace, template, workspace invitation, workspace member action, document, and clipboard actions only write to the activity log or inline state. This can leave users unsure whether a save, delete, API key rotation, invitation, role change, upload, retry, or copy action succeeded or failed.

The existing activity log remains useful for diagnostics, but it is not enough immediate feedback for important user-initiated actions. Some destructive actions also have uneven safeguards: workspace delete, leave, document delete, and workspace invitation cancellation confirm first, while template deletion does not.

## Solution

Add Sonner toast feedback throughout the signed-in app for explicit user-initiated actions. Toasts should confirm terminal success, report validation blockers, and show concise user-friendly failure messages. Existing activity-log entries should remain the place for raw technical details.

Toast feedback should cover workspace API key rotation, workspace creation, workspace rename, leaving a workspace, deleting a workspace, template creation, template saving, template deletion, template JSON save/import validation, template JSON copy, workspace invitation creation, workspace invitation cancellation, accepting and declining workspace invitations, workspace member actions, document upload/queue, document retry, and document deletion.

Background refresh, listing, polling, and silent operations should not create toast noise. Template field edits are draft changes and should not toast until the template is persisted. Multi-file upload should produce one aggregate toast after the queue batch finishes.

Add a deep notification-copy module with a small interface for action-specific success, validation, and failure messages. The signed-in app should call this module from action handlers instead of scattering ad hoc toast strings. Add template dirty-state tracking so edited-template save is disabled until changes exist, matching workspace save behavior. Add a confirmation prompt before template deletion.

## User Stories

1. As a signed-in user, I want visible feedback after rotating a workspace API key, so that I know the credential changed.
2. As a signed-in user, I want API key rotation toasts to avoid showing key material, so that secrets are not exposed in notification history.
3. As a signed-in user, I want API key rotation failures to be visible, so that I know the existing key may still be active.
4. As a workspace member, I want a toast after creating a workspace, so that I know the new **Workspace** exists.
5. As a workspace member, I want workspace creation failures to be visible, so that I understand the action did not succeed.
6. As a workspace member, I want a toast after renaming a **Workspace**, so that I know the name was saved.
7. As a workspace member, I want workspace rename failures to be visible, so that I know the old name may still be in effect.
8. As a workspace member, I want the workspace save button disabled when the workspace name has not changed, so that I do not trigger meaningless no-op saves.
9. As a non-owner workspace member, I want a toast after **Leave Workspace** succeeds, so that I know my workspace access was removed.
10. As a non-owner workspace member, I want the leave-workspace toast to mention when a replacement personal **Workspace** was created, so that I understand why I still have an active workspace.
11. As a non-owner workspace member, I want leave-workspace failures to be visible, so that I know I may still have access to the workspace.
12. As a workspace member, I do not want a toast when I cancel the leave confirmation, so that cancelling a no-op does not create noise.
13. As a workspace owner, I want a toast after deleting a **Workspace**, so that I know the workspace was removed.
14. As a workspace owner, I want workspace delete failures to be visible, so that I know the workspace may still exist.
15. As a workspace owner, I do not want a toast when I cancel the delete confirmation, so that aborted destructive actions stay quiet.
16. As a template builder, I want a toast after creating a template, so that I know the reusable extraction schema was persisted.
17. As a template builder, I want template creation failures to be visible, so that I know the template was not saved.
18. As a template builder, I want validation blockers during template creation to show a toast, so that I know what must be fixed before saving.
19. As a template builder, I want a toast after saving changes to an existing template, so that I know the edit was persisted.
20. As a template builder, I want template save failures to be visible, so that I know the previous template may still be active.
21. As a template builder, I want the edited-template save button disabled until the loaded template changes, so that I do not accidentally perform no-op saves.
22. As a template builder, I want local field additions to stay toast-free, so that draft edits do not imply persistence.
23. As a template builder, I want local field deletions to stay toast-free, so that draft edits do not imply persistence.
24. As a template builder, I want local field edits to stay toast-free, so that typing does not create notification noise.
25. As a template builder, I want template persistence toasts to cover field changes, so that I know added, deleted, or edited fields were actually saved.
26. As a template builder, I want a confirmation prompt before deleting a template, so that accidental destructive clicks can be stopped.
27. As a template builder, I want a toast after deleting a template, so that I know the template was removed.
28. As a template builder, I want template deletion failures to be visible, so that I know the template may still exist.
29. As a template builder, I do not want a toast when I cancel the template delete confirmation, so that no-op cancellation stays quiet.
30. As a template builder using template JSON, I want invalid JSON save attempts to show a short toast, so that the blocked action is immediately visible.
31. As a template builder using template JSON, I want detailed JSON validation errors to remain inline, so that I can fix the exact problem.
32. As a template builder using template JSON, I want successful JSON template saves to toast, so that I know the import/update was persisted.
33. As a template builder, I want a toast after copying template JSON to the clipboard, so that I know the copy action worked.
34. As a template builder, I want copy-to-clipboard failures to be visible, so that I know the clipboard was not updated.
35. As a workspace owner or admin, I want a toast after inviting a teammate, so that I know the **Workspace invitation** was created.
36. As a workspace owner or admin, I want invitation success copy to say “Successfully invited {email}”, so that the wording is natural without implying outbound email delivery.
37. As a workspace owner or admin, I want invite validation blockers to show a toast, so that I know when an email address or workspace context is missing.
38. As a workspace owner or admin, I want invite failures to be visible, so that I know the pending **Workspace invitation** may not exist.
39. As a workspace owner or admin, I want a toast after cancelling a pending **Workspace invitation**, so that I know it is no longer actionable.
40. As a workspace owner or admin, I want cancellation success copy to use “Invitation cancelled”, so that the UI matches the domain lifecycle term.
41. As a workspace owner or admin, I want invitation cancellation failures to be visible, so that I know the invitation may still be pending.
42. As a workspace owner or admin, I do not want a toast when I cancel the browser confirmation for cancelling an invitation, so that aborted actions stay quiet.
43. As an invitee, I want a toast after accepting a **Workspace invitation**, so that I know workspace access was created.
44. As an invitee, I want invitation acceptance failures to be visible, so that I know I may not have access to the workspace.
45. As an invitee, I want a toast after declining a **Workspace invitation**, so that I know the invitation is no longer actionable.
46. As an invitee, I want decline success copy to say “Invitation declined”, so that the toast reflects my action even though the lifecycle status is `cancelled`.
47. As an invitee, I want invitation decline failures to be visible, so that I know the invitation may still be pending.
48. As a workspace owner or admin, I want a toast after removing a member from a workspace, so that I know the member's workspace access changed.
49. As a workspace owner or admin, I want remove-member copy to say “Removed {member} from workspace”, so that it does not imply the account was deleted globally.
50. As a workspace owner, I want a toast after making a member an admin, so that I know the role changed.
51. As a workspace owner, I want make-admin copy to say “Made {member} an admin”, so that the role change is clear.
52. As a workspace owner, I want a toast after transferring workspace ownership, so that I know the owner changed.
53. As a workspace owner, I want ownership-transfer copy to say “Workspace ownership transferred to {member}”, so that the consequence is clear.
54. As a workspace manager, I want **Workspace member action** failures to be visible, so that I know the member's access or role may not have changed.
55. As a workspace manager, I want toasts to use **Workspace member action** language rather than user-status language, so that the UI matches the domain model.
56. As a document uploader, I want a toast after uploading one document for extraction, so that I know the document was queued.
57. As a document uploader, I want upload validation blockers to show a toast, so that I know when a template or file selection is missing.
58. As a document uploader, I want upload queue failures to be visible, so that I know a document did not start processing.
59. As a document uploader, I want one aggregate toast after a multi-file upload batch, so that I get useful feedback without one toast per file.
60. As a document uploader, I want an all-success batch toast such as “3 documents queued”, so that I know the full batch started.
61. As a document uploader, I want a mixed batch toast such as “2 documents queued, 1 failed”, so that I know some files need attention.
62. As a document uploader, I want per-file upload details to remain in inline status rows and the activity log, so that the aggregate toast stays concise.
63. As a document reviewer, I want a toast after retrying a failed document, so that I know the retry was queued.
64. As a document reviewer, I want retry validation blockers to show a toast, so that I know when no document is selected or the document is not retryable.
65. As a document reviewer, I want retry failures to be visible, so that I know the failed document may not have been requeued.
66. As a document reviewer, I want a toast after deleting a document, so that I know the document was removed from the workspace.
67. As a document reviewer, I want delete-document failures to be visible, so that I know the document may still exist.
68. As a document reviewer, I want a success-style toast when a delete returns already-removed and the UI cleans up local state, so that I know the desired state was achieved.
69. As a document reviewer, I do not want a toast when I cancel the document delete confirmation, so that no-op cancellation stays quiet.
70. As a user waiting on extraction, I do not want polling completion toasts, so that background job updates do not create noise.
71. As a user waiting on extraction, I want the document status UI to remain the source of truth for completed and failed extraction states, so that notifications only confirm initiated actions.
72. As a user, I want raw backend errors kept out of most toasts, so that notifications are readable and non-technical.
73. As a user, I want raw backend errors to remain in the activity log, so that support and debugging details are still available.
74. As a user, I want success toasts to include human-readable names or emails when available, so that I can tell which item changed.
75. As a user, I want opaque IDs used in success toasts only as a fallback, so that notifications remain understandable.
76. As a user, I want validation and guard failures to use error toasts, so that blocked actions are visually clear.
77. As a user, I want completed destructive actions to use success toasts, so that the notification confirms the requested state change.
78. As a user, I do not want loading toasts for these actions, so that existing button disabled/spinner states remain the loading feedback.
79. As a user, I do not want background list, refresh, or poll errors to toast, so that passive app activity does not interrupt me.
80. As a user, I do not want explicit silent operations to toast, so that hidden/bootstrap flows remain hidden.
81. As a maintainer, I want notification copy centralized behind a small interface, so that tone and terminology stay consistent.
82. As a maintainer, I want notification behavior testable without rendering the whole app, so that copy and scope rules can be verified cheaply.
83. As a maintainer, I want existing Sonner global configuration preserved, so that this work changes feedback coverage rather than toast presentation.
84. As a maintainer, I want existing activity-log behavior preserved, so that diagnostics and action history are not lost.
85. As a maintainer, I want no database schema changes for this feature, so that deployment risk stays low.
86. As a maintainer, I want no API contract changes for this feature, so that feedback improvements remain frontend-focused.
87. As an AI coding agent, I want the resolved **Workspace member action** term documented, so that future access-management work avoids “user status” ambiguity.

## Implementation Decisions

- Add a deep toast-notification module named `toastNotifications` that owns user-facing notification copy and action-specific message selection.
- The toast-notification module should expose a simple interface for success, validation, and failure messages that the signed-in app can pass to Sonner.
- Keep Sonner's existing global configuration unchanged.
- Preserve existing activity-log entries. Raw backend error details should continue to be logged there.
- Failure toasts should generally be concise and user-friendly, with raw backend details omitted from the toast.
- Validation and guard blocks should use error toasts.
- Completed destructive actions should use success toasts.
- Do not add loading toasts; existing busy/disabled/spinner state remains the loading indicator.
- Do not toast background refresh, listing, or polling activity.
- Suppress toasts for actions invoked with an explicit silent option.
- Include human-readable target names or emails in success toasts when available; use opaque IDs only as fallbacks.
- Do not include API key material in any toast.
- Template field add, remove, duplicate, reorder, and edit operations are local draft edits and should not toast immediately.
- Template create/update/JSON save toasts should represent persistence of the current field draft.
- Add edited-template dirty-state tracking so save is disabled until the loaded template has changed.
- Keep new-template save enabled when API access exists, and rely on validation toasts for incomplete or invalid draft data.
- Keep detailed template JSON validation errors inline and add a short error toast for invalid JSON/schema save attempts.
- Add success and failure toasts for copying template JSON to the clipboard.
- Add confirmation before template deletion.
- Keep cancellation of browser confirmations silent.
- Use “Successfully invited {email}” for workspace invitation creation success.
- Use “Invitation cancelled for {email}” for owner/admin cancellation of a pending **Workspace invitation**.
- Use “Invitation declined” for invitee decline success.
- Use “Workspace ownership transferred to {member}” for ownership transfer.
- Use “Removed {member} from workspace” for member removal.
- Use “Made {member} an admin” for admin promotion.
- Mention replacement personal **Workspace** creation in the leave-workspace success toast when that edge case occurs.
- Use one aggregate toast after a multi-file upload queue batch.
- Toast document queue/retry success when the queue request succeeds, but do not toast eventual polling-based extraction completion or failure.
- Treat document delete 404 cleanup as a success-style “already removed” outcome.
- No schema changes are required.
- No backend API contract changes are required.

## Testing Decisions

- Good tests should assert external behavior: given an action outcome and relevant display target, the notification layer returns the intended user-facing message and severity.
- Tests should avoid coupling to internal helper implementation details such as private maps or string-construction internals.
- Add focused unit tests for the `toastNotifications` module.
- Test success copy for representative workspace, template, workspace invitation, workspace member action, document, and clipboard actions.
- Test validation/failure message selection for representative blocked and failed actions.
- Test that API key notification messages do not include key material.
- Test multi-file upload aggregate message selection for all-success, all-failure, and mixed outcomes.
- Test member-action terminology for remove member, make admin, and transfer ownership.
- Test invitation terminology for invite, cancel, accept, and decline flows.
- Test document delete already-removed copy as a success-style outcome.
- Prefer minimal app integration tests only if wiring is risky; do not add broad UI tests for every toast-producing action.
- Prior art exists in the frontend test suite for Sonner mocking around auth feedback and for isolated domain logic module testing.

## Out of Scope

- Changing Sonner placement, duration, theme, or visual styling.
- Replacing browser confirmations with custom modal dialogs.
- Adding polling-based job completion or failure toasts.
- Toasting background refresh, list, or poll failures.
- Toasting local template field draft edits before persistence.
- Adding sign-in, sign-up, sign-out, or profile success toasts.
- Changing outbound email behavior for **Workspace invitations**.
- Changing workspace, template, document, or invitation API contracts.
- Changing database schema.
- Removing the existing activity log.
- Adding broad integration coverage for every app action.

## Further Notes

The domain term for access-management changes is **Workspace member action**, not “user status change.” A **Workspace member action** changes a member's workspace access or role and may remove a member, make a member an admin, or transfer ownership.

The existing glossary defines **Workspace invitations** as in-app offers; outbound email is outside the current invitation lifecycle. Toast copy should avoid wording that implies an email was delivered.

The app currently uses Sonner for auth error feedback, which establishes the expected toast mechanism. This PRD extends that mechanism across the signed-in app while keeping feedback scoped to explicit user actions.
