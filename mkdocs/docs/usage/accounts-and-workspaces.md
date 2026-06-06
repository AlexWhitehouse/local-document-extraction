# Accounts And Workspaces

Users work inside Workspaces. A signed-in user may belong to multiple Workspaces, and the app remembers the last accepted Workspace selected in the browser.

## Accounts

The app supports:

- Email and password sign-up.
- Account email verification.
- Account password reset.
- Google sign-in when Google OAuth credentials are configured.

Email/password accounts must verify their email before the app bootstraps Workspace access. Passwords must be at least 8 characters and include an uppercase letter, a number, and a special character.

## Workspace Context

Most product actions require an accepted Workspace context. When you select a Workspace in the app, the Templates, Documents, members, billing, and API keys you see all belong to that Workspace.

External clients use a Workspace API key:

```text
Authorization: Bearer <workspace_api_key>
```

Workspace API keys are scoped to one Workspace and are shown only immediately after generation or rotation.

## Roles

Workspace memberships use three roles:

| Role | Summary |
| --- | --- |
| Owner | Full Workspace control, billing authority, member management, API key rotation. |
| Admin | Workspace management and API key rotation, without owner billing authority. |
| Member | Workspace product access, subject to Workspace policy and plan limits. |

## Invitations

Owners and admins can invite users by email. Pending invitations appear as invited Workspace entries until the recipient accepts or declines.

Pending invitation context is locked: invitation details and actions are visible, but product APIs are unavailable until the invitation is accepted.
