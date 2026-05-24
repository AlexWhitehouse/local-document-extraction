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

**Document upload toast**:
An **Action toast** that summarizes how many uploaded documents were queued and how many failed to queue.
_Avoid_: upload alert, document status message

**Completed document cache**:
Browser-local cached details for completed **Extraction jobs**, scoped by accepted **Workspace** and job ID.
_Avoid_: job history storage, workspace data persistence

**Document**:
A user-provided file submitted for extraction.
_Avoid_: image, upload, input file

**Source file**:
The original uploaded binary for a **Document**.
_Avoid_: image file, browser file, upload blob

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
- A **Template** has one or more **Template fields** displayed and edited by the frontend.
- An **Extraction job** shows results for the **Template version** used when the Document was submitted.
- A completed **Extraction job** displays **Extraction results** for extracted **Template fields**.
- **Selected upload Template** is derived from backend Templates after Workspace resolution and does not persist across page refresh.

## Example Dialogue

> **Dev:** "When a user selects an invited workspace, should we call workspace APIs with that workspace ID?"
> **Domain expert:** "No. Show the **Locked invitation state**. It is an **Invited workspace entry**, not accepted workspace access."

## Flagged Ambiguities

- "workspace state" can mean backend access, local persistence, or UI presentation; resolved: use **Workspace selection view** for the UI concept and **Workspace context** for the backend-defined access context.
- "default workspace" was used for a synthetic frontend workspace ID; resolved: use **Loading workspace context** until a backend-backed accepted **Workspace** is available.
- Legacy "image" terminology was used for earlier document submission, but the resolved product term is **Document** because source files can include PDFs as well as images; use **Source file** when referring to the original submitted binary.
