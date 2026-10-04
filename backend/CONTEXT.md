# Backend Context

This context defines durable rules for authentication, Workspace access, templates, extraction, and background document processing. Use its domain terms in handlers, policies, and background processing.

## Language

**Account password policy**:
The minimum strength rule for email/password account credentials.
_Avoid_: password validation, sign-up password rule

**Account email verification**:
Proof that a user controls the email address used for application access.
_Avoid_: email confirmation, verified user

**Account password reset**:
A self-service procedure to reset an email/password Account password. A person who knows the account email can request a reset link.
_Avoid_: forgot password, password recovery, Workspace password reset

**Local mail sink**:
Local storage for transactional email content and action links. It does not send outbound email.
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
The accepted **Workspace** or pending **Workspace invitation** currently selected by the user. It determines available content and actions.
_Avoid_: selected workspace, active workspace state

**Accepted workspace context**:
A **Workspace context** with accepted **Workspace membership**. A valid session or Workspace API key permits access to its product data.
_Avoid_: connected workspace, unlocked workspace

**Pending workspace invitation context**:
A **Workspace context** based on a pending **Workspace invitation**. It permits invitation details and actions, without access to Workspace product data.
_Avoid_: pending workspace, disabled workspace

**Workspace invitation**:
A pending offer for an email address to join a **Workspace**.
_Avoid_: invite, invited workspace, pending member

**Workspace invitation management**:
The owner/admin view of actionable pending **Workspace invitations** sent from a **Workspace**.
_Avoid_: invitation history, invite audit log

**Workspace invitation summary**:
The details of a pending **Workspace invitation**. These include Workspace, invited email, role, status, inviter, invitation time, and expiry.
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
The recoverable secret a **Workspace** supplies to authenticate outbound extraction and **Template generation** requests to its **Model gateway**.
_Avoid_: Workspace API key, application API key, global gateway key

**Model gateway connection test**:
An owner/admin test of draft **Workspace model configuration**. It verifies basic model invocation without certifying capabilities or changing saved settings.
_Avoid_: compatibility certification, health status, capability discovery

**Workspace deletion**:
Owner-only permanent deletion of **Workspace** access, authoritative **Workspace product data**, and remaining **Source file** binaries. **Workspace product analytics** remains retained.
_Avoid_: soft delete, workspace archive, member departure

**Workspace control data**:
Durable access and identity records needed to locate and authorize a **Workspace**.
_Avoid_: global workspace data, aggregate workspace data

**Workspace product data**:
Workspace-owned extraction configuration and processing records created inside an **Accepted workspace context**.
_Avoid_: app data, tenant payload, aggregate data

**Workspace product data access**:
Admitted access to authoritative **Workspace product data** for one operation. **Workspace membership** separately determines user authorization.
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
A **Workspace live update** hint that product settings or access changed. It tells the browser to revalidate accepted **Workspace context** over HTTP.
_Avoid_: context snapshot, durable event

**Leave Workspace**:
A self-service action where a non-owner workspace member removes only their own **Workspace membership**.
_Avoid_: exit group, delete access

**Replacement personal Workspace**:
A personal **Workspace** created when **Leave Workspace** removes the user’s last accepted **Workspace**. It preserves the requirement for accepted Workspace access.
_Avoid_: fallback workspace, default workspace

**Document**:
A logical item submitted for extraction, either directly or as a page group within a **Document packet**.
_Avoid_: image, upload, input file

**Source file**:
The binary input owned by a **Document** or **Document packet**. A split child owns a **Derived Source file** containing only its assigned pages.
_Avoid_: object-store record, file blob

**Document packet**:
An uploaded PDF assessed for logical document boundaries under the Workspace's **Smart splitting** policy. It owns the original Source file, selected original pages, split plan, and related child Documents.
_Avoid_: parent extraction result, batch upload, combined result

**Split plan**:
The division of a Document packet's selected physical pages into logical Documents and explicit exclusions. Once accepted, the page groups and child identities remain fixed.
_Avoid_: template selection, page reorder, extraction result

**Derived Source file**:
An independent PDF containing exactly one child Document's assigned pages, with their original physical page references retained separately.
_Avoid_: parent original, shared working file

**Smart splitting**:
Identification of logical Documents within selected PDF pages, controlled by the Workspace. Human review occurs only when automatic resolution cannot produce a valid plan.
_Avoid_: split every page, template classification

**Automatic template selection**:
Selection of a suitable existing Template from those matching any supplied Template tag. The model uses the logical Document and candidate names and descriptions.
_Avoid_: template generation, global template search, field extraction

**Template binding**:
The fixed Template and Template version used for an Extraction job. Explicit selection binds at submission; automatic or manual resolution binds before extraction.
_Avoid_: current template, mutable extraction schema

**Source file retention**:
Keeping a **Source file** beyond temporary processing needs so it remains available through its **Extraction job** or **Document packet**.
_Avoid_: processing storage, result retention

**Workspace source retention**:
A **Workspace** choice to inherit installation **Source file retention** or disable it. Available storage depends on operator configuration.
_Avoid_: Workspace storage provider, Workspace bucket configuration

**Source file page count**:
The detected number of pages in a PDF **Source file**.
_Avoid_: PDF page metadata, upload page count

**Product safety limit**:
A non-commercial guardrail that protects local document processing from unsupported or excessive input.
_Avoid_: commercial quota, account tier

**Extraction job**:
The durable processing record for one logical **Document**, with a **Template binding** resolved before field extraction.
_Avoid_: job, document, processing task

**Extraction job lifecycle**:
The durable states of an **Extraction job** from submission through processing, result storage, completion or failure, and **Source file** cleanup.
_Avoid_: job status helpers, queue state, processor flag

**Extraction processor**:
The background execution path that performs model extraction work for an **Extraction job**.
_Avoid_: job state owner, queue state machine

**Local extraction runner**:
The local background processor that claims, retries, and completes persisted **Extraction jobs** inside the Bun backend runtime.
_Avoid_: external worker, cron task

**Model gateway**:
The external model-routing service used for field extraction, Template authoring, document classification, and Smart splitting.
_Avoid_: AI gateway, provider endpoint, model API

**Workspace model configuration**:
The Workspace-owned gateway, credential, model roles, and declared processing capabilities for Extraction, Template assistant, and Document classification & splitting.
_Avoid_: application model settings, profile model settings, global gateway configuration

**Extraction result**:
The completed output value for a **Template field** in an **Extraction job**.
_Avoid_: answer row, model response, result item

**Template**:
A reusable extraction schema selected explicitly or through **Automatic template selection** for a **Document**.
_Avoid_: form, prompt, extraction config

**Template tag**:
A user-defined, lowercase label shared within a **Workspace**, associated with zero or more **Templates**. It is current Template metadata, independent of **Template versions**.
_Avoid_: field tag, extraction instruction, automatic selection rule

**Template generation**:
A model proposal for a complete, valid **Template** from a **Template sample** and optional instructions. The user reviews it before saving.
_Avoid_: extraction job, automatic template save

**Template sample**:
A temporary user-provided file used to infer a reusable **Template**, without becoming a **Document** submitted for extraction.
_Avoid_: extraction job source, retained document

**Template assistance**:
A model request to explain a captured **Template** draft or propose focused edits. Optional binary evidence is one **Template sample** or an explicitly selected retained **Source file**. Evidence can also include one completed **Extraction job**, with its historical **Template version** and results. Assistance neither saves a Template nor creates an Extraction job.
_Avoid_: automatic template repair, verified answer, persistent assistant conversation

**Template change group**:
An indivisible group of draft edits with reasons and dependencies. Applying groups requires a valid combined draft and the exact captured editor context. Saving is a separate action.
_Avoid_: saved Template version, whole-template replacement

**Template field**:
An individual answer definition inside a **Template**.
_Avoid_: field row, extraction key, output column

**Template version**:
A specific revision of a **Template** used to interpret **Extraction job** results.
_Avoid_: current template, schema snapshot

**Evaluation**:
A temporary comparison of extraction outputs for one Document in the browser. Optional verified Expected answers provide scoring references. The product area is **Evaluations**.
_Avoid_: experiment, saved evaluation, benchmark history, model connection test

**Batch Evaluation**:
A temporary comparison of extraction outputs across multiple documents using the same **Comparison candidates**, with per-document results.
_Avoid_: saved batch run, benchmark history, independent candidate sets per document

**Evaluation document library**:
A Workspace-shared collection of saved documents and user-verified **Expected answers** for reuse in future **Evaluations** and **Batch Evaluations**.
_Avoid_: saved Evaluation history, personal document library, model-generated ground truth

**Saved Evaluation document**:
A reusable **Evaluation document library** entry with a fixed original **Source file** and one editable **Expected answer set**. Its ownership is independent of ordinary **Extraction jobs**.
_Avoid_: saved Evaluation run, Extraction job, temporary Evaluation upload

**Expected answer set**:
Reference field definitions and verified **Expected answers** for one saved library document. The set includes expected-table structure and matching rules. It can be incomplete or contain no verified answers. Compatible **Templates** can reuse it; it does not belong to one **Template version**.
_Avoid_: candidate output, Template-owned answer sheet, saved Evaluation results

**Expected answer**:
A verified reference value or explicit verified absence for a document field. The user enters it manually or accepts it after reviewing candidate output. It supplies a scoring reference for **Evaluations** and can persist in an **Expected answer set**. Fields without Expected answers remain unscored.
_Avoid_: model confidence, majority answer, automatically accepted ground truth

**Expected table**:
A verified reference table for an **Evaluation**, with expected rows and cell values or explicit absence. Ignored cells do not contribute to table-cell accuracy. Absent cells require empty output cells in existing rows. Row identifiers still require values. The table defines cell matching and missing or extra row detection.
_Avoid_: unverified candidate table, partial table reference

**Evaluation coverage**:
The proportion of verified fields requested by a candidate Template, determined through field alignment. Coverage measures requested scope separately from matches against **Expected answers**.
_Avoid_: extraction accuracy, model confidence, match rate

**Comparison candidate**:
One model and Template definition evaluated together within an **Evaluation**.
_Avoid_: comparison stream, comparison lane

**Model comparison**:
An **Evaluation** that compares model names through one Model gateway. All **Comparison candidates** share one Template definition.
_Avoid_: gateway comparison, model marketplace

**Template comparison**:
An **Evaluation** that compares independently editable Templates through one model. **Comparison candidates** can use saved Templates, Template versions, or unsaved drafts.
_Avoid_: model comparison, live Template edit

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

- **Application admin** permissions cover user listing, permitted role changes, bans, unbans, and impersonation start/stop. They exclude generic account deletion, account updates, password overrides, and session administration.
- Product mutations authenticated by cookies require a trusted browser Origin. Cookie-less **Workspace API key** clients do not require browser Origin validation.
- Authentication throttling is enabled in all runtime environments. One authentication runtime owns its bounded atomic counters. Client identity comes from the socket peer or explicitly trusted proxy headers containing one address. Untrusted caller-supplied identity headers are prohibited.
- Before each delivery, **Workspace live updates** revalidate persisted sessions, ban state, and accepted **Workspace membership**. Access loss closes the subscription before the pending event is delivered.
- Password changes enforce the same password complexity rules as sign-up and reset.
- Expired **Workspace invitations** do not prevent a new invitation for the same workspace and email.
- **Document** deletion commits durable Source-file cleanup intent with metadata deletion. The intent survives crashes and unlink failures until immediate cleanup or retention removes the binary.
- Numeric **Extraction results** accept finite numbers, signed decimal/scientific strings, and decimal currency amounts. Amounts can have `$`, `£`, or `€` prefixes and comma groups of three digits. Unsupported formats keep the raw answer with `invalid_type`.
- Malformed Model gateway result envelopes or entries are retryable failures, including JSON `null`.

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
- An explicit forward migration adds Better Auth admin plugin fields. It performs a safe one-time promotion for known bootstrap users that already exist.
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
- An **Application admin** ban blocks account sessions and future sign-in. It does not delete Workspace memberships or rotate Workspace API keys.
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
- The app creates a personal **Workspace** after authentication policy permits account access. When verification is required, unverified registration does not create one.
- Personal **Workspace** creation after **Account email verification** is idempotent. Existing accepted **Workspace membership** prevents another personal Workspace.
- Pending **Workspace invitations** do not suppress personal **Workspace** creation after **Account email verification**.
- A **Workspace invitation** is not workspace access until accepted.
- **Workspace invitations** are in-app invitations; outbound email is outside the current invitation lifecycle.
- Use `cancelled` for a **Workspace invitation** that ended without acceptance, including when the invitee declines it.
- Invitee decline and owner/admin cancellation are separate actions with different authorization paths, but both make the invitation `cancelled`.
- Only workspace owners and admins may see or cancel pending **Workspace invitations** sent from a **Workspace**.
- A workspace owner/admin should confirm before canceling someone else's pending **Workspace invitation**.
- A **Workspace invitation** remains valid after inviter role changes or inviter departure unless it is canceled or expires.
- Deleting a **Workspace** deletes its **Workspace invitations**.
- **Workspace invitation management** shows actionable pending invitations, not accepted, canceled, or expired invitation history.
- Invitees should see inviter identity, offered role, invited email, invited time, and expiry before accepting a **Workspace invitation**.
- Only actionable pending **Workspace invitations** should appear in an invitee's workspace list; expired invitations are hidden from that list.
- Invitees accept or decline a **Workspace invitation** from the invitation detail view, not directly from the workspace list.
- Invitees do not need a confirmation prompt when declining their own **Workspace invitation**.
- A current workspace member should not also have a pending **Workspace invitation** for the same **Workspace**.
- Accepting a **Workspace invitation** must not overwrite an existing **Workspace membership** or change its role.
- **Workspace invitations** match the invitee by the account's current email address; account email is not user-editable.
- A signed-in user must always have at least one accepted **Workspace** after sign-up or first login.
- A user cannot delete their only accepted **Workspace**.
- The backend repairs a missing accepted **Workspace**. Clients must not use the normal create-workspace action to perform this repair.
- `GET /v1/workspaces` repairs a broken zero-accepted-Workspace invariant by creating a personal **Workspace** through the same bootstrap path used for first login.
- Pending **Workspace invitations** do not satisfy the accepted **Workspace** invariant.
- Owners and admins can remove another user’s **Workspace membership**, including their last accepted **Workspace**. The next Workspace listing repairs the removed user’s access invariant.
- Removing another user's **Workspace membership** does not immediately create that user's replacement personal **Workspace**.
- Accepted **Workspace** IDs are backend-owned; clients must not invent default or fallback workspace IDs.
- When a client needs a replacement accepted **Workspace context**, it should use the first accepted **Workspace** returned by the backend workspace list.
- The SPA uses the signed-in user session plus accepted **Workspace context** for workspace-scoped requests; **Workspace API keys** are for external API clients.
- **Workspace API keys** may be generated and shown to workspace owners/admins for external clients, but they are not SPA authentication credentials.
- **Workspace API keys** authenticate external clients for workspace-scoped product routes such as templates, extraction jobs, and document submission.
- **Workspace API keys** authorize integration product routes. Signed-in members perform **Template assistance**, suggestion and evidence selection, held Template selection, and split-plan confirmation in the frontend.
- **Workspace API keys** require only accepted Workspace authorization in the local-only runtime.
- Users manage profiles, membership, invitations, Workspace deletion, and API key generation in the frontend. **Template assistance** and manual document review also require sign-in. Sample-based **Template generation** remains available to API-key clients.
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
- Configuration replacement can omit the credential only when the stored **Model gateway credential** remains usable. An unreadable credential requires explicit replacement.
- Clearing **Workspace model configuration** removes the complete configuration rather than leaving partial gateway, model, or credential state.
- Clearing **Workspace model configuration** requires the current resource ETag. A concurrent change or earlier clear fails the precondition. An unconfigured Workspace has no mutation ETag. Repeated clearing is not an idempotent success.
- **Workspace model configuration** mutations reject stale revisions rather than silently overwriting concurrent changes.
- New **Workspace model configuration** disables native PDF input and structured output until explicitly declared. Sequential gateway calls are opt-in. Model processing does not use managed-file upload.
- Workspace owners/admins may read non-secret **Workspace model configuration** details; ordinary members may read only whether configuration is present.
- Owners and admins can inspect non-secret credential status to distinguish usable and unreadable **Model gateway credentials**. Members see only whether **Workspace model configuration** exists.
- **Workspace model configuration** management requires an authenticated user session and accepted **Workspace membership**; **Workspace API keys** cannot read or mutate it.
- Model-configuration access requires a valid user session. An API key alone returns unauthorized. Signed-in non-members are forbidden. Members are forbidden from owner/admin mutations.
- Saved **Model gateway credential** material is never returned through a product interface; replacing it requires a new credential value.
- An unreadable encrypted **Model gateway credential** is a configuration failure, not absent configuration. Dependent operations fail. Authorized users can still replace or clear it.
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
- **Workspace product analytics** can include stable Workspace, Template, and Extraction job IDs. These identifiers support aggregate usage analysis and operational debugging.
- **Workspace product analytics** must not include extracted answers, evidence text, Source file names, account emails, API keys, or Document contents.
- **Workspace product analytics** is not authoritative **Workspace product data** and is not part of Workspace deletion hard-erasure.
- **Workspace product analytics** emission is best-effort and must not fail the product action that produced the analytics event.
- The local-only runtime appends **Workspace product analytics** to one **Local product analytics log** per UTC day beneath local runtime state.
- A **Local product analytics log** permits only approved stable product IDs and operational metadata. It excludes answers, evidence text, filenames, emails, API keys, Source file binaries, and Document contents.
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
- Committed model-configuration creation, replacement, credential rotation, or clearing emits **Workspace context invalidation** with reason `model_configuration_changed`. The event excludes configuration fields. Other open SPA clients retrieve the authoritative product resource again.
- Model-configuration readiness is absent from **Workspace control data** and Workspace-list responses. The initiating client uses its mutation response. Other clients reload after invalidation.
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
- Local Source file storage is the authoritative binary store for local **Source files**. With local **Source file retention**, the processing file and original are the same file. Its retention flag controls whether processing cleanup can remove it.
- Local runtime state is grouped under one local state directory so reset and backup behavior is explicit.
- A **Source file page count** applies only to PDF **Source files** and is absent for non-PDF **Source files**.
- PDF submissions require a **Source file page count**. An unknown count rejects the submission.
- PDF page-count inspection runs outside the API process for Document submission and Template generation. It has bounded admission, a cancellable deadline, and pre-allocation decoded-buffer and parser-structure limits. Exceeding **Product safety limits** rejects the Source before promotion, job creation, or a Model gateway call.
- A **Source file page count** is internal Source file metadata until a product feature requires exposing or enforcing it.
- Existing **Source files** are not backfilled with a **Source file page count** because their original binary may already have been cleaned up.
- The product/API label is **Document Extraction**, not legacy Image Extraction.
- Background processor retry steps, not **Extraction job** status values, own retryability for transient processing failures.
- Do not model retryability with a durable `retryable_failed` **Extraction job** status.
- Durable **Extraction job lifecycle** states are `queued`, `awaiting_template`, `processing`, `completed`, and `failed`. The `awaiting_template` state holds work for manual selection; it does not retry automatically. Signed-in Workspace members resolve held Template choices and packet plans in the frontend. Integrations observe states and resume after review.
- Authoritative **Extraction job lifecycle** state belongs to **Workspace product data**.
- The **Extraction processor** performs long-running extraction work but does not own authoritative **Extraction job lifecycle** state.
- Background processor instance details are implementation metadata, not durable **Extraction job lifecycle** states.
- The **Local extraction runner** scans authoritative **Workspace product data** on startup for resumable `queued` and stale `processing` **Extraction jobs**.
- A server restart must not permanently strand an accepted **Extraction job** that has not reached `completed` or `failed`.
- The **Local extraction runner** owns bounded retry attempts as processor metadata, not as additional **Extraction job lifecycle** states.
- Each **Extraction processor** attempt reads the latest complete **Workspace model configuration** at startup. An active attempt retains its captured revision.
- **Extraction jobs** retain the non-secret configuration revision, model, and route for the latest or final attempt. Separate minimal model-call accounting records retain reported costs, token usage, request IDs, model/configuration revision, and processing stage across attempts (ADR-0017). They exclude request/response content and the **Model gateway credential**.
- **Document** model cost includes its automatic Template selection, extraction, and allocated Smart splitting costs. Split allocation is the packet's split cost multiplied by the Document's page count divided by the packet's selected page count. Excluded pages retain their share as packet overhead.
- **Document packet** model cost includes all split assessments and all child classification/extraction calls, including reported costs of retries and deleted children. Missing, interrupted, and historical unrecorded costs remain unavailable; partial totals expose only known spend. Deleting a packet or Workspace removes its accounting records.
- Clearing **Workspace model configuration** stops queued and retrying work at its next attempt. That attempt fails as unconfigured. Active attempts continue with captured settings.
- An unreadable **Model gateway credential** fails queued or retrying **Extraction jobs** as configuration unavailable. It does not cause a temporary gateway retry.
- Configuration changes do not reschedule retries, cancel active attempts, or discard successful results. The next scheduled attempt reads the latest settings.
- The **Extraction processor** sends the original **Source file** to the **Model gateway** for extraction rather than creating a separate OCR or text-conversion artifact first.
- Completed **Extraction jobs** record a stable **Model gateway** route label for support/debugging rather than the full request URL.
- The configured LiteLLM endpoint remains the **Model gateway** in the local-only runtime.
- The **Extraction processor** uses one configured **Model gateway**. Background processing retries temporary failures. There is no fallback provider.
- Deterministic Model gateway rejections fail an **Extraction job** terminally; throttling, timeouts, network failures, and gateway service failures use the bounded durable retry policy.
- Missing or unreadable **Workspace model configuration** does not consume the Model gateway retry budget.
- A persisted queued **Extraction job** notifies the local runner asynchronously, so Document acceptance is not delayed by Model gateway processing.
- After the **Extraction processor** receives a **Model gateway** response, **Extraction results** should be persisted and the **Extraction job** should be marked `completed`.
- Without **Source file retention**, a completed **Extraction job** does not keep its **Source file** binary after processing cleanup succeeds. A retained original outlives processing for both completed and failed jobs until its **Document** or **Workspace** is deleted.
- **Document** admission verifies **Workspace model configuration** immediately after Workspace authorization. This occurs before body parsing, **Source file** storage, or **Extraction job** creation.
- Model-configuration HTTP errors use the product envelope and exclude credentials. Invalid representations return `400 invalid_workspace_model_configuration`. Missing mutation preconditions return `428 precondition_required`. Failed or stale preconditions return `412 precondition_failed`.
- Model-configuration responses use `Cache-Control: no-store`. Only a configured owner/admin representation supplies an ETag. This token controls mutation concurrency, not conditional-read caching.
- **Document** admission returns `409 workspace_model_not_configured` for absent configuration. An unreadable **Model gateway credential** returns `503 workspace_model_configuration_unavailable`. Configuration-unavailable responses omit retry timing because repair requires an owner or admin.
- Multipart **Document** admission streams a bounded `document` part to temporary local storage. It validates required metadata and PDF page count. It then atomically promotes the **Source file** before **Extraction job** acceptance.
- Admission count, reserved bytes, process memory, and disk reserve are local capacity limits; shared pressure returns retry guidance without creating an **Extraction job**.
- If local **Workspace product data** rejects a queued **Extraction job** after its **Source file** is written, the local Source file binary is deleted.
- If queuing an **Extraction processor** fails during Document submission, the **Extraction job** is marked `failed` and its **Source file** follows the failed-source retention window.
- A processing failure marks the **Extraction job** `failed` with durable error details. A Source file that is not retained is kept for recovery or inspection for seven days by default.
- Configuration-related terminal processing failures follow the same failed **Source file** retention policy as other processing failures.
- Successful processing immediately deletes non-retained **Source files**. A sweep that survives restarts completes interrupted cleanup and removes expired failed-source binaries. It preserves job metadata, errors, and results. Neither cleanup path removes retained originals.
- The memory queue is a bounded, Workspace-fair metadata accelerator for authoritative queued **Workspace product data**. Periodic reconciliation recovers work stored only in SQLite.
- Individual **Extraction job** retrieval uses entity validators and server-directed retry timing so unchanged polls do not hydrate or serialize **Extraction results**.
- Each active **Workspace product data** database has one process owner that tracks leases. SQLite write transactions remain short. Use rollback journaling until the bundled SQLite passes the WAL safety gate.
- **Workspace** deletion cleanup sweeps residual **Source files** that normal **Extraction job lifecycle** cleanup did not delete.
- The server records **Source file retention** once when it starts accepting a Document upload. Retention requires configured storage, enabled installation retention, and no **Workspace source retention** opt-out. Later setting changes affect later uploads only.
- **Workspace control data** stores **Workspace source retention**. Only signed-in owners or admins can change it. **Workspace API keys** cannot change this setting.
- Existing **Extraction jobs** migrate as not retained, whether or not their processing file still exists.
- With S3-compatible storage, original storage must succeed before **Extraction job** acceptance. Failure returns a retryable upload error without creating a job. Processing uses a local copy, removed when processing ends.
- **Document** or **Workspace** deletion removes access immediately. Durable background cleanup removes remote originals. Logical deletion does not wait for remote storage. Its confirmation does not assert physical erasure.
- Sessions and **Workspace API keys** can stream retained originals through their owning **Extraction job** or **Document packet** in the same **Workspace**. Responses use `private, no-store` caching. Active or held template/split resolution can read available working sources without completed-original retention. Retrieval failure does not change processing state or results. The app distinguishes non-retained, missing, and temporarily unavailable sources.
- A **Template** must have at least one **Template field** before it can be used for extraction.
- Changing **Template fields** creates a new **Template version**.
- An **Extraction job** is interpreted against its fixed **Template binding**: the version captured at explicit submission, or at successful automatic/manual resolution.
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
- A logical **Document** creates one **Extraction job**. A **Document packet** owns zero or more child Documents; it is not itself an Extraction job or result.
- An **Extraction job lifecycle** is coordinated by authoritative **Workspace product data** and executed by an **Extraction processor** after the **Extraction job** is queued.
- A **Template** has one or more **Template fields**.
- A **Template** has one or more **Template versions**.
- A **Template field** may have a **Template object schema** when its data type is `object` or `array<object>`.
- An **Extraction job** has one fixed **Template version** once its **Template binding** is resolved; unresolved automatic jobs have no binding.
- A completed **Extraction job** has one **Extraction result** per extracted **Template field**.

## Example Dialogue

> **Dev:** "If a user selects an invited workspace, can we treat it as the active workspace for API calls?"
> **Domain expert:** "No. Until acceptance, this is a **Pending workspace invitation context**. Show invitation details without enabling Workspace product access."

## Flagged Ambiguities

- Use **Workspace** for the environment a user leaves. **Workspace membership** represents their access. The older term "group" is ambiguous.
- Use **Workspace member action** for Workspace access management. The older term "user status" is ambiguous.
- Use **Workspace context** for backend access and **Workspace selection view** for frontend presentation. "Workspace state" can also refer to local storage and is ambiguous.
- Use **Document** for submitted PDFs and images. Use **Source file** for the original binary. Legacy `image` terminology does not describe all supported sources.
