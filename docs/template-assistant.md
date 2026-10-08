# Template assistant

Open a new or existing draft on **Templates** and select **Assistant**. Ask a question, such as “why is Total often empty?”, or describe a change, such as “add VAT rate to each line item.” The request is optional: select **Review draft** with an empty request to have the assistant review the draft and its evidence and propose fixes for the problems it finds.

A question gets an answer, and edits only when a change would address it. Proposed edits are always optional; you choose which to apply.

Requests use the Workspace’s Template assistant model. This role inherits the extraction model unless an owner or admin selects another model under **Workspaces → Model gateway**.

The panel suggests requests from the draft, its problems, and any selected job. It makes one short text-only model call after relevant changes and a pause. Relevant changes include draft structure, descriptions, or evidence. Typing your request does not refresh suggestions. Selecting a suggestion fills the request and submits it in one step. To change the wording first, select the edit icon beside the suggestion; it only fills the request. If the model is unavailable or unconfigured, suggestions use application validation.

Suggestions list possible problems first, then useful additions:

- **Possible problems.** Application validation errors are confirmed problems. Other concerns, such as ambiguous instructions or unclear formats, are phrased as requests to check or fix a named field.
- **Attached evidence.** With a completed document attached, suggestions start with the fields its result shows were not found, invalid, unreadable or below 60% confidence. With Evaluation results attached, they start with the fields that failed verified expected answers.
- **Additions.** Missing fields or table columns, each with a proposed name, type, extraction instructions, and a reason based on the current Template.

Insufficient context can produce no suggestions. Suggestions use an attached sample’s name, never its contents. They cannot report observations from that file.

Validation messages appear beside the affected Template name, field, or table column. Each explains the problem and corrective action. Select a problem control to focus its input. These controls also work in the Evaluation Template editor and without a configured model.

## Review and apply

An edit request returns change groups with reasons and before/after values. Select the required groups. Dependent changes must be selected together. All changes in one group apply together. Conflicts or an invalid combined draft disable **Apply**.

Field names determine output IDs. Table headings determine column keys. Before a rename, removal, or type change, review the identity and type warnings. These changes affect future extraction output and Evaluation alignment. Historical Extraction results and user-owned Expected answers remain unchanged.

Select **Apply** to update the open draft once. Select **Save** to persist it. An answer with no proposed changes stages nothing. Assistance does not implicitly run extraction, create Expected answers, change scores, or measure accuracy improvements. In an Evaluation, **Test changes** runs the edits on a copy of the candidate and measures the difference; see [Evaluations](evaluations.md#improve-failing-fields).

Draft edits, JSON imports, saves, Template switches, and new drafts invalidate previous requests. Workspace or session changes and navigation away from Templates also invalidate them. Restoring the same text does not restore a proposal. Regenerate a stale proposal from the current draft.

Closing the Assistant cancels its request and clears temporary evidence and explanations. Refreshing also clears them.

## Evidence

You can attach one PDF, PNG, JPEG, or WebP sample. You can also select one completed Extraction job from the current Workspace. The job picker loads pages from the server, including Documents outside the browser cache.

A selected job supplies stored results and the historical Template version and fields that produced them. This evidence remains available after Template deletion. The retained original is sent only when you explicitly select it.

You can upload a separate sample instead. The Assistant does not assume that this sample produced the selected job’s results. Each request permits only one binary source.

Result-only analysis works without a retained original. If selected evidence disappears or cannot load, the request fails with an explanatory error. Remove that evidence explicitly to continue without it. The app does not silently omit evidence.

The Assistant distinguishes validation errors, output observations, and model hypotheses or suggestions. Stored results are model output, not verified answers. Evaluate suggestions with verified Expected answers before you conclude that accuracy improved.

### From a document

On a completed document, select **Improve template**. The action appears when the document’s template still exists. It opens that template on **Templates** with the Assistant open. The document is selected as evidence, with its retained original when one was kept. Its card lists the fields that were not found, invalid, unreadable or low confidence, and suggestions start with them. The request names fields that were not found, invalid, unreadable or below 60% confidence. Otherwise it asks for general improvements. If the document was extracted with an older version, the evidence shows the version difference as usual.

The prepared request lives in the open tab only. It is not part of the URL, so refreshing or opening the link elsewhere opens the template without the Assistant.

### Evaluation results

In an Evaluation, the Assistant docks to the right of the evaluation, as on Templates. A candidate’s **⋯** menu opens it with **Ask assistant**, or with **Improve failing fields**, which attaches the candidate’s evaluation results as evidence. For each document, they list the failing and partly correct fields only, with the candidate’s value, the verified expected answer and the comparison result. Table fields send their mismatched cells and missing or extra rows. The evidence also names the candidate’s model and template and its overall accuracy.

Only verified expected answers are sent. Unverified answers are never scored, so they are left out. For this evidence the model treats verified expected answers as ground truth for their documents; candidate values remain model output. The rule for document results is unchanged.

Evaluation evidence is limited to 128 KiB. Long values keep their first 1,000 characters. At most 50 documents, 100 failing fields per document and 40 mismatched cells per table are sent. If the evidence is still too large, failing fields are removed from the end, last document first, and the panel says how many were left out. The same results always produce the same evidence.

Evaluation evidence needs no completed document or file. You can also send the original of one failing document: choose **Original** under **File sent to the model**. It is the open document when that one fails, otherwise the first failing document. A saved library document’s original is downloaded for the request; an upload uses the file already in the tab. Evaluation evidence can’t be combined with a completed document.

## Scope

Assistance is temporary. It is available on Templates and on Evaluations. It does not keep conversation history, save automatically, or expand the supported schema. It does not migrate historical output identities, relink Expected answers, or provide general protection against concurrent saves.

Auto generate remains available through the magic icon on **Create Template**. It proposes a complete Template from a sample. Evaluation results reach the Assistant only through **Improve failing fields**. The server never reads the Evaluation library for assistance: the browser sends the verified answers, and an original only when you choose it.

Sign in to the Workspace and open **Templates → Assistant** to request suggestions, select completed jobs, and review edits. Scripts can [generate a complete template from a sample](../mkdocs/docs/api/overview.md#generate-a-template-from-a-sample).
