# Plans

Plans are Workspace-level entitlements. They are not assigned to individual users. Every Template, Document submission, Workspace API key, member invitation, and billing action is evaluated against the active entitlement for the current Workspace.

## How Plans Attach To Workspaces

Each Workspace has one active entitlement at a time. That entitlement can come from:

- The default Free plan.
- A Pro or Max self-service subscription.
- A scheduled subscription change.
- A support-managed plan adjustment.

Workspace role still matters. Owners can manage billing, owners and admins can manage API keys and member invitations, and members can use product features allowed by Workspace policy and plan limits.

## What Plans Control

The active Workspace plan controls:

- Whether Workspace API key access is available.
- How many Templates the Workspace can keep active.
- How many top-level fields a Template can contain.
- Whether table-shaped fields are allowed and how many columns they can have.
- How many accepted Workspace members are allowed.
- How many billable Document pages can be submitted in the billing period.
- How many included Credits are granted by the plan.
- Whether Credit packs or subscription billing apply.

The app may disable actions before you reach a limit. Final enforcement happens when you create Templates, invite members, rotate API keys, or submit Documents.

## Plan Benefits

| Plan Type | Best For | Key Benefits |
| --- | --- | --- |
| Free | Trying the product with a small team and low-volume Documents. | No monthly subscription, basic Workspace collaboration, basic Template creation, and enough monthly page capacity to evaluate extraction quality. |
| Pro | Operational teams starting to automate Document workflows. | API access, 200 included Credits, larger Template capacity, more fields, more members, higher monthly page capacity, and lower Credit pack per-page price than Free. |
| Max | Higher-volume teams with broader Template and collaboration needs. | API access, 1000 included Credits, up to 50 Templates, more fields and table columns, unlimited members, higher monthly page capacity, and the lowest self-service Credit pack per-page price. |

## Self-Service Plans

Free, Pro, and Max are the normal self-service plans.

- Free is the default entitlement when no paid subscription or support-managed adjustment is active.
- Pro and Max are paid subscriptions managed by the Workspace owner.
- Pro and Max include API access; Free does not.
- Pro and Max grant included Credits each billing period.
- Credit packs are available to Free, Pro, and Max Workspaces.

Owners can start Checkout for Pro or Max, upgrade from Pro to Max, or manage subscription cancellation.

## Billing State And Blocked Actions

When billing or plan state blocks product usage, the Workspace exposes a billing operational status. Non-owner members may see limited status badges or blocking reasons, but they do not see invoices, payment controls, or owner-only billing details.

Typical blocked actions include:

- Submitting a Document without enough Credits.
- Submitting after monthly page capacity is exhausted.
- Creating Templates beyond the plan limit.
- Inviting members beyond the plan member limit.
- Using a Workspace API key when the active plan does not include API access.

See [Plans And Limits](../reference/plans-and-limits.md) for the numeric limits.
