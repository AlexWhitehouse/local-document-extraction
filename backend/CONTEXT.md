# Backend Context

## Glossary

### Account password policy

The account password policy is the minimum strength rule for email/password account credentials.

Account passwords must be at least 8 characters and include at least one ASCII uppercase letter (`A-Z`), one ASCII number (`0-9`), and one special character, where a special character is any non-alphanumeric character.

### Workspace policy

The rules that decide what a workspace member may do inside a workspace. This includes role capabilities, invitation lifecycle, owner transfer, workspace deletion eligibility, and related membership decisions.

`Workspace policy` owns the D1 reads and writes needed to make those decisions durable; callers should not load membership rows and reimplement role checks themselves.

The first intended scope for `Workspace policy` includes role capabilities, invitations, owner transfer, deletion eligibility, workspace API key rotation, and new-user workspace bootstrap.

For new-user workspace bootstrap, `Workspace policy` owns orchestration. Starter template details should live behind a template Module once that Module exists, rather than being owned by `Workspace policy`.

Tests for `Workspace policy` should exercise policy behaviour through durable D1 fixtures, covering owner/admin/member actions, invitations, owner transfer, deletion eligibility, workspace API key rotation, and bootstrap outcomes.

### Workspace

A workspace is an environment a user can access only after they have a workspace membership.

### Workspace context

Workspace context is the currently selected workspace or pending workspace invitation that determines what the user can see and do.

Accepted workspace context enables workspace API access when the user has a session or workspace API key.

Pending workspace invitation context is locked: it shows invitation details and invitation actions, but it does not enable workspace API access until accepted.

### Workspace invitation

A workspace invitation is a pending offer for an email address to join a workspace; it is not workspace access until accepted.

Workspace invitations are in-app invitations; sending outbound email is outside the current invitation lifecycle.

Use `cancelled` for a workspace invitation that ended without acceptance, including when the invitee declines it.

Invitee decline and owner/admin cancellation are separate actions with different authorization paths, but both make the invitation `cancelled`.

Only workspace owners and admins may see pending invitations sent from a workspace.

Workspace owners and admins may cancel pending workspace invitations sent from that workspace.
A workspace owner/admin should confirm before cancelling someone else's pending invitation.

A workspace invitation remains valid after inviter role changes unless it is cancelled or expires.

Deleting a workspace deletes its workspace invitations.

Workspace invitation management shows actionable pending invitations, not accepted, cancelled, or expired invitation history.

Workspace invitation management shows pending status and invitation expiry.

Workspace invitation management shows who sent each invitation by inviter name when available, falling back to inviter email.
Workspace invitation summaries include workspace, invited email, offered role, pending status, inviter identity, invited time, and expiry.

Invitees should see who invited them by inviter name when available, falling back to inviter email.

Invitees should see the role offered by a workspace invitation before accepting it.

Invitees should see the invited email address on the workspace invitation detail view.

Only actionable pending workspace invitations should appear in an invitee's workspace list; expired invitations are hidden from that list.

Invitees accept or decline a workspace invitation from the invitation detail view, not directly from the workspace list.
Invitees do not need a confirmation prompt when declining their own workspace invitation.

An invitee has no workspace API access before accepting a workspace invitation.
Selecting an invited workspace does not make it the active workspace context until the invitation is accepted.
A selected invited workspace shows a locked invitation state rather than API readiness or activity from another workspace.

A current workspace member should not also have a pending workspace invitation for the same workspace.

Accepting a workspace invitation must not overwrite an existing workspace membership or change its role.

Workspace invitations match the invitee by the account's current email address; account email is not user-editable.

Users should normally always have at least one accepted workspace; if that invariant is broken and only invitations are available, select the latest-updated invitation.

## Relationships

- A **Workspace invitation** may be displayed beside **Workspaces**, but it does not create a **Workspace** membership until accepted.
- Accepted **Workspaces** appear before invited workspace entries; invited entries are ordered by latest update first.
- Current workspace members and pending **Workspace invitations** are separate access-management lists.
- Accepting a **Workspace invitation** creates a workspace membership and moves the user into that workspace context.
- Declining a **Workspace invitation** makes it non-actionable and removes it from the invitee's workspace list.
