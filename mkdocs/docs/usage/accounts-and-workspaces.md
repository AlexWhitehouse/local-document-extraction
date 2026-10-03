# Accounts and Workspaces

## Accounts

Sign up with an email address and password, or use Google when configured. The operator controls these settings:

- New-account creation.
- Email and password sign-in.
- Email verification for new accounts.

By default, verification and password reset emails remain on the app’s machine. The app does not send them. Installer users can retrieve links with the launcher’s `mail` command. The operator can configure Cloudflare email delivery.

Google is the only external sign-in provider. OIDC and SAML are not supported.

## Workspaces

A Workspace holds templates, documents, jobs, members, API keys, and model settings. You must be a member to use a Workspace.

| Role | Permissions |
| --- | --- |
| Member | Use templates, documents, and Evaluations. View model configuration status. Leave the Workspace. |
| Admin | All member permissions. Invite users, manage invitations, remove members, rename the Workspace, rotate its API key, and configure its model. |
| Owner | All admin permissions. Promote members to admin or owner, remove admins, and delete the Workspace. Owners cannot leave their Workspace. |

Invitations appear in the app when the invited user signs in. The app does not email invitations.

## Model settings

Each Workspace has a model gateway URL, encrypted credential, and model roles. An owner or admin must configure them before document uploads. Members can view configuration status, but cannot read the settings.

- **Extraction** reads document fields and runs Evaluations.
- **Document classification & splitting** selects templates and identifies PDF document boundaries.
- **Template assistant** helps edit templates and generate drafts from samples.

Classification and Template assistant inherit Extraction settings unless you select **Different model**. Different models share the gateway and credential. Each has separate Direct PDF input and Structured output settings.

Test connection verifies a text reply from each distinct model. It does not verify document support or provider image limits.

## Document processing

**Document processing** appears below **Model gateway**. Owners and admins can change **Enable smart splitting** and **Exclude blank pages**. Changes save immediately, with a notification. Both settings default to off. Blank exclusion requires splitting.

Settings apply to later browser and API submissions. Accepted work retains its recorded settings.

Automatic template selection has no Workspace switch. To request it, select tags instead of a template during upload. See [Document extraction](document-extraction.md) for automatic selection, splitting, and manual review.

## API keys

A Workspace API key gives scripts access to its templates, documents, and jobs. The app shows the key once, during generation or rotation. Manage accounts, membership, and invitations in the browser. Browser progress updates also require sign-in. See [API keys](../api/authentication.md).
