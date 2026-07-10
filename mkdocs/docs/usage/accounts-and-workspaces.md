# Accounts And Workspaces

Email/password accounts verify through the local mail sink before sign-in. Password resets use the same captured-link flow. Google sign-in is available only when local Google OAuth variables are configured.

Most product actions require an accepted Workspace context. Owners and admins can manage members, invitations, Workspace names, and API keys. Members can use the Workspace product data they are authorized to access.

Workspace API keys are scoped to one Workspace and shown only at generation or rotation. They are for Template, Document, and job API access; browser-only account, membership, invitation, and live-update flows continue to require a session.
