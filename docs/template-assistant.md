# Template assistant

Open a new or existing draft on **Templates**. Select **Assistant**, then **Explain issues** or **Propose edits**. Enter a focused request, such as “add VAT rate to each line item.”

Requests use the Workspace’s Template assistant model. This role inherits the extraction model unless an owner or admin selects another model under **Workspaces → Model gateway**.

The panel suggests requests from the draft, its problems, and any selected job. It makes one short text-only model call after relevant changes and a pause. Relevant changes include draft structure, descriptions, the selected tab, or evidence. Typing your request does not refresh suggestions. Selecting a suggestion fills the request; submit it to request an explanation or edits. If the model is unavailable or unconfigured, suggestions use application validation.

**Explain issues** suggestions concern existing fields and columns. Application validation errors are confirmed problems. Inferred concerns from instructions or stored results appear as questions about possible problems.

**Propose edits** suggestions concern missing fields or table columns. Each includes a proposed name, type, extraction instructions, and a reason based on the current Template. You can also enter focused fixes or renames. Insufficient context can produce no suggestions. Suggestions use an attached sample’s name, never its contents. They cannot report observations from that file.

Validation messages appear beside the affected Template name, field, or table column. Each explains the problem and corrective action. Select a problem control to focus its input. These controls also work in the Evaluation Template editor and without a configured model.

## Review and apply

An edit request returns change groups with reasons and before/after values. Select the required groups. Dependent changes must be selected together. All changes in one group apply together. Conflicts or an invalid combined draft disable **Apply**.

Field names determine output IDs. Table headings determine column keys. Before a rename, removal, or type change, review the identity and type warnings. These changes affect future extraction output and Evaluation alignment. Historical Extraction results and user-owned Expected answers remain unchanged.

Select **Apply** to update the open draft once. Select **Save** to persist it. Explain-only requests do not stage edits. Assistance does not implicitly run extraction, create Expected answers, change scores, or measure accuracy improvements.

Draft edits, JSON imports, saves, Template switches, and new drafts invalidate previous requests. Workspace or session changes and navigation away from Templates also invalidate them. Restoring the same text does not restore a proposal. Regenerate a stale proposal from the current draft.

Closing the Assistant cancels its request and clears temporary evidence and explanations. Refreshing also clears them.

## Evidence

You can attach one PDF, PNG, JPEG, or WebP sample. You can also select one completed Extraction job from the current Workspace. The job picker loads pages from the server, including Documents outside the browser cache.

A selected job supplies stored results and the historical Template version and fields that produced them. This evidence remains available after Template deletion. The retained original is sent only when you explicitly select it.

You can upload a separate sample instead. The Assistant does not assume that this sample produced the selected job’s results. Each request permits only one binary source.

Result-only analysis works without a retained original. If selected evidence disappears or cannot load, the request fails with an explanatory error. Remove that evidence explicitly to continue without it. The app does not silently omit evidence.

The Assistant distinguishes validation errors, output observations, and model hypotheses or suggestions. Stored results are model output, not verified answers. Evaluate suggestions with verified Expected answers before you conclude that accuracy improved.

## Scope

Assistance is temporary and available only on Templates. It does not keep conversation history, save automatically, or expand the supported schema. It does not migrate historical output identities, relink Expected answers, or provide general protection against concurrent saves.

Auto generate remains available through the magic icon on **Create Template**. It proposes a complete Template from a sample. Assistant requests cannot import temporary Evaluation results or library answers.

Sign in to the Workspace and open **Templates → Assistant** to request suggestions, select completed jobs, and review edits. Scripts can [generate a complete template from a sample](../mkdocs/docs/api/overview.md#generate-a-template-from-a-sample).
