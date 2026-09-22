# Backend Context

The backend context covers durable product rules for authentication, workspace access, templates, document extraction, and background document processing. It defines business language used by API handlers, policies, and background processing.

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

**Local mail sink**:
A local-only delivery surface that captures transactional email content and links without sending real outbound email.
_Avoid_: outbound delivery, SMTP, email bypass

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

**Model gateway credential**:
The recoverable secret a **Workspace** supplies for the **Extraction processor** to authenticate outbound requests to its **Model gateway**.
_Avoid_: Workspace API key, application API key, global gateway key

**Model gateway connection test**:
A one-off owner/admin-requested probe of a draft **Workspace model configuration** that checks basic model invocation without certifying declared capabilities or changing configuration state.
_Avoid_: compatibility certification, health status, capability discovery

**Workspace deletion**:
The owner-only hard-erasure of a **Workspace**'s control access, authoritative **Workspace product data**, and residual **Source file** binaries; **Workspace product analytics** remains retained.
_Avoid_: soft delete, workspace archive, member departure

**Workspace control data**:
Durable access and identity records needed to locate and authorize a **Workspace**.
_Avoid_: global workspace data, aggregate workspace data

**Workspace product data**:
Workspace-owned extraction configuration and processing records created inside an **Accepted workspace context**.
_Avoid_: app data, tenant payload, aggregate data

**Workspace product data access**:
The admitted use of authoritative **Workspace product data** for the duration of one product operation, distinct from the **Workspace membership** that authorizes a user.
_Avoid_: workspace authorization, database access

**Workspace product analytics**:
Aggregate event data about **Workspace product data** usage that excludes customer content and identity data.
_Avoid_: product data projection, audit log, source of truth

**Local product analytics log**:
An append-only daily JSONL record of privacy-filtered **Workspace product analytics** under local runtime state.
_Avoid_: customer data archive, audit authority, document store

**Workspace live update**:
A realtime notification about changed **Workspace product data** for an accepted **Workspace context**.
_Avoid_: polling replacement for all data, durable event log, analytics event

**Local live update hub**:
The in-process WebSocket fanout service that delivers **Workspace live updates** for local Workspaces.
_Avoid_: durable event log, polling

**Workspace context invalidation**:
A freshness hint carried by **Workspace live updates** that tells a session browser its accepted **Workspace context** may need HTTP revalidation after product configuration or access state changes.
_Avoid_: context snapshot, durable event

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
_Avoid_: object-store record, file blob

**Source file page count**:
The detected number of pages in a PDF **Source file**.
_Avoid_: PDF page metadata, upload page count

**Product safety limit**:
A non-commercial guardrail that protects local document processing from unsupported or excessive input.
_Avoid_: commercial quota, account tier

**Extraction job**:
The durable processing record created when a **Document** is submitted with a **Template**.
_Avoid_: job, document, processing task

**Extraction job lifecycle**:
The durable state progression for an **Extraction job** from submission through background processing, result persistence, completion, failure, and **Source file** cleanup.
_Avoid_: job status helpers, queue state, processor flag

**Extraction processor**:
The background execution path that performs model extraction work for an **Extraction job**.
_Avoid_: job state owner, queue state machine

**Local extraction runner**:
The local background processor that claims, retries, and completes persisted **Extraction jobs** inside the Bun backend runtime.
_Avoid_: external worker, cron task

**Model gateway**:
The external model-routing service used by the **Extraction processor** to request field extraction from a model.
_Avoid_: AI gateway, provider endpoint, model API

**Workspace model configuration**:
The Workspace-owned extraction configuration that identifies the **Model gateway**, model, credential, and declared processing capabilities available to the **Extraction processor**.
_Avoid_: application model settings, profile model settings, global gateway configuration

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

**Template object column**:
A column inside a table-shaped **Template object schema**.
_Avoid_: nested field, table field, object field

**Template object column limit**:
The fixed local maximum of 20 **Template object columns** allowed in a table-shaped **Template field**.
_Avoid_: nested field limit, table array field limit, max table fields

## Rules

- **Account password policy** requires at least 8 characters, one ASCII uppercase letter, one ASCII number, and one special character.
- **Account email verification** is optional and disabled by default; `AUTH_REQUIRE_EMAIL_VERIFICATION=true` requires it before email/password access.
- A trusted social provider's verified email claim satisfies **Account email verification** without a separate Document Extraction verification email.
- Email/password login is enabled by default; Google OAuth is explicitly enabled with a complete credential pair. At least one login method must remain enabled.
- Deployment settings control new-account registration consistently for password and Google signup; existing accounts retain their configured sign-in path.
- **Account email verification** and password-reset mail use deployment-configured sender name/address, with a neutral local default.
- Email render modules receive the configured sender identity explicitly.
- The **Local mail sink** is the default transactional delivery surface; optional Cloudflare REST delivery sends actual account email.
- Local capture exposes action links to the machine operator; Cloudflare delivery does not duplicate those links into local capture.
- After successful **Account email verification**, users return to the application root.
- Successful **Account email verification** signs the user in automatically.
- When verification is required, signing in with an unverified email/password account sends a new **Account email verification** link instead of granting access.
- When verification is required, existing unverified email/password users are blocked on future sign-in; changing policy does not forcibly invalidate existing sessions.
- Existing unverified email/password users are not backfilled as verified by migration.
- **Account email verification** email is HTML formatted, includes a plain-text alternative, and tells unexpected recipients they can ignore it.
- **Account email verification** delivery attempts are awaited and bounded; delivery failure uses a sanitized error rather than exposing provider responses or credentials.
- **Account email verification** uses the **Local mail sink** by default; Cloudflare email is an opt-in REST transport, and generic SMTP is not implemented.
- **Account password reset** request responses do not reveal whether the submitted email belongs to an email/password Account.
- **Account password reset** links land on the SPA `/reset-password` experience with a Better Auth reset token or token error in the query string.
- **Account password reset** requires the same **Account password policy** as email/password sign-up.
- **Account password reset** links expire after one hour.
- **Account password reset** revokes existing sessions after the password changes.
- **Account password reset** email uses the same configured sender as account verification.
- **Account password reset** email is HTML formatted, includes a plain-text alternative, includes the reset link, and tells unexpected recipients they can ignore it.
- **Account password reset** delivery attempts are awaited and bounded; provider acceptance does not prove inbox delivery.
- Transactional email templates are code-owned render modules, with each email type in its own file.
- Auth-triggered transactional emails expose actionable links through local logs only when local capture is selected.
- **Application admin** authority is application-wide and is not granted by Workspace owner/admin membership.
- Local-only runtime does not remove authentication, **Workspace membership**, **Workspace invitations**, **Application admin** capability, or **Workspace API keys**.
- The local-only product keeps **Product safety limits** and Template shape constraints without commercial quota enforcement.
- **Product safety limits** include maximum **Source file** size, supported MIME types, and PDF **Source file page count** validation.
- **Product safety limits** are not tied to account tier or payment state.
- Each **Template** may contain at most one table-shaped **Template field**.
- A table-shaped **Template field** counts as one top-level **Template field**.
- A table-shaped **Template field** may contain no more than 20 **Template object columns**.
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
- A personal **Workspace** is created after configured authentication policy grants account access; when verification is required, an unverified registration does not create it.
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
- **Workspace API keys** require only accepted Workspace authorization in the local-only runtime.
- **Workspace API keys** do not authenticate user/session-only routes such as profile, workspace membership, invitations, workspace deletion, or API key generation.
- **Workspace API keys** do not create browser sessions or authenticate access to the SPA shell.
- **Workspace API key** material is visible only immediately after creation or rotation because the backend stores only a hash.
- **Workspace API key format** is opaque to users and clients beyond being passed as a bearer token.
- **Workspace API key** lookup is **Workspace control data** so external clients do not need to provide Workspace context before authentication.
- A **Model gateway credential** is encrypted at rest using a dedicated machine-local secret and is decrypted only for authorised outbound Model gateway processing.
- Full local-state backup and restoration preserve encrypted **Model gateway credentials** and their machine-local secret; Workspace exports and operational outputs omit credential material.
- **Workspace control data** includes account/session records, Workspace records, Workspace memberships, Workspace invitations, and Workspace API key lookup.
- **Workspace control data** and **Workspace product data** remain separate authority boundaries in the local-only runtime.
- **Workspace model configuration** is authoritative **Workspace product data**, not **Workspace control data** or application-wide configuration.
- An absent **Workspace model configuration** means the **Workspace** is unconfigured; blank Workspaces do not require placeholder configuration.
- **Workspace model configuration** is complete or absent; creating it requires a gateway, model, and **Model gateway credential**.
- Updating non-secret **Workspace model configuration** may preserve an existing credential, while credential replacement is explicit and atomic with the update.
- Replacing **Workspace model configuration** may omit the credential only while the stored **Model gateway credential** remains usable; an unreadable stored credential must be replaced with a newly supplied credential.
- Clearing **Workspace model configuration** removes the complete configuration rather than leaving partial gateway, model, or credential state.
- Clearing **Workspace model configuration** requires the current configured resource ETag; a concurrent change or prior clear fails the precondition instead of being treated as an idempotent success, and an already-unconfigured Workspace has no mutation ETag.
- **Workspace model configuration** mutations reject stale revisions rather than silently overwriting concurrent changes.
- New **Workspace model configuration** treats native PDF input and structured output as unsupported until explicitly declared; sequential Model gateway calls are opt-in, and Model gateway processing does not use managed-file upload.
- Workspace owners/admins may read non-secret **Workspace model configuration** details; ordinary members may read only whether configuration is present.
- Workspace owners/admins may distinguish a usable **Model gateway credential** from an unreadable one through non-secret credential status; ordinary members still see only whether **Workspace model configuration** is present.
- **Workspace model configuration** management requires an authenticated user session and accepted **Workspace membership**; **Workspace API keys** cannot read or mutate it.
- The Workspace model-configuration endpoint returns unauthorised for callers without a valid user session, including callers presenting only a **Workspace API key**; signed-in non-members and members attempting owner/admin mutations are forbidden.
- Saved **Model gateway credential** material is never returned through a product interface; replacing it requires a new credential value.
- An unreadable encrypted **Model gateway credential** is an internal configuration failure, not an absent **Workspace model configuration**; operations that require it fail while authorised replacement or clearing remains available.
- **Workspace model configuration** follows the backup, restoration, and hard-erasure boundary of its authoritative **Workspace product data**.
- **Workspace product data** includes Templates, Template fields and versions, Extraction jobs, Extraction results, and Source file metadata.
- **Workspace product data** includes Source file metadata, not Source file binary contents.
- Deleting a **Workspace** hard-erases its authoritative **Workspace product data** and associated **Source file** binary contents.
- **Workspace** deletion wins over in-flight **Extraction processing**; late background work must not recreate hard-erased **Workspace product data**.
- Cross-workspace summaries of **Workspace product data** are rebuildable read models, not the authority for workspace-scoped product APIs.
- Workspace-scoped product API responses must come from authoritative **Workspace product data**, not from cross-workspace projections.
- The first Workspace product data scale-out does not require automated migration of existing **Workspace product data**.
- The current scale model optimizes for many Workspaces across the application, not one Workspace with unbounded product data.
- Workspace limit configuration is limited to non-commercial **Product safety limits**.
- Template shape constraints that depend on counting **Template fields** or **Template object columns** are enforced against authoritative **Workspace product data**.
- Workspace membership and **Workspace API key** authorization are checked against **Workspace control data** before routing to authoritative **Workspace product data**.
- **Workspace product analytics** may include stable product identifiers such as Workspace ID, Template ID, and Extraction job ID when needed for aggregate usage analysis or operational debugging.
- **Workspace product analytics** must not include extracted answers, evidence text, Source file names, account emails, API keys, or Document contents.
- **Workspace product analytics** is not authoritative **Workspace product data** and is not part of Workspace deletion hard-erasure.
- **Workspace product analytics** emission is best-effort and must not fail the product action that produced the analytics event.
- The local-only runtime appends **Workspace product analytics** to one **Local product analytics log** per UTC day beneath local runtime state.
- A **Local product analytics log** is limited to whitelisted stable product IDs and operational metadata; it excludes extracted answers, evidence text, Source file names, account emails, API keys, Source file binary contents, and Document contents.
- **Workspace live updates** notify clients about **Extraction job lifecycle** changes after authoritative **Workspace product data** has been persisted.
- The local-only runtime delivers **Workspace live updates** through a **Local live update hub** keyed by Workspace ID.
- **Workspace live updates** cover all **Extraction job lifecycle** changes for the accepted **Workspace context**, not only the currently selected Extraction job.
- **Workspace context invalidation** events are freshness hints, not a source of computed Workspace state.
- **Workspace context invalidation** events carry a reason code and occurrence timestamp so clients can revalidate accepted **Workspace context** over HTTP.
- **Workspace live updates** are not durable history; clients revalidate authoritative **Workspace product data** and accepted **Workspace context** after reconnecting.
- The first **Workspace live update** capability is session-only for the SPA; Workspace API keys do not open live update connections.
- **Workspace live updates** use a versioned batch message envelope.
- **Extraction job lifecycle** live update events must not include extracted answers, evidence text, Source file binary contents, account emails, API keys, or Document contents.
- **Workspace context invalidation** live update events must not include account identity, API keys, extracted answers, evidence text, Source file binary contents, or Document contents.
- A committed Workspace model-configuration create, replacement, credential rotation, or clear emits **Workspace context invalidation** with reason `model_configuration_changed`; the event carries no configuration fields, and other open SPA clients refetch the authoritative Workspace product resource.
- Workspace model-configuration readiness is not duplicated into **Workspace control data** or Workspace-list responses; the initiating SPA client uses its mutation response while other clients refetch after invalidation.
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
- The background processor that processes submitted **Documents** should use **Document** or **Source file** terminology in application-owned code.
- Local Source file storage should use non-legacy **Document** or **Source file** naming for physical paths and application configuration.
- Local Source file storage remains the authoritative binary store for **Source files**.
- Local runtime state is grouped under one local state directory so reset and backup behavior is explicit.
- A **Source file page count** applies only to PDF **Source files** and is absent for non-PDF **Source files**.
- PDF **Source files** require a **Source file page count** at Document submission time; if the count cannot be determined, the Document submission is rejected.
- A **Source file page count** is internal Source file metadata until a product feature requires exposing or enforcing it.
- Existing **Source files** are not backfilled with a **Source file page count** because their original binary may already have been cleaned up.
- The product/API label is **Document Extraction**, not legacy Image Extraction.
- Background processor retry steps, not **Extraction job** status values, own retryability for transient processing failures.
- Do not model retryability with a durable `retryable_failed` **Extraction job** status.
- The durable **Extraction job lifecycle** states are `queued`, `processing`, `completed`, and `failed`.
- Authoritative **Extraction job lifecycle** state belongs to **Workspace product data**.
- The **Extraction processor** performs long-running extraction work but does not own authoritative **Extraction job lifecycle** state.
- Background processor instance details are implementation metadata, not durable **Extraction job lifecycle** states.
- The **Local extraction runner** scans authoritative **Workspace product data** on startup for resumable `queued` and stale `processing` **Extraction jobs**.
- A server restart must not permanently strand an accepted **Extraction job** that has not reached `completed` or `failed`.
- The **Local extraction runner** owns bounded retry attempts as processor metadata, not as additional **Extraction job lifecycle** states.
- Each **Extraction processor** attempt resolves the latest complete **Workspace model configuration** when that attempt starts; an in-flight attempt retains the configuration revision it already captured.
- **Extraction jobs** retain only the non-secret Workspace model configuration revision, model, and route used by their latest or final attempt, not permanent per-attempt configuration history or the **Model gateway credential**.
- Clearing **Workspace model configuration** is a deliberate stop for queued and retrying work: the next attempt fails deterministically as unconfigured, while already in-flight attempts continue with their captured configuration.
- An unreadable **Model gateway credential** fails accepted queued or retrying **Extraction jobs** deterministically as configuration unavailable; it is not a transient Model gateway retry.
- Changing **Workspace model configuration** does not reschedule queued retries, cancel in-flight attempts, or discard successful results; the next normally scheduled attempt resolves the latest configuration.
- The **Extraction processor** sends the original **Source file** to the **Model gateway** for extraction rather than creating a separate OCR or text-conversion artifact first.
- Completed **Extraction jobs** record a stable **Model gateway** route label for support/debugging rather than the full request URL.
- The configured LiteLLM endpoint remains the **Model gateway** in the local-only runtime.
- The **Extraction processor** uses the configured **Model gateway** as the single extraction route; transient gateway failures are retried by background processing rather than hidden behind a fallback provider.
- Deterministic Model gateway rejections fail an **Extraction job** terminally; throttling, timeouts, network failures, and gateway service failures use the bounded durable retry policy.
- Missing or unreadable **Workspace model configuration** does not consume the Model gateway retry budget.
- A persisted queued **Extraction job** notifies the local runner asynchronously, so Document acceptance is not delayed by Model gateway processing.
- After the **Extraction processor** receives a **Model gateway** response, **Extraction results** should be persisted and the **Extraction job** should be marked `completed`.
- A completed **Extraction job** should not retain its **Source file** binary after processing cleanup succeeds.
- **Document** admission checks **Workspace model configuration** readiness immediately after Workspace authorisation and before parsing the request body, persisting a **Source file**, or creating an **Extraction job**.
- Workspace model-configuration HTTP errors use the product error envelope without echoing credential material: invalid representations are `400 invalid_workspace_model_configuration`, missing mutation preconditions are `428 precondition_required`, and failed or stale preconditions are `412 precondition_failed`.
- Workspace model-configuration responses use `Cache-Control: no-store`; only a configured owner/admin representation exposes an ETag, and that ETag is a mutation concurrency token rather than a conditional-read cache validator.
- **Document** admission rejects an absent **Workspace model configuration** as `409 workspace_model_not_configured` and an unreadable **Model gateway credential** as `503 workspace_model_configuration_unavailable`; configuration-unavailable responses do not advertise automatic retry timing because owner/admin repair is required.
- Multipart **Document** admission streams a bounded `document` part to temporary local storage, validates required metadata and PDF page count, then atomically promotes the **Source file** before the **Extraction job** is accepted.
- Admission count, reserved bytes, process memory, and disk reserve are local capacity limits; shared pressure returns retry guidance without creating an **Extraction job**.
- If local **Workspace product data** rejects a queued **Extraction job** after its **Source file** is written, the local Source file binary is deleted.
- If queuing an **Extraction processor** fails during Document submission, the **Extraction job** is marked `failed` and its **Source file** follows the failed-source retention window.
- A processing failure marks the **Extraction job** `failed` with durable error details and retains its **Source file** for recovery or inspection for seven days by default.
- Configuration-related terminal processing failures follow the same failed **Source file** retention policy as other processing failures.
- Completed **Source files** are deleted immediately; a restart-safe sweep also removes interrupted completed cleanup and expired failed-source binaries without deleting retained job metadata, errors, or results.
- The in-memory extraction queue is a bounded, Workspace-fair metadata accelerator over authoritative queued **Workspace product data**; periodic reconciliation recovers work left only in SQLite.
- Individual **Extraction job** retrieval uses entity validators and server-directed retry timing so unchanged polls do not hydrate or serialize **Extraction results**.
- Each active **Workspace product data** database has one lease-aware process owner; SQLite write transactions remain short and journal mode stays on the safe rollback journal until the bundled SQLite passes the WAL safety gate.
- **Workspace** deletion cleanup sweeps residual **Source files** that normal **Extraction job lifecycle** cleanup did not delete.
- A **Template** must have at least one **Template field** before it can be used for extraction.
- Changing **Template fields** creates a new **Template version**.
- An **Extraction job** is interpreted against the **Template version** selected at submission time.
- An **Extraction result** may include confidence and evidence when requested.
- Authoritative **Template** existence, status, current version, field count, version creation, and deletion checks belong to **Workspace product data**.

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
- **Workspace control data** identifies which **Workspace product data** a user or **Workspace API key** may access.
- **Workspace product data** belongs to exactly one **Workspace**.
- A **Workspace model configuration** belongs to exactly one **Workspace**.
- A deleted **Workspace** has no remaining authoritative **Workspace product data**.
- In-flight **Extraction processing** for a deleted **Workspace** may finish externally, but it has no **Extraction job lifecycle** state to update after hard-erasure.
- A **Document** has exactly one **Source file** at submission time.
- A **Document** submitted with a **Template** creates one **Extraction job**.
- An **Extraction job lifecycle** is coordinated by authoritative **Workspace product data** and executed by an **Extraction processor** after the **Extraction job** is queued.
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
