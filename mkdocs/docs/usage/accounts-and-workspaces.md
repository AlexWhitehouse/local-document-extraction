# Accounts and Workspaces

## Accounts

You can sign up with an email address and password, or with Google if it's been set up. The person running the app decides:

- whether new accounts can be created
- whether email and password sign-in is allowed
- whether new accounts must verify their email address

By default, account emails (verification and password reset) aren't sent. The links are saved on the machine running the app, and installer users can read them with the launcher's `mail` command. The app can also be set up to send them through Cloudflare. Only Google sign-in is supported; OIDC and SAML aren't.

## Workspaces

A Workspace holds its own templates, documents, jobs, members, API keys, and model settings. You need to be a member of a Workspace to use it.

| Role | Can do |
| --- | --- |
| Member | Use the Workspace's templates, documents, and Evaluations, see whether a model is set up, and leave the Workspace. |
| Admin | Everything a member can, plus invite people and manage invitations, remove members, rename the Workspace, rotate its API key, and set up its model. |
| Owner | Everything an admin can, plus make members admins, make someone an owner, remove admins, and delete the Workspace. Owners can't leave their own Workspace. |

Invitations appear inside the app when the invited person signs in. They aren't sent by email.

## Model settings

Each Workspace has its own model gateway: an address, a model name, an encrypted credential, and the model's capabilities. An owner or admin sets it up before anyone can upload documents. Members can see whether a model is set up, but not its details.

## API keys

A Workspace API key lets scripts use the Workspace's templates, documents, and jobs. It's shown only once, when you generate or rotate it. Account, membership, invitation, and live-update features always need a normal browser sign-in. See [API keys](../api/authentication.md).
