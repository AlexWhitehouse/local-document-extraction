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

Each Workspace has its own model gateway URL, encrypted credential, and model roles. An owner or admin sets it up before anyone can upload documents. Members can see whether a model is set up, but not its details.

- **Extraction** reads document fields and runs Evaluations.
- **Document classification & splitting** chooses templates and identifies PDF document boundaries.
- **Template assistant** helps author templates and generates drafts from samples.

The latter two roles inherit Extraction unless you choose **Different model**. They share the gateway and credential but have their own Direct PDF input and Structured output settings. Test connection checks that each distinct model replies to text; it does not establish document support or provider image limits.

## Document processing

The **Document processing** section sits below **Model gateway**. Owners and admins can toggle **Enable smart splitting** and **Exclude blank pages**; changes save immediately and the app confirms them with a notification. Both start off, and blank exclusion is available only with splitting enabled. These settings apply to subsequent browser and API submissions; work already accepted keeps its captured settings.

Automatic template selection has no Workspace switch. It is requested by choosing tags instead of a template for an upload. See [Document extraction](document-extraction.md) for splitting, automatic selection, and last-resort review.

## API keys

A Workspace API key lets scripts use the Workspace's templates, documents, and jobs. It's shown only once, when you generate or rotate it. Account, membership, invitation, and live-update features always need a normal browser sign-in. See [API keys](../api/authentication.md).
