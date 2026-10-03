# Template assistant frontend HTTP contract

This is a contributor reference for the Studio frontend, not the public Workspace API. The entire `/v1/templates/assist` family requires a signed-in user session and an `x-workspace-id` header selecting an accepted Workspace. Mutations also use the normal trusted-Origin checks. A Workspace API key cannot authorize these operations. Sample-based generation through `/v1/templates/generate` remains available to Workspace API clients.

## Explain a draft or propose focused changes

`POST /v1/templates/assist`

This proposal-only frontend operation requires a signed-in user session, accepted Workspace membership, and model readiness. It does not accept Workspace API-key authorization. It never creates or updates a Template, Extraction job, Expected answer, or Evaluation. Responses, including errors, use `Cache-Control: no-store`.

Send multipart form data with exactly one `payload` text part and at most one `document` file. `payload` is JSON:

```json
{
  "draft": {"name":"Invoice","description":"Invoice totals","fields":[{"name":"Total","description":"Final amount due","data_type":"number"}]},
  "action": "edit",
  "instructions": "Explain how to capture the currency in a separate field and propose it.",
  "base": {"editorId":"editor_123","revision":7,"requestId":2,"scopeGeneration":1,"templateId":"tpl_example"},
  "jobId": "job_example",
  "useRetainedSource": false
}
```

`action` is `explain` or `edit`; edit requests require nonempty instructions. The bounded raw draft may be incomplete or invalid. `base` is an opaque client application guard: `editorId` identifies an editor, `templateId` identifies the target (empty for a new draft), and the other properties are nonnegative safe integer counters. The server echoes it; clients must reject responses and Apply actions unless the editor, session, Workspace, target, request and exact draft revision still match. Increment counters for intervening edits and scope changes even if text later becomes identical. This is not a precondition for ordinary Template saves.

`jobId` and `useRetainedSource` are optional. The server resolves a completed job in the authenticated Workspace and supplies its actual historical fields, Template version and stored results. A deleted Template does not prevent reading the job's version. `useRetainedSource: true` requires `jobId` and explicitly includes its retained original. It cannot be combined with an uploaded `document`. A separate upload is labeled as a separate sample, not assumed to be the selected result's source. Missing or inaccessible chosen evidence fails the request; it is never silently omitted.

The response contains:

| Property | Meaning |
| --- | --- |
| `base` | Exact client guard echoed from the request. |
| `diagnostics` | Deterministic errors with stable `code`, `severity`, `location`, `title`, `explanation`, and `remedy`; field and column positions work without unique names. |
| `evidence` | `job` historical snapshot or null; `source` is `retained_source_of_selected_job`, `separate_uploaded_sample`, or `no_binary_source_supplied`; `sample_name` and `limitation` describe what was supplied. |
| `explanation` | Plain-language explanation; not a verified diagnosis of extraction accuracy. |
| `observations` | Labeled `observation`, `hypothesis`, or `suggestion` entries, with validated structured references. |
| `groups` | Focused changes, each with `id`, `title`, `rationale`, `dependsOn`, and `operations`. Explain-only responses contain no groups. |

Operations are `set_template`, `add_field`, `update_field`, `remove_field`, `add_column`, `update_column`, and `remove_column`. Existing targets use zero-based positions in the captured base plus exact `expectName` and, for existing columns, `expectHeading`. Additions use `after` as a base position (`-1` inserts first; null appends). Updates carry only explicitly changed properties in `set`. A group applies atomically; selected groups must satisfy dependencies, avoid conflicting writes, and produce a draft valid under the same rules as manual saving. Preserve unrelated raw values and ordering. Show all changed values and output-identity/type impacts, consume a proposal after Apply, and require an explicit save afterward.

Limits are 64 KiB for the serialized draft, 4 KiB for instructions, 80 KiB for the multipart payload, 128 KiB for historical evidence, 64 KiB for model content, and 512 KiB for the gateway response envelope. Oversized evidence returns `413 template_assistance_evidence_too_large`; it is not truncated. Samples follow the configured Source file size, MIME, PDF page and inspection limits. Text-only requests share resource admission and the Workspace's sequential-call policy with source-backed model work. The whole request has a deadline bounded by the configured model timeout and five minutes. Temporary sample files are released after success, failure, or cancellation; retained originals are never changed.

Invalid drafts may contain at most 100 fields, 100 columns in one field, and 200 columns in total, with diagnostics bounded to 128 KiB; these request safety limits do not expand the valid Template schema of 50 fields and 20 columns. A response allows at most 20 groups, 25 operations per group, 100 operations total, and 20 observations with at most 20 references each. Unsupported keys, ambiguous targets, overlapping writes, cyclic or missing dependencies, fabricated references, and over-limit output are rejected whole.

Invalid model output receives at most two corrective retries (three total attempts), then returns `422 template_assistance_invalid`. Gateway failures return `502 template_assistance_failed`. Invalid requests return `400 invalid_template_assistance`. Unavailable selected jobs return `404 template_assistance_evidence_unavailable`; retained Source failures use `source_not_retained`, `source_missing`, or `source_unavailable`. Cancelled or expired requests return `499 template_assistance_cancelled` when a response can still be delivered. Remove failed evidence explicitly before requesting reduced-evidence analysis.

## Suggest assistance requests

`POST /v1/templates/assist/suggestions`

Accepts JSON `{draft, action, jobId?, sampleName?}`, where `action` is `explain` or `edit`. The draft follows the same limits as `POST /v1/templates/assist` and may be incomplete. Returns `{source: "model", suggestions: [{id, label, request, reason}]}` with zero to six suggested requests based on the complete draft, its deterministic diagnostics and any selected job's historical fields and results. An empty list is a successful response when no grounded suggestions are available. Only the sample's name is sent, never its contents, and no Source file is read. Suggestions only prefill the request box; nothing is saved or changed.

The system prompt includes only the selected tab's instructions. `explain` prioritizes supplied validation diagnostics and asks review questions about potential issues in existing fields or columns; only deterministic diagnostics may be described as confirmed Template validation errors. `edit` suggests missing fields or columns with concrete names, supported types, extraction instructions and a contextual rationale, excluding repairs and equivalent information already captured. These rules scope suggestion generation, not manually entered edit requests. The frontend refreshes suggestions after debounced changes to Template, field or column descriptions as well as structure, tab and evidence, and discards superseded responses.

The request makes one text-only model call (with at most one corrective retry), shares the Workspace's sequential-call policy, and has a one-minute deadline. It requires a configured model: a missing configuration returns `409 workspace_model_not_configured`. Unsupported model output returns `422 template_suggestions_invalid`, gateway failures return `502 template_suggestions_failed`, and invalid requests return `400 invalid_template_assistance`. Responses use `Cache-Control: no-store`. The Studio falls back to suggestions from its own checks when this endpoint fails.

## Browse assistance evidence

`GET /v1/templates/assist/evidence?limit=20&cursor=...`

Returns `{jobs, next_cursor}` for completed jobs in the authenticated Workspace. `limit` accepts 1–50; `next_cursor` is opaque and null at the end. Items include `job_id`, `original_filename`, `template_id`, `template_version`, `completed_at`, and `source_available`. This list is independent of the browser's Document cache.

`GET /v1/templates/assist/evidence/{job_id}`

Returns the selected job's historical fields and results, Template identity/version/name, and probed `source_available` and `source_limitation`. Unavailable originals do not prevent reading result-only evidence. Both endpoints use `Cache-Control: no-store`, require user-session authorization and accepted Workspace membership, and require no model configuration.
