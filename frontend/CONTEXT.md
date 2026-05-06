# Frontend Context

The frontend context covers the browser experience for authenticated users managing workspaces, templates, and document extraction. It names UI concepts and interaction states; durable workspace rules are defined in the backend context.

## Language

**Workspace selection view**:
The UI representation of either an accepted **Workspace** or a pending **Workspace invitation** in the workspace area.
_Avoid_: workspace state, workspace mode

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

**Document upload toast**:
An **Action toast** that summarizes how many uploaded documents were queued and how many failed to queue.
_Avoid_: upload alert, document status message

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

**Template field**:
An individual answer definition inside a **Template**.
_Avoid_: field row, extraction key, output column

**Template version**:
A specific revision of a **Template** used to interpret **Extraction job** results.
_Avoid_: current template, schema snapshot

**Stored workspace preference**:
Browser-local workspace selection data used to restore the user's last selected workspace experience.
_Avoid_: workspace session, cached workspace

## Relationships

- A **Workspace selection view** shows either an **Accepted workspace entry** or an **Invited workspace entry**.
- An **Invited workspace entry** opens the **Locked invitation state** until the **Workspace invitation** is accepted or declined.
- **Locked invitation state** does not provide workspace API access.
- **Stored workspace preference** may restore an **Accepted workspace entry**, but backend authorization still decides whether workspace API access is valid.
- An **Action toast** may report the outcome of actions on Workspaces, Templates, Documents, Workspace invitations, Workspace members, or clipboard content.
- A **Document upload toast** is a specialized **Action toast** for document queueing outcomes.
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

## Example Dialogue

> **Dev:** "When a user selects an invited workspace, should we call workspace APIs with that workspace ID?"
> **Domain expert:** "No. Show the **Locked invitation state**. It is an **Invited workspace entry**, not accepted workspace access."

## Flagged Ambiguities

- "workspace state" can mean backend access, local persistence, or UI presentation; resolved: use **Workspace selection view** for the UI concept and **Workspace context** for the backend-defined access context.
- Legacy "image" terminology was used for earlier document submission, but the resolved product term is **Document** because source files can include PDFs as well as images; use **Source file** when referring to the original submitted binary.
