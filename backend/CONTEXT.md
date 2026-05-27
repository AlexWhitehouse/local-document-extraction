# Backend Context

The backend context covers durable product rules for authentication, workspace access, templates, document extraction, and background image processing. It defines business language used by API handlers, policies, and worker processing.

## Language

**Account password policy**:
The minimum strength rule for email/password account credentials.
_Avoid_: password validation, sign-up password rule

**Account email verification**:
Proof that a user controls the email address used for application access.
_Avoid_: email confirmation, verified user

**Account password reset**:
A self-service flow where someone who knows an account email can request a link and set a new password for an email/password Account.
_Avoid_: forgot password, password recovery, Workspace password reset

**Application admin**:
A user with application-wide account management authority, separate from any workspace-scoped role.
_Avoid_: workspace admin, owner, support user

**Workspace**:
An environment a user can access only after they have a workspace membership.
_Avoid_: group, account, tenant

**Workspace membership**:
Accepted access that makes a user a member of a **Workspace** with a role.
_Avoid_: user status, workspace user row

**Workspace policy**:
The rules that decide what a workspace member may do inside a **Workspace**.
_Avoid_: role checks, permission helpers

**Workspace context**:
The currently selected accepted **Workspace** or pending **Workspace invitation** that determines what the user can see and do.
_Avoid_: selected workspace, active workspace state

**Accepted workspace context**:
A **Workspace context** backed by **Workspace membership** that enables workspace API access when the user has a session or workspace API key.
_Avoid_: connected workspace, unlocked workspace

**Pending workspace invitation context**:
A **Workspace context** backed by a pending **Workspace invitation** that shows invitation details and actions but does not enable workspace API access.
_Avoid_: pending workspace, disabled workspace

**Workspace invitation**:
A pending offer for an email address to join a **Workspace**.
_Avoid_: invite, invited workspace, pending member

**Workspace invitation management**:
The owner/admin view of actionable pending **Workspace invitations** sent from a **Workspace**.
_Avoid_: invitation history, invite audit log

**Workspace invitation summary**:
The displayed details for a pending **Workspace invitation**, including workspace, invited email, offered role, pending status, inviter identity, invited time, and expiry.
_Avoid_: invitation row, invite card

**Workspace member action**:
An action that changes a member's workspace access or role.
_Avoid_: user status change, member edit

**Workspace API key**:
A workspace-scoped credential for external API clients to access workspace-scoped product routes.
_Avoid_: frontend session key, user token

**Workspace API key format**:
The opaque generated string format for **Workspace API keys**.
_Avoid_: user-facing key schema, guaranteed key length

**Leave Workspace**:
A self-service action where a non-owner workspace member removes only their own **Workspace membership**.
_Avoid_: exit group, delete access

**Replacement personal Workspace**:
A newly created personal **Workspace** that preserves the expectation that a user has at least one accepted **Workspace** after **Leave Workspace**.
_Avoid_: fallback workspace, default workspace

**Document**:
A user-provided file submitted for extraction.
_Avoid_: image, upload, input file

**Source file**:
The original uploaded binary for a **Document**.
_Avoid_: image object, R2 object, file blob

**Extraction job**:
The durable processing record created when a **Document** is submitted with a **Template**.
_Avoid_: job, document, processing task

**Extraction job lifecycle**:
The durable state progression for an **Extraction job** from submission through Cloudflare Workflow processing, result persistence, completion, failure, and **Source file** cleanup.
_Avoid_: job status helpers, queue state, workflow flag

**Extraction result**:
The completed output value for a **Template field** in an **Extraction job**.
_Avoid_: answer row, model response, result item

**Template**:
A reusable extraction schema selected when submitting **Documents**.
_Avoid_: form, prompt, extraction config

**Template field**:
An individual answer definition inside a **Template**.
_Avoid_: field row, extraction key, output column

**Template version**:
A specific revision of a **Template** used to interpret **Extraction job** results.
_Avoid_: current template, schema snapshot

**Template object schema**:
The table-shaped definition for an object-like **Template field**.
_Avoid_: object marker parsing, nested field table

## Rules

- **Account password policy** requires at least 8 characters, one ASCII uppercase letter, one ASCII number, and one special character.
- **Account email verification** is required before an email/password user may access the application.
- A trusted social provider's verified email claim satisfies **Account email verification** without a separate Document Extraction verification email.
- **Account email verification** email is sent from `Document Extraction <no-reply@extract.t3m.uk>`.
- Reusable outbound email sending requires callers to provide the sender identity rather than reading a global sender from configuration.
- The Worker email sending binding is named `EMAIL` and is shared by transactional email flows.
- Local development uses the real Cloudflare Email Sending service for **Account email verification**, not a verification bypass.
- After successful **Account email verification**, users return to the application root.
- Successful **Account email verification** signs the user in automatically.
- Signing in with an unverified email/password account sends a new **Account email verification** link instead of granting access.
- Existing unverified email/password users are blocked on future sign-in, but this slice does not forcibly invalidate existing sessions.
- Existing unverified email/password users are not backfilled as verified by migration.
- **Account email verification** email is HTML formatted, includes a plain-text alternative, and tells unexpected recipients they can ignore it.
- **Account email verification** sending is scheduled without blocking sign-up or sign-in responses.
- **Account email verification** uses direct Cloudflare Email Sending for this slice; a durable email queue is deferred until retry, audit, or provider-switching needs justify it.
- **Account password reset** request responses do not reveal whether the submitted email belongs to an email/password Account.
- **Account password reset** links land on the SPA `/reset-password` experience with a Better Auth reset token or token error in the query string.
- **Account password reset** requires the same **Account password policy** as email/password sign-up.
- **Account password reset** links expire after one hour.
- **Account password reset** revokes existing sessions after the password changes.
- **Account password reset** email is sent from `Document Extraction <no-reply@extract.t3m.uk>`.
- **Account password reset** email is HTML formatted, includes a plain-text alternative, includes the reset link, and tells unexpected recipients they can ignore it.
- **Account password reset** sending is scheduled without blocking request responses.
- Transactional email templates are code-owned render modules, with each email type in its own file.
- Auth-triggered transactional emails use Worker `waitUntil` when the request path can send email; session-read paths do not require scheduling context.
- **Application admin** authority is application-wide and is not granted by Workspace owner/admin membership.
- Initial **Application admin** access is bootstrapped by a one-time migration that promotes known Better Auth users to the persisted Application admin role.
- **Application admin page** visibility is based on persisted application role in the authenticated session.
- Better Auth application role is single-valued: a user is either `user` or `admin` in the application-wide auth context.
- Better Auth admin plugin account fields are added through an explicit forward migration, including a safe one-time promotion of known bootstrap users when those users exist.
- Better Auth's persisted application role field remains unconstrained in the database; single-role `user`/`admin` semantics are enforced by application behavior.
- Better Auth synthetic user responses include admin plugin fields so email-verification flows do not expose a different user shape from real account records.
- The first **Application admin** capability set includes listing users, searching users, changing application roles, banning/unbanning users with reasons, and impersonating non-admin users.
- The first **Application admin** capability set does not include deleting users, creating users, setting passwords, or manually revoking sessions.
- The first **Application admin** capability set does not include editing user names or account email addresses.
- The first **Application admin** capability set does not include Workspace membership summaries or Workspace data management.
- The first **Application admin** capability set uses Better Auth admin utilities directly rather than custom product `/v1/admin/*` routes.
- The first **Application admin** capability set does not introduce custom audit logging for admin actions.
- Better Auth admin endpoints are served by the existing `/api/auth/*` Better Auth handler delegation, not custom product routing.
- Backend coverage for **Application admin** setup verifies Better Auth admin plugin configuration rather than Better Auth endpoint internals.
- **Application admins** may impersonate regular users, but may not impersonate other **Application admins**.
- Banning a user through **Application admin** account management blocks that user's account sessions and future sign-in, but does not automatically delete Workspace memberships or rotate Workspace API keys.
- The first **Application admin** ban flow creates permanent bans with required reasons; temporary ban duration is not exposed.
- **Application admin** role changes require confirmation, with stronger confirmation language when removing Application admin authority.
- An **Application admin** cannot demote their own application role in the first admin capability set.
- An **Application admin** cannot ban their own account in the first admin capability set.
- An **Application admin** may ban another Application admin with explicit confirmation.
- Unbanning a user through **Application admin** account management requires confirmation that shows the user's email and existing ban reason.
- **Application admin** role changes do not trigger custom session invalidation in the first admin capability set.
- Starting impersonation requires confirmation that identifies the target user.
- An **Application admin** cannot impersonate their own account.
- Banned users are not eligible impersonation targets until unbanned.
- Banned users receive Better Auth's default banned-user sign-in message.
- A personal **Workspace** is created only after **Account email verification** gives the user account access, not when an unverified email/password account is first registered.
- Personal **Workspace** creation after **Account email verification** is idempotent; users who already have accepted **Workspace membership** do not receive another personal **Workspace**.
- Pending **Workspace invitations** do not suppress personal **Workspace** creation after **Account email verification**.
- A **Workspace invitation** is not workspace access until accepted.
- **Workspace invitations** are in-app invitations; outbound email is outside the current invitation lifecycle.
- Use `cancelled` for a **Workspace invitation** that ended without acceptance, including when the invitee declines it.
- Invitee decline and owner/admin cancellation are separate actions with different authorization paths, but both make the invitation `cancelled`.
- Only workspace owners and admins may see or cancel pending **Workspace invitations** sent from a **Workspace**.
- A workspace owner/admin should confirm before cancelling someone else's pending **Workspace invitation**.
- A **Workspace invitation** remains valid after inviter role changes or inviter departure unless it is cancelled or expires.
- Deleting a **Workspace** deletes its **Workspace invitations**.
- **Workspace invitation management** shows actionable pending invitations, not accepted, cancelled, or expired invitation history.
- Invitees should see inviter identity, offered role, invited email, invited time, and expiry before accepting a **Workspace invitation**.
- Only actionable pending **Workspace invitations** should appear in an invitee's workspace list; expired invitations are hidden from that list.
- Invitees accept or decline a **Workspace invitation** from the invitation detail view, not directly from the workspace list.
- Invitees do not need a confirmation prompt when declining their own **Workspace invitation**.
- A current workspace member should not also have a pending **Workspace invitation** for the same **Workspace**.
- Accepting a **Workspace invitation** must not overwrite an existing **Workspace membership** or change its role.
- **Workspace invitations** match the invitee by the account's current email address; account email is not user-editable.
- A signed-in user must always have at least one accepted **Workspace** after sign-up or first login.
- A user cannot delete their only accepted **Workspace**.
- If the accepted **Workspace** invariant is broken, the backend owns repairing it; clients must not create a replacement through the normal user-facing create-workspace flow.
- `GET /v1/workspaces` repairs a broken zero-accepted-Workspace invariant by creating a personal **Workspace** through the same bootstrap path used for first login.
- Pending **Workspace invitations** do not satisfy the accepted **Workspace** invariant.
- A workspace owner/admin may remove another user's **Workspace membership** even if that was the target user's last accepted **Workspace**; the target user's invariant is repaired when they next list their Workspaces.
- Removing another user's **Workspace membership** does not immediately create that user's replacement personal **Workspace**.
- Accepted **Workspace** IDs are backend-owned; clients must not invent default or fallback workspace IDs.
- When a client needs a replacement accepted **Workspace context**, it should use the first accepted **Workspace** returned by the backend workspace list.
- The SPA uses the signed-in user session plus accepted **Workspace context** for workspace-scoped requests; **Workspace API keys** are for external API clients.
- **Workspace API keys** may be generated and shown to workspace owners/admins for external clients, but they are not SPA authentication credentials.
- **Workspace API keys** authenticate external clients for workspace-scoped product routes such as templates, extraction jobs, and document submission.
- **Workspace API keys** currently have the same access as accepted Workspace context on workspace-scoped product routes.
- **Workspace API keys** do not authenticate user/session-only routes such as profile, workspace membership, invitations, workspace deletion, or API key generation.
- **Workspace API keys** do not create browser sessions or authenticate access to the SPA shell.
- **Workspace API key** material is visible only immediately after creation or rotation because the backend stores only a hash.
- **Workspace API key format** is opaque to users and clients beyond being passed as a bearer token.
- Creating a **Workspace** and generating a **Workspace API key** are separate user intents.
- `POST /v1/workspaces` returns the new accepted **Workspace context** with `has_api_key: false` and no **Workspace API key** secret.
- First-login Workspace bootstrap creates the accepted **Workspace** and starter template, not visible external-client **Workspace API key** material.
- A new or bootstrapped **Workspace** starts without an external-client **Workspace API key** until an owner/admin explicitly generates one.
- Existing silently generated workspace key hashes are treated as not being external-client **Workspace API keys** during migration.
- Workspace listing or detail responses may expose whether a **Workspace API key** exists, but never expose existing key material.
- `/v1/workspaces` includes whether each accepted **Workspace** has an external-client **Workspace API key**.
- `POST /v1/workspaces/:id/api-key` issues a new one-time **Workspace API key** secret and replaces any existing key hash.
- `POST /v1/workspaces/:id/api-key` returns the one-time **Workspace API key** secret and `has_api_key: true`.
- Workspace owners/admins may generate or rotate **Workspace API keys**; members may not.
- **Leave Workspace** does not delete the **Workspace**, its documents, invitations, API key, or other members.
- **Leave Workspace** is performed by a signed-in workspace member, not by a workspace API key.
- Workspace owners delete workspaces rather than leave them.
- If **Leave Workspace** would remove a user's last accepted **Workspace**, create a **Replacement personal Workspace** for that user.
- A **Replacement personal Workspace** uses the same starter-template bootstrap as a new-user workspace.
- A **Replacement personal Workspace** response includes `has_api_key: false` and no **Workspace API key** secret.
- After **Leave Workspace**, the user moves into another accepted **Workspace context**, preferring the **Replacement personal Workspace** when one was created.
- A workspace member should confirm before leaving a **Workspace**.
- **Template object schema** defines expected columns, column order, data types, and extraction guidance for fields whose data type is `object` or `array<object>`.
- **Template object schema** should be normalized, validated, encoded for model guidance, decoded for editing, and rendered through one domain module.
- **Template fields** are always requested during extraction; the public Template contract does not distinguish required and optional fields.
- A **Source file** may be an image or PDF, but the product term for the submitted item is **Document**.
- Document submission must use the `document` multipart field; legacy `image` and generic `file` submission fields are not accepted or advertised.
- Application-owned configuration, storage binding, and database names should use **Document** or **Source file** terminology rather than legacy `image` terminology.
- Persisted extraction job source metadata should be named with **Source file** terminology and should not expose legacy `image` API response aliases.
- Historical migration files remain immutable; legacy `image` schema names should be removed through forward migrations only.
- Standard MIME types, generated files, and required platform API vocabulary may retain `image` where that word is part of the external standard or platform contract.
- Use **Document** synonymously for supported source formats, including PNG, JPEG, WebP, and PDF, unless a standards-level MIME type must be named.
- The background workflow that processes submitted **Documents** should be named `documentProcessingWorkflow` in application-owned code.
- R2 storage for **Source files** should use non-legacy **Document** or **Source file** naming for both Worker bindings and physical bucket names.
- The product/API label is **Document Extraction**, not legacy Image Extraction.
- Cloudflare Workflow retry steps, not **Extraction job** status values, own retryability for transient processing failures.
- Do not model retryability with a durable `retryable_failed` **Extraction job** status.
- The durable **Extraction job lifecycle** states are `queued`, `processing`, `completed`, and `failed`.
- Cloudflare Workflow instance details are implementation metadata, not durable **Extraction job lifecycle** states.
- After Cloudflare Workflow receives an AI gateway response, **Extraction results** should be persisted and the **Extraction job** should be marked `completed`.
- A **Template** must have at least one **Template field** before it can be used for extraction.
- Changing **Template fields** creates a new **Template version**.
- An **Extraction job** is interpreted against the **Template version** selected at submission time.
- An **Extraction result** may include confidence and evidence when requested.

## Relationships

- A **Workspace invitation** may be displayed beside **Workspaces**, but it does not create **Workspace membership** until accepted.
- Accepted **Workspaces** appear before invited workspace entries; invited entries are ordered by latest update first.
- Current workspace members and pending **Workspace invitations** are separate access-management lists.
- Accepting a **Workspace invitation** creates **Workspace membership** and moves the user into **Accepted workspace context**.
- Declining a **Workspace invitation** makes it non-actionable and removes it from the invitee's workspace list.
- A **Workspace member action** may remove a member, make a member an admin, or transfer workspace ownership to a member.
- **Leave Workspace** removes a non-owner member's **Workspace membership** without deleting the **Workspace**.
- **Leave Workspace** creates a **Replacement personal Workspace** when it removes the user's last accepted **Workspace**.
- A **Pending workspace invitation context** is locked until the **Workspace invitation** is accepted or declined.
- A **Document** has exactly one **Source file** at submission time.
- A **Document** submitted with a **Template** creates one **Extraction job**.
- An **Extraction job lifecycle** is driven by Cloudflare Workflow after the **Extraction job** is queued.
- A **Template** has one or more **Template fields**.
- A **Template** has one or more **Template versions**.
- A **Template field** may have a **Template object schema** when its data type is `object` or `array<object>`.
- An **Extraction job** belongs to exactly one **Template version**.
- A completed **Extraction job** has one **Extraction result** per extracted **Template field**.

## Example Dialogue

> **Dev:** "If a user selects an invited workspace, can we treat it as the active workspace for API calls?"
> **Domain expert:** "No. It is a **Pending workspace invitation context** until accepted, so it can show invitation details but must not enable workspace API access."

## Flagged Ambiguities

- "group" was used to describe what a user leaves; resolved: the domain term is **Workspace**, and access is represented by **Workspace membership**.
- "user status" was used for workspace access management; resolved: the domain term is **Workspace member action**.
- "workspace state" can mean backend access, local persistence, or UI presentation; resolved: use **Workspace context** for backend access context and **Workspace selection view** for the frontend UI concept.
- Legacy `image` terminology was used for earlier document submission, but the resolved product term is **Document** because source files can include PDFs as well as images; use **Source file** when referring to the original submitted binary.
