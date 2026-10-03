# Template assistant

Open a new or existing draft on **Templates**, then select **Assistant**. Use **Explain issues** to ask about the draft, or **Propose edits** to describe a focused change, such as “add VAT rate to each line item.” Requests use the current Workspace's Template assistant model: the extraction model, unless an owner or admin chose a different one under **Workspaces → Model gateway**. While you compose a request, the panel asks the model for suggested requests based on the open draft, its problems and any selected job (one short, text-only call, refreshed after a pause when the draft structure, descriptions, tab or evidence changes). Typing your Assistant request does not refresh suggestions. Choosing a suggestion only fills in the request; the explanation or edit request is sent when you submit it. If no model is configured or the call fails, suggestions come from the app’s own checks.

**Explain issues** suggestions focus on existing fields and columns. App validation errors are confirmed checks; concerns inferred from instructions or stored results are phrased as review questions about potential issues. **Propose edits** suggestions focus on missing fields or table columns, with a proposed name, type, extraction instructions, and a reason based on the current Template. You can still type any focused edit request, including fixes or renames. Suggestions may be empty when there is insufficient context. Suggestion generation receives only an attached sample's name, never its contents, so it cannot report observations from that file.

Validation problems appear beside the affected Template name, field, or table column. Each problem explains what is wrong and how to fix it; the problem controls take you to the input. These checks also work in the Evaluation Template editor and without a configured model.

## Review and apply

An edit request returns change groups with a rationale and before/after values. Select the groups you want. Changes that depend on each other must be selected together, and changes within one group apply together. Apply stays unavailable when the combined selection conflicts or leaves the draft invalid.

Field names determine output IDs, and table headings determine column keys. Review the identity and type warnings before applying a rename, removal, or type change. These changes affect future extraction output and Evaluation alignment. Historical Extraction results and user-owned Expected answers remain unchanged.

**Apply** updates the open draft once. Use the existing **Save** action to persist it. Explain-only requests do not stage edits. Nothing runs extraction, creates Expected answers, changes scores, or measures an accuracy improvement implicitly.

Editing, importing JSON, saving, switching Templates, starting a new draft, changing Workspace or session, and leaving the Templates page invalidate previous requests. Restoring the same text does not revive a proposal. Regenerate against the current draft when a proposal is stale. Closing the Assistant cancels its request and clears its temporary evidence and explanations; refreshing also clears them.

## Evidence

You can attach one PDF, PNG, JPEG, or WebP sample and select one completed Extraction job from the current Workspace. The job picker loads pages from the server, so it can find Documents outside the browser's cache.

A selected Extraction job supplies its stored results and the historical Template version and fields used to produce them, even when that Template was subsequently deleted. Its retained original is sent only when you choose it. You may instead upload a separate sample; a separate sample is not assumed to be the source of the stored result. Only one binary source may be sent in a request.

Result-only analysis works without a retained original. If evidence you selected disappears or cannot be loaded, the request fails with a useful error; explicitly remove that evidence to proceed without it. Evidence is never silently dropped.

Deterministic validation errors, observations about supplied output, and model hypotheses or suggestions are distinct. Stored results are model output, not verified answers. Suggestions should be evaluated with verified Expected answers before drawing conclusions about accuracy.

## Scope

Assistance is temporary and available only on Templates. It does not maintain a conversation history, save autonomously, change the supported schema, migrate historical output identities, relink Expected answers, or provide general concurrent-save protection. The sample-based Auto generate flow (the magic icon on **Create Template**) remains available for proposing a complete Template. Temporary Evaluation results and library answers cannot be imported into Assistant requests.

Sign in to the Workspace and open **Templates → Assistant** to get suggestions, select completed jobs as evidence, and review proposed edits. Scripts can [generate a complete template from a sample](../mkdocs/docs/api/overview.md#generate-a-template-from-a-sample).
