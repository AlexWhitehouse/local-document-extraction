# Frontend Context

The frontend context covers the browser experience for authenticated users managing workspaces, templates, and document extraction. It names UI concepts and interaction states; durable workspace rules are defined in the backend context.

## Language

**Workspace selection view**:
The UI representation of either an accepted **Workspace** or a pending **Workspace invitation** in the workspace area.
_Avoid_: workspace state, workspace mode

**Active page**:
The in-memory sidebar section currently shown in the SPA.
_Avoid_: persisted route, workspace page state

**Accepted workspace entry**:
A selectable workspace list item backed by an accepted workspace membership.
_Avoid_: connected workspace, active account

**Invited workspace entry**:
A selectable workspace list item backed by a pending **Workspace invitation** rather than workspace access.
_Avoid_: pending workspace, inactive workspace

**Locked invitation state**:
The workspace view shown for an **Invited workspace entry**, where invitation details and invitation actions are available but workspace API access is unavailable.
_Avoid_: disabled workspace, read-only workspace

**Action toast**:
A user-facing notification that reports the outcome of a workspace, template, document, clipboard, or invitation action.
_Avoid_: alert, snackbar

**Account verification prompt**:
The auth-screen message telling an email/password user to verify their email before account access is available.
_Avoid_: signup success, generic auth notice

**Account password reset**:
The auth-screen flow where someone who knows an account email can request a reset link and set a new password for an email/password Account.
_Avoid_: forgot password flow, password recovery, Workspace password reset

**Application admin page**:
The application-wide account management UI for **Application admins**, separate from workspace-scoped administration.
_Avoid_: workspace admin page, owner tools, support panel

**Document upload toast**:
An **Action toast** that summarizes how many uploaded documents were queued and how many failed to queue.
_Avoid_: upload alert, document status message

**Completed document cache**:
Browser-local cached details for completed **Extraction jobs**, scoped by accepted **Workspace** and job ID.
_Avoid_: job history storage, workspace data persistence

**Workspace live update**:
A session-only realtime message stream for the accepted **Workspace context** that can update visible **Extraction jobs** and carry Workspace context invalidation hints.
_Avoid_: durable event history, polling replacement for all data, context snapshot

**Workspace context invalidation**:
A freshness hint from **Workspace live updates** that tells the browser to revalidate the selected accepted **Workspace context** over HTTP because product configuration or access state may have changed.
_Avoid_: local rule, context snapshot

**Document**:
A user-provided file submitted for extraction.
_Avoid_: image, upload, input file

**Document reconciliation**:
Keeping displayed **Extraction jobs**, Document selection, and the **Completed document cache** consistent with accepted updates for the current session and **Workspace context**.
_Avoid_: job merging, cache synchronization

**Source file**:
The original uploaded binary for a **Document**.
_Avoid_: image file, browser file, upload blob

**Product safety limit**:
A non-commercial guardrail that prevents unsupported or excessive Documents from being submitted.
_Avoid_: commercial quota, account tier

**Extraction job**:
The displayed processing item created when a **Document** is submitted with a **Template**.
_Avoid_: job, upload, document row

**Extraction result**:
The displayed output value for a **Template field** in a completed **Extraction job**.
_Avoid_: answer row, model response, result item

**Template**:
A reusable extraction schema selected when submitting **Documents**.
_Avoid_: form, prompt, extraction config

**Selected upload Template**:
The in-memory Template selection used for the next Document upload.
_Avoid_: persisted extraction template, default template

**Template field**:
An individual answer definition inside a **Template**.
_Avoid_: field row, extraction key, output column

**Template version**:
A specific revision of a **Template** used to interpret **Extraction job** results.
_Avoid_: current template, schema snapshot

**Stored workspace preference**:
Browser-local accepted workspace selection data used to restore the user's last selected workspace experience.
_Avoid_: workspace session, cached workspace

**Loading workspace context**:
The temporary browser state while the frontend is resolving the user's accepted **Workspace** from the backend.
_Avoid_: default workspace, fallback workspace, local workspace

**Workspace resolution error**:
The frontend state shown when accepted **Workspace context** could not be resolved for a signed-in user.
_Avoid_: fallback workspace, offline workspace

**Workspace API key display**:
The UI surface for generating and showing a workspace-scoped credential intended for external API clients.
_Avoid_: frontend auth mode, session replacement

## Relationships

- A **Workspace selection view** shows either an **Accepted workspace entry** or an **Invited workspace entry**.
- An **Invited workspace entry** opens the **Locked invitation state** until the **Workspace invitation** is accepted or declined.
- **Locked invitation state** does not provide workspace API access.
- Accepting a **Workspace invitation** moves the frontend into the newly accepted **Workspace context**.
- Declining a **Workspace invitation** removes the invited entry and returns the frontend to an accepted **Workspace context**.
- Creating a new **Workspace** from the SPA moves the frontend into the new accepted **Workspace context** without generating a **Workspace API key**.
- Renaming the current **Workspace** updates the selected **Workspace** display and **Stored workspace preference** without clearing workspace-scoped data.
- Startup workspace resolution chooses an accepted **Workspace context** when one exists; it does not auto-select an **Invited workspace entry**.
- **Active page** does not persist across page refresh; the SPA starts from the Workspace page unless URL routing is introduced later.
- **Stored workspace preference** persists accepted **Workspace** selection, not selected **Workspace invitations**.
- **Stored workspace preference** contains only accepted **Workspace** ID and display name.
- **Stored workspace preference** may restore an **Accepted workspace entry**, but only when that **Workspace** still appears in the backend workspace list.
- If **Stored workspace preference** no longer matches an accepted **Workspace**, the frontend silently selects another accepted **Workspace** from the backend list and replaces the stored preference.
- After the user deletes the current **Workspace**, the frontend clears current workspace-scoped state, refreshes the backend workspace list, and selects the first remaining accepted **Workspace**.
- If the selected accepted **Workspace** starts returning forbidden access, the frontend refreshes the backend workspace list, moves to another accepted **Workspace** if available, and shows an **Action toast** that access changed.
- **Stored workspace preference** does not persist **Workspace API key** material.
- Legacy stored `workspace_local_default` values are treated as no accepted **Workspace** preference.
- The frontend stores workspace preference under a Document Extraction local storage key and does not read the legacy `imageextraction.workspace.v1` key.
- Replacing the legacy storage key is an intentional clean break from old local workspace preference and cached workspace data.
- Auth form values are not part of **Stored workspace preference** and are not persisted by default.
- The frontend must not invent a default or fallback **Workspace**; before an accepted **Workspace** is resolved, it shows **Loading workspace context**.
- **Loading workspace context** uses a generic loading display rather than a stored Workspace name hint.
- During **Loading workspace context**, workspace-scoped UI actions are unavailable until an accepted **Workspace** is resolved.
- A **Workspace resolution error** keeps workspace-scoped UI actions unavailable and offers retry rather than falling back to stored Workspace preference.
- Unauthenticated users accessing the SPA are taken to the login page and do not have a **Workspace context**.
- After email/password sign-up, the frontend shows an **Account verification prompt** instead of resolving a session or Workspace.
- After email/password sign-up, the **Account verification prompt** replaces the create-account form rather than appearing alongside it.
- Leaving the **Account verification prompt** for sign-in preserves the submitted email address and clears password fields.
- While the **Account verification prompt** is visible, it owns the transition back to sign-in; normal auth form switch links are not shown alongside it.
- The email address shown in the **Account verification prompt** is read-only display text, not an editable resend or account-change control.
- The **Account verification prompt** tells the user to open the verification link to finish setting up the account, rather than implying manual sign-in is always required after verification.
- The **Account verification prompt** does not show alternate auth actions such as Google sign-in; those remain available on the sign-in screen.
- The visible **Account verification prompt** blocks another sign-up attempt until the user leaves the prompt and intentionally opens sign-up again.
- When an unverified email/password user tries to sign in, the frontend tells them to verify their email and that a new verification link was sent.
- The initial **Account verification prompt** does not include a separate resend control; sign-in retries send a new verification link.
- **Account password reset** request feedback does not reveal whether the submitted email belongs to an email/password Account.
- **Account password reset** links open the unauthenticated `/reset-password` SPA experience with a Better Auth reset token or token error in the query string.
- **Account password reset** links expire after one hour.
- **Account password reset** uses the same password requirements UI and **Account password policy** as account creation.
- **Account password reset** request is a distinct auth-screen mode reached from the sign-in password field area.
- **Account password reset** request preserves any email already typed on the sign-in form.
- **Account password reset** request success replaces the request form with a neutral success panel and a return to sign-in action.
- The `/reset-password` **Account password reset** form is unauthenticated and separate from the sign-in/sign-up auth-screen modes.
- After successful **Account password reset**, the frontend returns the user to sign in rather than treating the user as signed in.
- **Application admin page** access is for application-wide account administration and is not implied by Workspace owner/admin membership.
- Initial **Application admin** access is bootstrapped by a one-time migration that promotes known Better Auth users to the persisted Application admin role.
- The first **Application admin page** lets Application admins list users, search users, change application roles, ban/unban users with reasons, and impersonate non-admin users.
- The first **Application admin page** does not expose user deletion, user creation, password setting, or manual session revocation.
- The first **Application admin page** does not expose user name or account email editing.
- The first **Application admin page** does not show Workspace membership summaries or provide Workspace data management.
- The **Application admin page** remains available to Application admins during Loading workspace context or Workspace resolution error because it is account-level, not workspace-scoped.
- Local-only runtime keeps sign-in, **Workspace selection view**, invitations, **Application admin page**, and **Workspace API key display** behavior.
- Document upload UI may reflect **Product safety limits**, but not account-tier state.
- When the **Application admin page** is active, the context sidebar shows admin-specific account-management context rather than Workspace, Template, or Document lists.
- The **Application admin page** does not render workspace-specific toolbar content, but preserves the app's established page layout and visual structure.
- **Application admin page** loading and mutation state is local to the admin feature and does not use the app-wide busy flag.
- The first **Application admin page** shows account email verification status but does not show authentication provider/source.
- The first **Application admin page** does not show Better Auth user IDs.
- The first **Application admin page** shows account creation as an exact local date/time, not relative-only text.
- The first **Application admin page** changes application role through per-row `Make admin` or `Remove admin` actions with confirmation, not inline role dropdown editing.
- The first **Application admin page** bans users through a confirmation modal with a required reason field.
- The first **Application admin page** unbans users through a confirmation modal that shows the existing ban reason.
- The **Application admin page** reloads the current user list after successful role changes, bans, and unbans.
- The **Application admin page** does not reload the user list after successful impersonation because the session changes and the admin leaves the page.
- **Application admin page** implementation follows the existing feature-controller pattern rather than placing admin table state directly in the SPA root.
- **Application admin page** styling uses the existing global frontend stylesheet and feature-specific class names.
- **Application admin page** implementation includes focused frontend coverage for admin visibility, non-admin fallback, self-action guards, and impersonation transition behavior.
- The first **Application admin page** calls Better Auth admin client utilities directly rather than custom product `/v1/admin/*` routes.
- The existing runtime auth client includes Better Auth's admin client plugin rather than creating a separate admin-only client.
- The first **Application admin page** does not introduce custom audit-log UI.
- **Application admin page** user search uses one search input plus a field selector for email or name, defaulting to email.
- **Application admin page** user search is submitted manually and can be cleared back to the first unfiltered page.
- **Application admin page** user listing uses a fixed page size of 25 with previous/next pagination.
- **Application admin page** user listing sorts by newest accounts first by default.
- The first **Application admin page** does not expose role or banned-status filters.
- If a non-admin frontend state attempts to show the **Application admin page**, the frontend returns to the Workspace page rather than rendering an unauthorized admin view.
- **Application admin page** actions use Action toasts for operation outcomes and inline errors for recoverable form or loading issues.
- **Application admin page** user listing uses a simple in-panel loading state rather than a skeleton layout.
- The Admin sidebar item does not show a count badge in the first slice; total user count appears inside the **Application admin page** after loading.
- Starting impersonation from the **Application admin page** requires confirmation that identifies the target user and explains the transition into that user's app experience.
- The **Application admin page** does not allow an Application admin to impersonate their own account.
- The **Application admin page** does not allow impersonating banned users.
- The **Application admin page** allows impersonating regular users, but not other Application admins.
- Checking **Application admin page** visibility must not cause non-admin users to see content layout shifts.
- The frontend decides **Application admin page** visibility from the resolved authenticated session before rendering the authenticated layout, not from a later post-render permission check.
- **Application admin page** visibility is based on persisted application role in the authenticated session.
- Better Auth admin plugin account fields are expected to exist before the **Application admin page** is used.
- Better Auth application role is single-valued: a user is either `user` or `admin` in the application-wide auth context.
- Banning a user from the **Application admin page** affects that user's account access, not Workspace memberships or Workspace API keys.
- The first **Application admin page** ban flow creates permanent bans with required reasons; temporary ban duration is not exposed.
- Application role changes from the **Application admin page** require confirmation, with stronger confirmation language when removing Application admin authority.
- The **Application admin page** does not allow an Application admin to demote their own application role in the first slice.
- The **Application admin page** does not allow an Application admin to ban their own account in the first slice.
- The **Application admin page** allows banning another Application admin with explicit confirmation.
- Unbanning a user from the **Application admin page** requires confirmation that shows the user's email and existing ban reason.
- Application role changes from the **Application admin page** do not trigger custom session invalidation in the first slice.
- After an Application admin starts impersonating a user, the frontend clears session-scoped Workspace, Template, and Document UI state, refetches the session, and moves to the Workspace page.
- During impersonation, the frontend shows a persistent impersonation indicator with a stop-impersonating action.
- The primary impersonation indicator appears in the main layout, not only inside the profile menu.
- Impersonation state is read from Better Auth's session response rather than a custom product session endpoint.
- The impersonation indicator names the current impersonated user and does not show the original admin's Better Auth user ID.
- Stopping impersonation is immediate and does not require confirmation.
- Stopping impersonation clears session-scoped Workspace, Template, and Document UI state, refetches the session, and returns an Application admin to the **Application admin page**.
- Backend repair of a broken zero-accepted-Workspace invariant is not surfaced as a user-facing **Action toast**.
- The frontend SPA uses the signed-in user session plus accepted **Workspace context** for workspace-scoped requests, not **Workspace API key display** credentials.
- When the accepted **Workspace context** changes, the frontend immediately clears visible workspace-scoped data from the previous **Workspace** before loading the new **Workspace** data.
- **Workspace API key display** may show newly generated key material for external clients, but the SPA must not store or use it as its own active credential.
- **Workspace API key display** shows key material only immediately after creation or rotation; after navigation or refresh, the secret is no longer available.
- Creating a **Workspace** from the SPA does not automatically show external-client credential material; owners/admins explicitly generate or rotate the key when needed.
- After an owner/admin generates or rotates a **Workspace API key**, the frontend always shows the new key material in **Workspace API key display**, attempts to copy it to the clipboard, and shows an **Action toast**.
- Successful clipboard copy reports "Workspace API key generated and copied" or "Workspace API key rotated and copied"; failed clipboard copy reports that the key was generated or rotated and must be copied before leaving the page.
- One-time visible **Workspace API key** material remains visible until the user dismisses it, changes **Workspace**, signs out, refreshes, or navigates away.
- Visible **Workspace API key** material includes a small icon-only copy button inside the key field.
- The icon-only copy button for visible **Workspace API key** material has an accessible label such as `Copy API key`.
- The **Workspace API key display** action is labelled "Generate API Key" before an external-client key exists and "Rotate API Key" when replacing an existing key.
- Rotating an existing **Workspace API key** requires confirmation because it invalidates existing external clients; first generation does not require confirmation.
- When no **Workspace API key** exists, **Workspace API key display** says "Generate an API key to view".
- When a **Workspace API key** exists but key material is not visible, **Workspace API key display** says "Rotate API key to view again".
- The frontend may show whether a **Workspace API key** exists, but it must not show existing key material after the one-time display window ends.
- The **Workspace API key display** section is visible to workspace members, but only owners/admins can generate or rotate **Workspace API keys**.
- An **Action toast** may report the outcome of actions on Workspaces, Templates, Documents, Workspace invitations, Workspace members, or clipboard content.
- A **Document upload toast** is a specialized **Action toast** for document queueing outcomes.
- **Document reconciliation** owns Document reads, submission and deletion, displayed **Extraction jobs**, selection, pagination, counts, and the **Completed document cache** for the current session and accepted **Workspace context**.
- An overlapping Document read preserves changes observed since that read began, merges unaffected rows, and schedules one coalesced backend refresh to reconcile list membership and counts.
- A Document submission batch captures its original **Workspace context** and request adapter. Switching **Workspace** lets remaining files submit to the original **Workspace**, while suppressing its later UI and cache effects.
- A session change stops unsent files in Document submission batches. Sign-out and impersonation actions stop unsent files when the action begins; already submitted backend work may finish.
- React owns Document presentation, confirmations, toasts, downloads, and **Workspace live updates** transport; **Document reconciliation** decides which Document updates and request outcomes are accepted.
- **Completed document cache** may render completed **Extraction job** details immediately after an accepted **Workspace context** is resolved, while the backend remains the source of truth.
- **Completed document cache** contains backend-returned completed job metadata and **Extraction results**, not source file contents, `File` objects, blob URLs, or source preview URLs.
- **Completed document cache** stores a completed **Extraction job** only after the user opens that **Document** and its details load.
- **Completed document cache** keeps at most 50 completed **Documents** per accepted **Workspace**.
- **Completed document cache** may survive page refresh for the same resolved accepted **Workspace**.
- **Completed document cache** does not store queued, processing, or failed **Extraction jobs** as durable UI state.
- **Completed document cache** entries are removed when the backend no longer lists the **Extraction job** or the user deletes the **Document**.
- **Completed document cache** entries are not removed merely because a filtered job list does not show them.
- **Completed document cache** entries are pruned conservatively after unfiltered backend job-list refreshes and removed immediately when a job detail request returns not found.
- If the selected **Document** is no longer available after a backend job-list refresh, the frontend selects the first available **Document** or shows the empty document state.
- Selected **Document** is in-memory UI state and does not persist across page refresh.
- **Completed document cache** is cleared when the accepted **Workspace context** changes.
- **Completed document cache** and user-specific stored workspace data are cleared on sign-out.
- A **Document** has one **Source file** selected in the browser before submission.
- Document submission must use the `document` multipart field; legacy `image` and generic `file` submission fields are not accepted or advertised.
- Extraction job API responses should expose **Source file** terminology and should not expose legacy `image` aliases.
- Standard MIME types, generated files, and required platform API vocabulary may retain `image` where that word is part of the external standard or platform contract.
- Use **Document** synonymously for supported source formats, including PNG, JPEG, WebP, and PDF, unless a standards-level MIME type must be named.
- The product/API label is **Document Extraction**, not legacy Image Extraction.
- A **Document** submitted with a **Template** creates one **Extraction job** in the document list.
- The header Documents count represents the total number of durable **Extraction jobs** in the current accepted **Workspace** across `queued`, `processing`, `completed`, and `failed`, regardless of pagination, search, or how many list rows the frontend has loaded.
- A **Template** has one or more **Template fields** displayed and edited by the frontend.
- **Template fields** are always requested during extraction; the template editing UI does not offer required/optional field controls.
- The Template field editor and JSON modal allow at most one table-shaped **Template field** with no more than 20 **Template object columns**.
- An **Extraction job** shows results for the **Template version** used when the Document was submitted.
- A completed **Extraction job** displays **Extraction results** for extracted **Template fields**.
- **Selected upload Template** is derived from backend Templates after Workspace resolution and does not persist across page refresh.
- **Workspace live updates** are not durable history; clients revalidate authoritative **Workspace product data** and accepted **Workspace context** over HTTP after reconnecting.
- **Extraction job** lifecycle live updates update Documents UI state without refreshing **Workspace context**.
- **Workspace context invalidation** refreshes selected accepted **Workspace context** over HTTP through bounded scheduling so bursts coalesce.
- **Workspace access** invalidation revalidates selected accepted **Workspace context** immediately and blocks useful live update effects until revalidation succeeds.
- The common live invalidation path refreshes selected accepted **Workspace context** without fetching pending **Workspace invitations** or unrelated Workspaces.
- A full Workspace-list refresh remains available for startup, Stored workspace preference recovery, Workspace switching, pending **Workspace invitation** resolution, and access recovery.

## Example Dialogue

> **Dev:** "When a user selects an invited workspace, should we call workspace APIs with that workspace ID?"
> **Domain expert:** "No. Show the **Locked invitation state**. It is an **Invited workspace entry**, not accepted workspace access."

## Flagged Ambiguities

- "workspace state" can mean backend access, local persistence, or UI presentation; resolved: use **Workspace selection view** for the UI concept and **Workspace context** for the backend-defined access context.
- "default workspace" was used for a synthetic frontend workspace ID; resolved: use **Loading workspace context** until a backend-backed accepted **Workspace** is available.
- Legacy "image" terminology was used for earlier document submission, but the resolved product term is **Document** because source files can include PDFs as well as images; use **Source file** when referring to the original submitted binary.
