# Invite-only sign-up

`AUTH_SIGNUP_ENABLED=false` now means invite-only access rather than disabling all new accounts. Operators can admit people through Workspace invitations and bootstrap configured admin emails without temporarily opening registration.

This supersedes the closed-registration behavior and pre-registration advice in [ADR 0011](0011-portable-local-installation-configuration.md).

## Decision

- New accounts require a configured admin email or a pending, unexpired Workspace invitation. The rule covers email/password, Google and admin-plugin account creation.
- Sessions require installation admin status, a pending invitation or accepted Workspace membership. Check this at session creation, browser session resolution and live-update delivery. Admin impersonation sessions are exempt from this gate.
- An installation admin is an Application admin or an account whose normalised email is configured in `DOCUMENT_EXTRACTION_ADMIN_EMAILS`. The configured list still grants the Application admin role only at account creation; an existing listed account gains installation access without account-management privileges.
- Only installation admins create Workspaces in invite-only mode. When other accounts have no memberships, listing Workspaces accepts all pending invitations in one immediate transaction, without a personal Workspace. They cannot leave their last Workspace.
- Open mode retains personal Workspace creation and replacement on last departure. Workspace API keys retain their existing authority.
- Keep Better Auth sign-up enabled internally so its creation hooks can admit invited accounts. Return `INVITATION_REQUIRED` and `ACCESS_REQUIRED`, including Google callback redirects. A pre-handler check preserves invitation errors when Better Auth's verification flow would otherwise mask a user-creation 403 as success.

## Consequences

Removing the last membership locks out an account and its existing browser sessions unless another qualifying condition remains. A new invitation restores access. Invitation expiry and cancellation therefore affect access immediately. Workspace creation is enforced in Workspace control, including paths used by MCP consent.

Email verification is strongly advised: without it, someone who knows an admin or invited email can register that address first. This change does not automatically promote existing configured emails or accept invitations for accounts that already have Workspace membership.
