# Frontend Context

This context defines browser concepts and interactions for signed-in users who manage Workspaces, templates, and document extraction. The backend context defines durable Workspace rules.

## Language

**Workspace selection view**:
The UI representation of either an accepted **Workspace** or a pending **Workspace invitation** in the workspace area.
_Avoid_: workspace state, workspace mode

**Active page**:
The sidebar section selected by the current browser URL in the SPA.
_Avoid_: workspace page state

**Accepted workspace entry**:
A selectable workspace list item backed by an accepted workspace membership.
_Avoid_: connected workspace, active account

**Invited workspace entry**:
A selectable workspace list item backed by a pending **Workspace invitation** rather than workspace access.
_Avoid_: pending workspace, inactive workspace

**Locked invitation state**:
The view for an **Invited workspace entry**. It shows invitation details and actions without access to Workspace product data.
_Avoid_: disabled workspace, read-only workspace

**Action toast**:
A user-facing notification that reports the outcome of a workspace, template, document, clipboard, or invitation action.
_Avoid_: alert, snackbar

**Account verification prompt**:
The auth-screen message telling an email/password user to verify their email before account access is available.
_Avoid_: signup success, generic auth notice

**Account password reset**:
An auth-screen procedure to reset an email/password Account password. A person who knows the account email can request a reset link.
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
Realtime browser notifications for an accepted **Workspace context**. They update visible **Extraction jobs** and carry Workspace context invalidation hints. They require a signed-in session.
_Avoid_: durable event history, polling replacement for all data, context snapshot

**Workspace context invalidation**:
A **Workspace live update** hint that product settings or access changed. It tells the browser to revalidate accepted **Workspace context** over HTTP.
_Avoid_: local rule, context snapshot

**Document**:
A user-provided file submitted for extraction.
_Avoid_: image, upload, input file

**Document reconciliation**:
Coordination of displayed **Extraction jobs**, Document selection, and **Completed document cache** with accepted updates for the current session and **Workspace context**.
_Avoid_: job merging, cache synchronization

**Source file**:
The original uploaded binary for a **Document**.
_Avoid_: image file, browser file, upload blob

**Document viewing preference**:
An Account-specific browser preference for **Extraction results** alone or **Source file** and results together.
_Avoid_: Workspace layout setting, Source file retention setting

**Evaluation document library**:
A Workspace-shared collection of documents and verified **Expected answers**. Members reuse them in single-document or Batch Evaluations.
_Avoid_: saved Evaluation history, personal document library, model-generated ground truth

**Saved Evaluation document**:
A library entry with a fixed original **Source file** and editable **Expected answer set**. It is independent of ordinary extraction history.
_Avoid_: saved Evaluation run, Extraction job, temporary Evaluation upload

**Expected answer set**:
Reference field definitions and verified **Expected answers** saved with one library document. The set includes expected-table structure and matching rules. Compatible **Templates** can reuse it. It can be incomplete or contain no verified answers.
_Avoid_: candidate output, Template-owned answer sheet, saved Evaluation results

**Temporary Evaluation result cache**:
Private, encrypted storage for detailed results in one live **Evaluation**, tab, and **Workspace**. It preserves the Evaluation lifetime without refresh restoration or saved run history.
_Avoid_: saved Evaluation history, Completed document cache, reusable Evaluation results

**Product safety limit**:
A non-commercial guardrail that prevents unsupported or excessive Documents from being submitted.
_Avoid_: commercial quota, account tier

**Extraction job**:
The displayed processing record for one logical **Document**. An explicit submission fixes its **Template** immediately. Automatic classification selects it later. A held record can require manual selection.
_Avoid_: job, upload, document row

**Extraction result**:
The displayed output value for a **Template field** in a completed **Extraction job**.
_Avoid_: answer row, model response, result item

**Template**:
A reusable extraction schema selected explicitly or automatically for a **Document**.
_Avoid_: form, prompt, extraction config

**Template tag**:
A user-defined lowercase label shared within a **Workspace**, with zero or more associated **Templates**. Selected tags belong to the draft. The shared vocabulary includes unused tags.
_Avoid_: field tag, personal label, automatic selection rule

**Generated template draft**:
An unsaved **Template** proposed by a model from a sample file. The user reviews and edits it before saving. It can create a Template or revise an existing one.
_Avoid_: automatically saved template, extraction result

**Template assistant**:
The Templates panel for explanations and focused edits to a draft. Evidence, explanations, and proposals are temporary. Opening the panel alone does not call the model. Shared deterministic diagnostics also work in the Evaluation Template editor without a model.
_Avoid_: persistent chat, automatic repair, Evaluation assistant

**Template change group**:
An indivisible proposed edit with before/after values, reasons, dependencies, and output-identity effects. **Apply** updates the draft once with the selected valid groups. Save is explicit. Draft, request, target, page, Workspace, or session changes invalidate the proposal. Restoring identical text does not restore validity.
_Avoid_: saved Template version, verified improvement

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

**Getting started tour**:
An optional guided procedure that creates real Workspaces, configures Template fields and object-array columns, sets model configuration, and uploads Documents.
_Avoid_: demo mode, sample data sandbox

## Relationships

- The **Getting started tour** is offered after an authenticated user's Workspace context resolves, unless that Account has already started or dismissed it in this browser.
- Tour preference is browser-local and keyed by Account; impersonated sessions do not show the tour.
- Restart the tour from the profile modal in the left sidebar. Starting closes the modal and begins a new Workspace procedure. It does not resume earlier progress.
- On desktop, the navigation sidebar collapses to icons through its toggle or `[`. The browser stores this choice independently of Account.
- The tour invitation card is hidden while the navigation sidebar is collapsed; the tour stays available from the profile modal.
- Tour actions create real Workspaces, Templates, and Extraction jobs. Exiting or refreshing preserves saved data and discards unfinished drafts.
- During the tour, only highlighted controls, highlighted editor groups, and tour controls accept pointer or keyboard input. Escape and Exit tour remove this restriction.
- Creation and upload steps advance on successful state changes, while validation or request failures keep the user on the relevant step for retry.
- The tour explains **Workspace model configuration** before uploading; a configured Model gateway is required to continue to Document submission.

- A **Workspace selection view** shows either an **Accepted workspace entry** or an **Invited workspace entry**.
- An **Invited workspace entry** opens the **Locked invitation state** until the **Workspace invitation** is accepted or declined.
- **Locked invitation state** does not provide workspace API access.
- Accepting a **Workspace invitation** moves the frontend into the newly accepted **Workspace context**.
- Declining a **Workspace invitation** removes the invited entry and returns the frontend to an accepted **Workspace context**.
- Creating a **Workspace** in the SPA selects its accepted **Workspace context**. It does not generate a **Workspace API key**.
- Renaming the current **Workspace** updates the selected **Workspace** display and **Stored workspace preference** without clearing workspace-scoped data.
- Startup workspace resolution chooses an accepted **Workspace context** when one exists; it does not auto-select an **Invited workspace entry**.
- URLs determine **Active page** and persisted Document/Template selection. `/workspaces/{workspaceId}` opens the Workspace page. Its `/documents/{jobId}`, `/templates/{templateId}`, `/packets/{packetId}`, and `/evaluations` paths select product views. `/admin` is account-level. `/invitations/{invitationId}` opens a pending invitation. List URLs omit resource IDs; `/templates/new` opens a temporary draft.
- Explicit URLs take priority over **Stored workspace preference** after authentication and backend access loading. `/` selects the remembered accessible Workspace or first accepted Workspace, then uses its canonical URL. Inaccessible explicit links show recovery without substituting a Workspace or resource. Missing resources keep their URL until the user selects recovery.
- Browser Back/Forward restores Workspace, page, and resource selection. Packet child tabs use `/workspaces/{workspaceId}/packets/{packetId}/documents/{jobId}` to preserve packet context. Native links permit address copying and separate tabs. Search, filters, sort, and bulk selection remain local. Template links open the current saved version; historical version URLs are unsupported. `/reset-password` retains its token procedure.
- Navigation within one Workspace preserves Template drafts and temporary Evaluations in memory. Replacing a dirty Template, switching Workspace, or leaving an Evaluation dialog requires confirmation before relevant edits are discarded. Canceling Back/Forward restores the original history entry. Refreshing or leaving the app warns about unsaved Template/Evaluation state without saving it.
- **Stored workspace preference** persists accepted **Workspace** selection, not selected **Workspace invitations**.
- **Stored workspace preference** contains only accepted **Workspace** ID and display name.
- **Stored workspace preference** may restore an **Accepted workspace entry**, but only when that **Workspace** still appears in the backend workspace list.
- If **Stored workspace preference** is no longer accessible, select another accepted **Workspace** from the backend list. Replace the preference without a prompt.
- After current **Workspace** deletion, clear its frontend state. Refresh the Workspace list and select the first remaining accepted Workspace.
- If accepted **Workspace** access becomes forbidden, refresh backend access. An explicit Workspace URL remains on a recovery screen. The user can select an accessible Workspace or open `/` for default resolution.
- **Stored workspace preference** does not persist **Workspace API key** material.
- Legacy stored `workspace_local_default` values are treated as no accepted **Workspace** preference.
- The frontend stores workspace preference under a Document Extraction local storage key and does not read the legacy `imageextraction.workspace.v1` key.
- Replacing the legacy storage key is an intentional clean break from old local workspace preference and cached workspace data.
- Auth form values are not part of **Stored workspace preference** and are not persisted by default.
- The frontend must not invent a fallback **Workspace**. Show **Loading workspace context** until accepted backend access resolves.
- **Loading workspace context** uses a generic loading display rather than a stored Workspace name hint.
- During **Loading workspace context**, workspace-scoped UI actions are unavailable until an accepted **Workspace** is resolved.
- A **Workspace resolution error** keeps Workspace actions disabled. Offer retry without falling back to stored preference.
- Unauthenticated users accessing the SPA are taken to the login page and do not have a **Workspace context**.
- Load public runtime capabilities before showing auth controls. Offer only enabled login methods and registration actions. Use the configured upload limit.
- If verification is required, email/password signup shows **Account verification prompt** without resolving session or Workspace. Otherwise, resolve account access directly. Verification is disabled by default.
- The **Account verification prompt** and password-reset feedback distinguish local captured links from actual inbox delivery.
- After email/password sign-up, the **Account verification prompt** replaces the create-account form rather than appearing alongside it.
- Leaving the **Account verification prompt** for sign-in preserves the submitted email address and clears password fields.
- While the **Account verification prompt** is visible, it owns the transition back to sign-in; normal auth form switch links are not shown alongside it.
- The email address shown in the **Account verification prompt** is read-only display text, not an editable resend or account-change control.
- **Account verification prompt** tells users to open the verification link to complete account setup. It must not imply that manual sign-in always follows verification.
- The **Account verification prompt** does not show alternate auth actions such as Google sign-in; those remain available on the sign-in screen.
- The visible **Account verification prompt** blocks another sign-up attempt until the user leaves the prompt and intentionally opens sign-up again.
- If required verification blocks an unverified email/password sign-in, explain where the new verification link is delivered.
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
- If a non-admin state selects **Application admin page**, return to the Workspace page. Do not render unauthorized admin content.
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
- After impersonation starts, clear session-scoped Workspace, Template, and Document state. Reload the session and open the Workspace page.
- During impersonation, the frontend shows a persistent impersonation indicator with a stop-impersonating action.
- The primary impersonation indicator appears in the main layout, not only inside the profile menu.
- Impersonation state is read from Better Auth's session response rather than a custom product session endpoint.
- The impersonation indicator names the current impersonated user and does not show the original admin's Better Auth user ID.
- Stopping impersonation is immediate and does not require confirmation.
- After impersonation stops, clear session-scoped Workspace, Template, and Document state. Reload the session and return the admin to **Application admin page**.
- Backend repair of a broken zero-accepted-Workspace invariant is not surfaced as a user-facing **Action toast**.
- The frontend SPA uses the signed-in user session plus accepted **Workspace context** for workspace-scoped requests, not **Workspace API key display** credentials.
- Signed-in members use **Template assistant**, suggested requests, and historical evidence in the frontend. Sample-based Template generation is also available to integrations.
- On accepted **Workspace context** change, immediately clear the previous Workspace’s visible data. Then load the new Workspace.
- **Workspace API key display** can show newly generated credentials for external clients. The SPA must not store or use them as its active credential.
- **Workspace API key display** shows key material only immediately after creation or rotation; after navigation or refresh, the secret is no longer available.
- Creating a **Workspace** from the SPA does not automatically show external-client credential material; owners/admins explicitly generate or rotate the key when needed.
- After key generation or rotation, show the new secret in **Workspace API key display**. Attempt clipboard copying and show an **Action toast**.
- Successful copying reports "Workspace API key generated and copied" or "Workspace API key rotated and copied". Copy failure reports successful generation or rotation and instructs the user to copy the key before leaving.
- One-time visible **Workspace API key** material remains visible until the user dismisses it, changes **Workspace**, signs out, refreshes, or navigates away.
- Visible **Workspace API key** material includes a small icon-only copy button inside the key field.
- The icon-only copy button for visible **Workspace API key** material has an accessible label such as `Copy API key`.
- The **Workspace API key display** action is labeled "Generate API Key" before an external-client key exists and "Rotate API Key" when replacing an existing key.
- Rotating an existing **Workspace API key** requires confirmation because it invalidates existing external clients; first generation does not require confirmation.
- When no **Workspace API key** exists, **Workspace API key display** says "Generate an API key to view".
- When a **Workspace API key** exists but key material is not visible, **Workspace API key display** says "Rotate API key to view again".
- The frontend may show whether a **Workspace API key** exists, but it must not show existing key material after the one-time display window ends.
- The **Workspace API key display** section is visible to workspace members, but only owners/admins can generate or rotate **Workspace API keys**.
- An **Action toast** may report the outcome of actions on Workspaces, Templates, Documents, Workspace invitations, Workspace members, or clipboard content.
- A **Document upload toast** is a specialized **Action toast** for document queueing outcomes.
- **Document reconciliation** owns reads, submission, deletion, displayed **Extraction jobs**, selection, pagination, counts, and **Completed document cache**. Its scope is the current session and accepted **Workspace context**.
- An overlapping Document read preserves changes received after the read started. It merges unaffected rows and schedules one combined refresh for list membership and counts.
- Submission batches capture their original **Workspace context** and request adapter. After a Workspace switch, remaining files submit to the original Workspace. Later UI and cache effects are suppressed.
- Session changes stop unsent batch files. Sign-out and impersonation stop unsent files when the action starts. Accepted backend work can finish.
- React owns presentation, confirmations, toasts, downloads, and **Workspace live updates** transport. **Document reconciliation** accepts or rejects Document updates and request outcomes.
- **Completed document cache** may render completed **Extraction job** details immediately after an accepted **Workspace context** is resolved, while the backend remains the source of truth.
- **Completed document cache** contains backend-returned completed job metadata and **Extraction results**, not source file contents, `File` objects, blob URLs, or source preview URLs.
- **Document viewing preference** defaults to results and uses Account-specific browser storage. During impersonation, changes affect the page without changing the stored preference.
- Without a retained **Source file**, a **Document** shows results only. Hide layout switching and Download. Preserve the Account’s preference for other Documents.
- Load a retained **Source file** only while its side-by-side pane is visible. Keep it in memory as an object URL. Release it when Document, layout, session, or Workspace changes. Below a 600px main-area width, use Results | Document tabs and start on Results.
- **Completed document cache** stores a completed **Extraction job** only after the user opens that **Document** and its details load.
- **Completed document cache** keeps at most 50 completed **Documents** per accepted **Workspace**.
- **Completed document cache** may survive page refresh for the same resolved accepted **Workspace**.
- **Completed document cache** does not store queued, processing, or failed **Extraction jobs** as durable UI state.
- **Completed document cache** entries are removed when the backend no longer lists the **Extraction job** or the user deletes the **Document**.
- **Completed document cache** entries are not removed merely because a filtered job list does not show them.
- Prune **Completed document cache** conservatively after unfiltered list refreshes. A not-found detail response removes its entry immediately.
- Without an explicit resource URL, the Document list can select its first available item. An explicit link preserves selection independently of list membership. A not-found detail response shows recovery.
- Restore the selected **Document** from its URL after refresh. Detail reads do not depend on pagination or filters. An absent list row does not prove deletion.
- **Completed document cache** is cleared when the accepted **Workspace context** changes.
- **Completed document cache** and user-specific stored workspace data are cleared on sign-out.
- A **Document** has one **Source file** selected in the browser before submission.
- Document submission must use the `document` multipart field; legacy `image` and generic `file` submission fields are not accepted or advertised.
- Extraction job API responses should expose **Source file** terminology and should not expose legacy `image` aliases.
- Standard MIME types, generated files, and required platform API vocabulary may retain `image` where that word is part of the external standard or platform contract.
- Use **Document** synonymously for supported source formats, including PNG, JPEG, WebP, and PDF, unless a standards-level MIME type must be named.
- The product/API label is **Document Extraction**, not legacy Image Extraction.
- Upload requires an explicit **Template** or Automatic with one or more existing **Template tags**. Automatic candidates match any selected tag. Each logical Document is assessed independently. An explicit Template takes priority.
- Automatic upload selection shows existing **Template tags** as checkbox chips with counts and a preview of matching Templates. Creating or managing tags belongs to the Template page.
- The upload default remains the previously selected Template. Automatic has no Workspace enable/disable toggle.
- Browser uploads submit all pages. API clients can select physical original pages. Split review and lineage always use original page numbers, never preview or child numbering.
- The Model gateway opens on its read-only summary, including an empty model table when unconfigured. Owners/admins choose Edit to enter settings; Cancel and successful clearing return to the summary. Unconfigured values display as unavailable and connection testing stays disabled until editing or configuration.
- **Workspace document processing settings** apply to all uploads and API requests. Show them directly below Model gateway. The upload modal has no policy paragraph or overrides. Splitting and blank exclusion default to disabled; exclusion requires splitting. Toggles save immediately and show an **Action toast**. A failed save restores the previous value.
- Without Smart splitting, one submitted **Document** creates one **Extraction job**. Smart splitting creates a **Document packet** parent with logical child jobs.
- Show multi-document packets and unresolved boundaries in a parent view. Include original-page groups, exclusions, progress, and child links. Single-page uploads show ordinary Document preparation. Accepted one-document splits open normal child results and Source file views, including for multi-page Documents.
- Show an accepted one-document split as one row with the child ID and status. Omit packet tabs and counts. This decision follows the accepted plan; deleting siblings does not convert a multi-document packet. The durable parent is not an extracted Document, export row, or Completed document cache entry. Packet counts do not increase extraction-job counts.
- The Document list loads 50 entries per page across packets and standalone Documents together. A packet consumes one entry regardless of its child count. Search and filters match packet metadata or its children before pagination. Child live updates carry their parent identity and never appear as standalone entries while packet metadata is loading.
- Request manual review only after bounded reassessment or when further automatic work cannot help. Keep held sources available without another upload. A signed-in member confirms boundaries or selects Templates within accepted Workspace context.
- Packet review shows original-page previews. Every selected page must belong to one nonempty group or have an explicit exclusion reason. Confirmation uses the displayed plan revision. A conflict reloads the plan and requires renewed review.
- A verified all-blank packet completes as **No documents to extract**, with exclusion records and zero child jobs.
- Packet deletion removes the parent and all children. Child deletion in a multi-document packet preserves siblings and parent. Deleting a split result shown as one Document also removes its hidden parent and retained original. Download and Export use the child. A retained packet download contains the full uploaded file, including excluded pages.
- Automatic Template selection displays the pinned Template/version and concise reason. Manual resolution can select any usable authorized Template without re-uploading the Source file.
- The header Documents count totals all durable **Extraction jobs** in the accepted **Workspace**. It includes `queued`, `processing`, `awaiting_template`, `completed`, and `failed`. Pagination, search, and loaded-row count do not affect it.
- Status counters show authoritative Workspace totals independently of pagination and filters. Lifecycle updates revalidate counts separately from lists, including updates to unloaded Documents.
- A **Template** has one or more **Template fields** displayed and edited by the frontend.
- **Template fields** are always requested during extraction; the template editing UI does not offer required/optional field controls.
- The Template field editor and JSON modal allow at most one table-shaped **Template field** with no more than 20 **Template object columns**.
- An **Extraction job** shows results for its fixed **Template version**, pinned at explicit submission or when automatic/manual selection resolves. Later Template edits do not change its interpretation.
- A completed **Extraction job** displays **Extraction results** for extracted **Template fields**.
- The Document header shows total model cost beside average confidence only when the Document is completed. The packet header shows total model cost after the excluded-page count only when the packet is completed. Hovering, focusing, or tapping a total exposes Smart split, Auto template, and Extraction costs. Missing costs display as unavailable; partial totals use a plus sign with an explanation. Display rounding does not change stored costs or page allocation.
- Workspace owners/admins can open Costs from the Workspace header. Overview and Documents have shared UTC upload-date ranges, including 12 months and custom windows up to 366 days across full history. Ordinary members see a restricted view and make no dashboard requests.
- Workspace costs use exact bucket totals and averages over finished, fully costed Documents; excluded-page overhead stays in total spend. Distribution dots are bounded samples, grouped by Template with all models kept within each Document, and sampled percentiles are labelled estimates. Document lists paginate and load breakdowns on selection; retained deleted entries keep their names, pages, Template metadata and costs.
- Costs refresh every 30 seconds while visible, discard obsolete requests on scope changes, and clear displayed data on access errors. Show explicit loading, retry, empty, background-update and historical-backfill states. Sparse searches can offer continuation before finding matching records.
- **Selected upload Template** is derived from backend Templates after Workspace resolution and does not persist across page refresh.
- **Workspace live updates** do not provide durable history. After reconnecting, revalidate authoritative **Workspace product data** and accepted **Workspace context** over HTTP.
- **Extraction job** lifecycle live updates update Documents UI state without refreshing **Workspace context**.
- **Workspace context invalidation** refreshes selected accepted **Workspace context** over HTTP through bounded scheduling so bursts coalesce.
- Workspace and Template reads apply only to their originating session and **Workspace context**. Switching away and back invalidates earlier reads. Stale errors cannot trigger Workspace recovery.
- Session or context changes clear Template editor state, JSON drafts, lists, and **Selected upload Template**. Late mutations cannot repopulate the new context. Later selections or draft actions supersede pending detail reads.
- **Workspace access** invalidation revalidates selected accepted **Workspace context** immediately and blocks useful live update effects until revalidation succeeds.
- The common live invalidation path refreshes selected accepted **Workspace context** without fetching pending **Workspace invitations** or unrelated Workspaces.
- A full Workspace-list refresh remains available for startup, Stored workspace preference recovery, Workspace switching, pending **Workspace invitation** resolution, and access recovery.

## Example Dialogue

> **Dev:** "When a user selects an invited workspace, should we call workspace APIs with that workspace ID?"
> **Domain expert:** "No. Show the **Locked invitation state**. It is an **Invited workspace entry**, not accepted workspace access."

## Flagged Ambiguities

- Use **Workspace selection view** for frontend presentation and **Workspace context** for backend-defined access. "Workspace state" can also refer to local storage and is ambiguous.
- The old "default workspace" represented a synthetic frontend ID. Use **Loading workspace context** until an accepted backend **Workspace** is available.
- Use **Document** for supported PDFs and images. Use **Source file** for the submitted binary. The older term "image" does not cover all supported formats.

## Evaluations

**Evaluation** is a temporary comparison in one browser tab and Workspace. Documents, candidate drafts, verified Expected answers, and results belong to that tab. Navigation preserves them. Refresh discards them. There is no idle expiry or saved run history.

The **Temporary Evaluation result cache** preserves this lifetime. Clear, tab closure, session or access loss, and Workspace changes discard private Evaluation state. Only documents saved explicitly to **Evaluation document library** persist. A selected **Saved Evaluation document** supplies a private working copy of its **Expected answer set**. Changes reach the shared set only through an explicit update with conflict detection.

**Comparison candidates** either share Template fields to compare models, or share model/capabilities to compare editable Templates. Each result records its tested inputs. Later edits require an explicit rerun. Only verified Expected answers provide correctness references. Coverage and matches are separate measures. Table-cell matches are separate from scalar-field matches.

Expected dates default to day/month/year. Users can select month/day/year and inspect the interpreted date before verification. Verification stores ISO dates. Candidate comparison uses day/month/year for ambiguous numeric dates. Equivalent calendar days match across stored and returned formats.

Expected table cells can hold values, explicit absence, or an ignored state. Absent cells require empty output cells in existing rows. Ignored cells do not affect accuracy or difference highlighting. Saved Expected answer sets preserve these states. Validation errors appear beside affected inputs. Table errors select the affected row.

Template column additions, removals, and type changes require Expected table review. The editor uses the selected candidate’s tested schema, or its draft before a result exists. It adapts a private draft, preserving compatible values, cell states, and row matching. Changed schemas never automatically verify answers. Candidates with different schemas offer an explicit choice, with separate editor drafts. Cancel preserves the working copy; verification replaces its field definition and answer together. Updating the shared library remains explicit. Added top-level fields start unverified; unrequested saved fields remain available and count toward coverage.

The Template changes filter identifies changed fields, fields without saved answers, and unrequested saved fields. Names, order, and instructions can change without invalidating compatible answers. The table editor identifies those changes too. Renamed columns match stable keys or unique unchanged headings; otherwise users can explicitly reuse an unmatched previous column across the remaining rows. Values, cell states, and row identifiers follow that choice. Removed columns are pruned only from the verified draft, never from the original saved set during review.

The **Template field editor** serves Templates and the full Evaluation candidate-editing modal. Apply changes the draft. Save as new Template explicitly saves an independent normal Template from that draft.

**Manage library → Edit** opens a saved document’s field draft and Expected answers in the matrix without creating candidates or requiring model configuration. The draft starts from the saved answer definitions and supports the same field-change review. Existing Evaluation documents, candidate settings, results, and working copies remain in the tab. Back to Evaluation preserves the library field draft. Library answer updates remain explicit and use the existing revision-conflict review.

**Choose Template/version** in the library editor loads the selected Template’s current or historical fields into that document’s draft. The selected version is displayed, and further edits mark it as edited. Loading preserves Expected answers for change review and never submits a model run or library update. Canceling the picker or leaving its Evaluation invalidates pending loads. Reviewed definitions and answers reach the library only through **Update saved answers**.
