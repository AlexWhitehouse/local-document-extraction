# Accounts And Workspaces

Email/password accounts require verification by default. Local email mode records verification/reset links in private server output and the local mail sink; installer users can retrieve them with the launcher's `mail` command. Optional Cloudflare mode delivers these messages to the account inbox. Account policy can disable registration, password login, or the verification requirement. Google sign-in appears only when the operator explicitly enables it and supplies both OAuth credentials; generic OIDC/SAML are not supported.

Most product actions require an accepted Workspace context. Owners and admins can manage members, invitations, Workspace names, and API keys. Members can use the Workspace product data they are authorized to access.

Each Workspace also owns its model gateway configuration. Owners/admins configure the endpoint, model, encrypted outbound credential, and capabilities before Documents can be uploaded. Members can see whether configuration is present but cannot view or change its details. Workspace invitations are in-app invitations, not outbound invitation emails.

Workspace API keys are scoped to one Workspace and shown only at generation or rotation. They are for Template, Document, and job API access; browser-only account, membership, invitation, and live-update flows continue to require a session.
