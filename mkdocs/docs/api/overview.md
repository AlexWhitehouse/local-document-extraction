# Workspace API specification

Use the Workspace API to define extraction templates, submit PDFs and images, and retrieve structured data from scripts, applications, and automated workflows. Extraction runs asynchronously: a submission returns a job ID, and the job endpoint provides progress and results.

This page specifies the API available to Workspace API-key clients, including every template and extraction-job endpoint. Account, membership, model-configuration, and live-update endpoints use browser sessions and are outside this integration API.

## Base URL and conventions

The default local base URL is:

```text
http://127.0.0.1:8787
```

Use your deployment's public URL when running behind a reverse proxy. All endpoints below begin with `/v1`.

- Send JSON bodies with `Content-Type: application/json`. File submissions use `multipart/form-data`; let your HTTP client supply the boundary.
- Responses are JSON unless specified otherwise. `204` and `304` responses have no body; exports return an Excel workbook.
- Resource IDs are opaque strings. URL-encode IDs in paths and query values.
- Resource timestamps are UTC ISO 8601 strings. Extracted fields with `data_type: "date"` use `DD/MM/YYYY` instead.
- Optional response values may be `null`. A completed job can contain individual fields that could not be extracted; inspect each result's `status`.

## Authentication and setup

1. Create an account and Workspace in the browser.
2. As a Workspace owner or admin, configure **Workspaces → Model gateway → Set up** with a gateway URL, model name, and gateway credential.
3. Generate a Workspace API key in the app and copy it immediately; the raw key is shown only once.

Authenticate every template and job request with:

```http
Authorization: Bearer <workspace_api_key>
```

The key selects its Workspace, so API-key requests do not need `x-workspace-id`. Keep the key on your server or in your script's secret configuration. Rotating the key invalidates the previous key. The Workspace API key authenticates incoming requests; the model gateway credential is a separate secret used to call your model.

API keys can read and modify templates and shared template tags, submit documents, generate template drafts, read results, delete jobs, and export results in their Workspace. They cannot manage accounts, Workspaces, members, invitations, model configuration, or live updates. Browser clients use a session cookie and `x-workspace-id` for product routes instead.

Missing authentication returns `401 unauthorized`. A supplied but invalid API key returns `403 forbidden`. Resources in another Workspace are not accessible with your key.

Template CRUD and existing result reads do not require a model gateway. Extraction and template generation require a usable Workspace model configuration: missing configuration returns `409 workspace_model_not_configured`; an unreadable saved credential returns `503 workspace_model_configuration_unavailable`. Template generation calls the Workspace's Template assistant model, which is the extraction model unless an owner or admin chose a different one.

## Endpoint index

All template and job endpoints require Workspace authentication. The two service endpoints are public.

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `GET` | `/v1/templates` | List templates | `200` |
| `POST` | `/v1/templates` | Create a template | `201` |
| `GET` | `/v1/templates/{template_id}` | Read a template and its current fields | `200` |
| `PATCH` | `/v1/templates/{template_id}` | Update metadata or replace fields | `200` |
| `DELETE` | `/v1/templates/{template_id}` | Delete a template | `204` |
| `GET` | `/v1/template-tags` | List shared tags and template counts | `200` |
| `PATCH` | `/v1/template-tags/{tag_id}` | Rename a shared tag | `200` |
| `DELETE` | `/v1/template-tags/{tag_id}` | Delete a shared tag and its associations | `204` |
| `POST` | `/v1/templates/generate` | Generate an unsaved template from a sample | `200` |
| `POST` | `/v1/templates/assist` | Explain a draft or propose focused change groups | `200` |
| `POST` | `/v1/templates/assist/suggestions` | Suggest requests for the open draft | `200` |
| `GET` | `/v1/templates/assist/evidence` | Page through completed jobs for assistance | `200` |
| `GET` | `/v1/templates/assist/evidence/{job_id}` | Read authorized historical evidence | `200` |
| `POST` | `/v1/extract` | Submit one document | `202` |
| `GET` | `/v1/jobs/{job_id}` | Read status and completed results | `200`, `304` |
| `GET` | `/v1/jobs` | List and filter job summaries | `200` |
| `GET` | `/v1/jobs/counts` | Read Workspace-wide job totals | `200` |
| `GET` | `/v1/jobs/filter-options` | List model names available for filtering | `200` |
| `DELETE` | `/v1/jobs/{job_id}` | Delete a job and its results | `200` |
| `POST` | `/v1/jobs/export` | Download selected jobs as an Excel workbook | `200` |
| `GET` | `/v1/health` | Check runtime health | `200` |
| `GET` | `/v1/config` | Read public capabilities and default upload limit | `200` |

## Quickstart: document to structured data

These Bash examples require `curl` and `jq`. Set `WORKSPACE_API_KEY` in your environment first. Replace `./invoice.pdf` with your own document.

### 1. Create a template

```bash
API_BASE_URL="http://127.0.0.1:8787"
: "${WORKSPACE_API_KEY:?Set WORKSPACE_API_KEY before running these examples}"

template=$(curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/templates" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "name": "Invoice",
    "description": "Invoice identifiers and totals",
    "fields": [
      {"name": "Invoice Number", "description": "The invoice identifier", "data_type": "string"},
      {"name": "Total", "description": "The final amount payable, including tax", "data_type": "number"}
    ]
  }') || exit 1
TEMPLATE_ID=$(printf '%s' "$template" | jq -er '.template_id') || exit 1
```

### 2. Submit a document

```bash
submission=$(curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/extract" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  --form-string "template_id=$TEMPLATE_ID" \
  -F 'document=@./invoice.pdf;type=application/pdf') || exit 1
JOB_ID=$(printf '%s' "$submission" | jq -er '.job_id') || exit 1
```

### 3. Poll and consume results

This example waits two seconds after submission, then checks every five seconds for up to five minutes. A client timeout leaves the server job running; retain `JOB_ID` to resume polling. Increase the deadline for slower models or larger documents.

```bash
sleep 2
deadline=$((SECONDS + 300))
while (( SECONDS < deadline )); do
  job=$(curl --fail-with-body --silent --show-error \
    "$API_BASE_URL/v1/jobs/$JOB_ID" \
    -H "Authorization: Bearer $WORKSPACE_API_KEY") || exit 1
  status=$(printf '%s' "$job" | jq -er '.status') || exit 1
  case "$status" in
    completed)
      printf '%s' "$job" | jq '.results'
      break
      ;;
    failed)
      printf '%s' "$job" | jq '{job_id, error_code, error_message}' >&2
      exit 1
      ;;
    queued|processing) sleep 5 ;;
    *) printf 'Unexpected job status: %s\n' "$status" >&2; exit 1 ;;
  esac
done
if [[ "$status" != completed ]]; then
  printf 'Polling timed out; resume with job ID %s\n' "$JOB_ID" >&2
  exit 1
fi
```

The example stops on HTTP errors. For production retry and conditional polling behavior, see [Polling, retries, and delivery](#polling-retries-and-delivery).

## Templates

A template defines the fields to extract. Submissions use its current version at submission time; subsequent field changes do not change the fields attached to existing jobs.

### Template request schema

| Property | Type | Create | Description |
| --- | --- | --- | --- |
| `name` | string | Required | Non-empty after trimming. |
| `description` | string or null | Optional | Trimmed description; `null` clears it on update. |
| `tags` | array of strings | Optional | Tag names associated with the template; defaults to `[]` on create. Omit on update to preserve associations, or send `[]` to clear them. |
| `fields` | array of field definitions | Required | Between 1 and 50 fields in extraction order. |

Tag names are lowercased, trimmed, and have repeated whitespace collapsed. Names must remain nonempty after normalization, cannot contain control characters, and may use spaces and punctuation. Each name is limited to 64 characters after normalization, and each supplied array may contain at most 50 names. Duplicate normalized names are deduplicated. For example, `[" INVOICE ", "invoice", "Accounts  Payable"]` becomes `["accounts payable", "invoice"]` on reads. Invalid names or arrays return `400 invalid_tags`.

Saving a template creates any unknown tag names in its Workspace and associates the supplied names with that template. Tags are shared Workspace metadata, separate from field versions. They do not change extraction behavior. See [Manage template tags](#manage-template-tags) for the shared vocabulary.

Each field has:

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Field name; normalized to ASCII letters, digits, and spaces. |
| `description` | string | Yes | Non-empty instructions describing what to extract. |
| `data_type` | string | Yes | One of the types below. |
| `object_schema` | object | No | Table-column guidance for `object` or `array<object>` fields. |

The server generates field IDs from normalized names: `Invoice Number` becomes `invoice_number`. Supplied field IDs do not override this behavior. Names must remain non-empty after normalization, and normalized names and IDs must be unique within the template. Read the saved template to get the actual IDs.

| `data_type` | Successful answer representation |
| --- | --- |
| `string` | JSON string |
| `number` | JSON number; supported numeric strings are normalized |
| `boolean` | JSON boolean; true/false and yes/no strings are normalized |
| `date` | String formatted as `DD/MM/YYYY` |
| `object` | JSON object |
| `array` | JSON array |
| `array<object>` | Array of objects, or a table object with a `rows` array of objects |

Answers can be `null`. An `invalid_type` result can retain the model's original answer rather than conform to the requested type.

A template may contain at most one `object` or `array<object>` field. For predictable table columns, provide `object_schema`:

```json
{
  "name": "Line Items",
  "description": "Each item on the invoice in document order",
  "data_type": "array<object>",
  "object_schema": {
    "data_type": "array<object>",
    "columns": [
      {"heading": "Description", "data_type": "string", "description": "Item description"},
      {"heading": "Amount", "data_type": "number", "description": "Line total"}
    ]
  }
}
```

An object schema requires 1–20 columns with unique generated keys. Each column needs a heading using ASCII letters, digits, and single spaces, a non-empty description, and a type of `string`, `number`, `boolean`, or `date`. If supplied, `object_schema.data_type` must match the field type. The server encodes the schema and table guidance in the saved field's `description` using `[[OBJECT_SCHEMA]]` and `[[OBJECT_TABLE_GUIDANCE]]` blocks; reads do not return a separate `object_schema` property. Preserve these blocks when round-tripping saved fields, or provide a replacement `object_schema`.

### Create a template

`POST /v1/templates`

Send the template request schema as JSON. Success returns `201`:

```json
{"template_id":"tpl_example","version":1,"status":"active"}
```

### List templates

`GET /v1/templates`

Returns `200` with `{"templates": [...]}`. Each item is a template summary with `id`, `name`, `description`, `tags`, `status`, `current_version`, `created_at`, and `updated_at`. Items are ordered by creation time descending. Deleted templates are excluded. There is no pagination and fields are not included; use the detail endpoint to read them.

| Summary property | Type | Meaning |
| --- | --- | --- |
| `id` | string | Template identifier. |
| `name` | string | Display name. |
| `description` | string or null | Template description. |
| `tags` | array of strings | Associated normalized tag names, sorted by name; `[]` when none. |
| `status` | string | Stored lifecycle status: `active`, `archived`, or `deleted`; deleted templates are excluded from reads. This API creates active templates and has no archive operation. |
| `current_version` | integer | Current field-definition version, starting at `1`. |
| `created_at`, `updated_at` | string | UTC ISO 8601 timestamps. |

### Read a template

`GET /v1/templates/{template_id}`

Returns `200` with the summary properties plus ordered `fields` for its current version:

```json
{
  "id": "tpl_example",
  "name": "Invoice",
  "description": "Invoice identifiers and totals",
  "tags": ["finance", "invoice"],
  "status": "active",
  "current_version": 1,
  "created_at": "2026-09-27T12:00:00.000Z",
  "updated_at": "2026-09-27T12:00:00.000Z",
  "fields": [
    {"id":"invoice_number","name":"Invoice Number","description":"The invoice identifier","data_type":"string","position":0},
    {"id":"total","name":"Total","description":"The final amount payable, including tax","data_type":"number","position":1}
  ]
}
```

`position` is zero-based. Notice that reads use `id` and `current_version`, while create/update acknowledgments use `template_id` and `version`. Missing or deleted templates return `404 not_found`.

### Update a template

`PATCH /v1/templates/{template_id}`

Send at least one of `name`, `description`, `tags`, or `fields`. Omitted properties keep their current values. A supplied `tags` array replaces all associations; `[]` clears them without deleting shared tags. A supplied `fields` array replaces the entire field set and increments the version, even if its contents are unchanged. Updating only name, description, or tags keeps the current version.

```json
{"description":"Invoices received from suppliers","tags":["invoice","finance"]}
```

Returns `200` with `{"template_id":"tpl_example","version":1,"status":"active"}`. An empty patch returns `400 empty_patch`; a missing or deleted template returns `404 not_found`. There is no version precondition for template updates.

### Delete a template

`DELETE /v1/templates/{template_id}`

Returns `204` with no body. The template is removed from reads and lists and cannot be used for new submissions. Its tag associations are removed, while shared tags remain available even if unused. Existing jobs and their versioned field definitions remain available. Missing or already deleted templates return `404 not_found`.

### Manage template tags

These endpoints use the same Workspace authentication and access as templates. Tag IDs identify shared vocabulary entries; template create/update and extraction requests use tag **names** instead.

`GET /v1/template-tags` returns `200` with all shared tags in the Workspace, sorted by name, including unused tags:

```json
{
  "tags": [
    {"id":"tag_finance","name":"finance","template_count":2},
    {"id":"tag_invoice","name":"invoice","template_count":0}
  ]
}
```

`template_count` is the number of non-deleted templates associated with the tag. Create shared tags by saving a template with their names in `tags`; there is no separate create endpoint. Removing an association or deleting a template leaves the shared tag available.

`PATCH /v1/template-tags/{tag_id}` renames a tag throughout the Workspace. Send JSON containing `name`:

```json
{"name":"accounts payable"}
```

The same name normalization and 64-character limit apply. Success returns `200` with the updated tag object (`id`, `name`, and `template_count`). A name belonging to another tag returns `409 tag_name_conflict`; the tags are not merged. Renaming changes what template reads return without creating field versions.

`DELETE /v1/template-tags/{tag_id}` removes the shared tag and all its template associations. Success returns `204` with no body. Templates, their fields, and their versions remain available. Missing tags, including tags from another Workspace, return `404 tag_not_found` for rename and delete.

### Generate a template from a sample

`POST /v1/templates/generate`

Send multipart form data:

| Part | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | file | Yes | Exactly one non-empty PDF, PNG, JPEG, or WebP sample. |
| `instructions` | string | No | Extraction guidance, at most 8 KiB. |

```bash
curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/templates/generate" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  -F 'document=@./invoice.pdf;type=application/pdf' \
  --form-string 'instructions=Extract invoice identifiers, totals, and line items'
```

Returns `200` with a draft `{name, description, fields}` payload and `Cache-Control: no-store`. Fields use the saved field representation (`id`, `name`, `description`, `data_type`), including encoded object-schema guidance where applicable. The request waits for generation; it does not create a job or save a template. Review the draft, then send it to `POST /v1/templates` or use its fields in a `PATCH`.

Invalid model proposals receive up to three corrective retries after the initial call. Exhaustion returns `422 template_generation_invalid`. Gateway errors return `502 template_generation_failed` without automatic gateway retries. Other generation failures can return `500 template_generation_failed`. Cancelling the request aborts generation (`499 template_generation_cancelled` if a response can still be delivered). The temporary sample is removed after success, failure, or cancellation.

### Explain a draft or propose focused changes

`POST /v1/templates/assist`

This proposal-only API requires the same Workspace authentication and model readiness as Template generation. It never creates or updates a Template, Extraction job, Expected answer, or Evaluation. Responses, including errors, use `Cache-Control: no-store`.

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

### Suggest assistance requests

`POST /v1/templates/assist/suggestions`

Accepts JSON `{draft, action, jobId?, sampleName?}`, where `action` is `explain` or `edit`. The draft follows the same limits as `POST /v1/templates/assist` and may be incomplete. Returns `{source: "model", suggestions: [{id, label, request, reason}]}` with one to six suggested requests based on the draft, its deterministic diagnostics and any selected job's historical fields and results. Only the sample's name is sent, never its contents, and no Source file is read. Suggestions only prefill the request box; nothing is saved or changed.

The request makes one text-only model call (with at most one corrective retry), shares the Workspace's sequential-call policy, and has a one-minute deadline. It requires a configured model: a missing configuration returns `409 workspace_model_not_configured`. Unsupported model output returns `422 template_suggestions_invalid`, gateway failures return `502 template_suggestions_failed`, and invalid requests return `400 invalid_template_assistance`. Responses use `Cache-Control: no-store`. The Studio falls back to suggestions from its own checks when this endpoint fails.

### Browse assistance evidence

`GET /v1/templates/assist/evidence?limit=20&cursor=...`

Returns `{jobs, next_cursor}` for completed jobs in the authenticated Workspace. `limit` accepts 1–50; `next_cursor` is opaque and null at the end. Items include `job_id`, `original_filename`, `template_id`, `template_version`, `completed_at`, and `source_available`. This list is independent of the browser's Document cache.

`GET /v1/templates/assist/evidence/{job_id}`

Returns the selected job's historical fields and results, Template identity/version/name, and probed `source_available` and `source_limitation`. Unavailable originals do not prevent reading result-only evidence. Both endpoints use `Cache-Control: no-store`, accept session or Workspace API-key authorization, and require no model configuration.

## Document submission

`POST /v1/extract`

Send multipart form data:

| Part | Type | Required | Description |
| --- | --- | --- | --- |
| `template_id` | string | Yes | ID of an active template in the Workspace. |
| `template_tags` | JSON string | No | An array of tag names, such as `["invoice","finance"]`. Validated, then ignored; see below. |
| `document` | file | Yes | Exactly one PDF, PNG, JPEG, or WebP document. |
| `options` | JSON string | No | Accepts boolean `include_confidence` and `include_evidence` properties. See limitation below. |

`template_tags` accepts the same name normalization and limits as template `tags`: an array of at most 50 strings, each nonempty and at most 64 characters after normalization, without control characters. `[]` is valid. Malformed JSON, a non-array value, or invalid names return `400 invalid_template_tags`. Unknown names are allowed and do not create shared tags. This field is not persisted on the job and has no effect on extraction: `template_id` is still required and authoritative, even when its template has none of the supplied tags.

For example, add an optional multipart text field with `--form-string`:

```bash
curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/extract" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  --form-string "template_id=$TEMPLATE_ID" \
  --form-string 'template_tags=["invoice","finance"]' \
  -F 'document=@./invoice.pdf;type=application/pdf'
```

Future automatic template selection and document splitting in [#26](https://github.com/AlexWhitehouse/local-document-extraction/issues/26) and [#27](https://github.com/AlexWhitehouse/local-document-extraction/issues/27) are planned to use **match any** semantics: either supplied tag would include a template in the candidate group. Neither automatic selection nor splitting is implemented by this field today.

**Current options limitation:** the server validates `options`, but does not persist or pass these flags to the extraction runner. They do not control whether confidence or evidence is returned. Both response properties are always present and may be `null`.

Inline `fields` are rejected with `400 inline_fields_forbidden`; save a template first. Unknown or duplicate multipart fields are rejected. Each text part is limited to 8 KiB.

Supported file MIME types are `application/pdf`, `image/png`, `image/jpeg`, and `image/webp`. The default file limit is **10 MiB (10,485,760 bytes)**; deployment configuration or a Workspace override may change it. PDFs must be readable. The complete multipart body is limited to the effective file limit plus 32 KiB for the envelope. An oversized source or multipart body normally returns `400 source_file_too_large`; a reverse proxy or runtime hard limit can reject a much larger request before it reaches the application.

PDF inspection also limits decoded data, parser complexity and processing time, independently of the configured upload limit. PDFs have an additional fixed source ceiling of 32 MiB, a 16 MiB decoded-stream ceiling and a 32 MiB cumulative decoder-allocation budget. A PDF that exceeds those safety limits returns `400 pdf_source_file_limit_exceeded`; a malformed PDF returns `400 invalid_pdf_source_file`. When PDF inspection capacity is temporarily full, the response is `503 pdf_validation_capacity_unavailable`. These checks apply to both Document submission and Template generation, before saving a job or calling the Model gateway.

Success returns `202 Accepted`:

```http
Location: /v1/jobs/job_example
Retry-After: 2
Cache-Control: no-store
```

```json
{
  "job_id": "job_example",
  "status": "queued",
  "source_name": "invoice.pdf",
  "template_id": "tpl_example",
  "template_version": 1
}
```

`202` means the document was queued, not that extraction succeeded. Save `job_id` and poll the detail endpoint. Each accepted submission creates a new job, including repeat submissions of the same file. The API has no idempotency-key support.

## Jobs and results

### Read a job

`GET /v1/jobs/{job_id}`

Returns `200` with the following schema, or `404 not_found` if the job is absent or deleted:

| Property | Type | Meaning |
| --- | --- | --- |
| `job_id` | string | Job identifier. |
| `status` | string | `queued`, `processing`, `completed`, or `failed`. |
| `source_name` | string or null | Uploaded filename. |
| `source_mime_type` | string | Submitted file MIME type. |
| `source_file_page_count` | integer or null | PDF page count; `null` for images. |
| `template_id` | string | Template used for submission. |
| `template_version` | integer | Field-definition version captured at submission. |
| `model_name` | string or null | Model recorded for the attempt; may be absent before processing. |
| `model_configuration_revision` | integer or null | Workspace model-configuration revision used for the attempt. |
| `error_code`, `error_message` | string or null | Operational failure details, including a previous retryable failure. |
| `created_at`, `updated_at` | string | UTC ISO 8601 timestamps. |
| `completed_at` | string or null | Successful completion time; `null` before success or on failure. |
| `current_attempt` | integer | Attempt counter; initially `0`, first processing attempt is `1`. |
| `completed_attempt` | integer | Successful attempt number; `0` before success. |
| `last_failed_attempt` | integer | Most recently failed attempt; initially `0`. |
| `results` | array | Ordered field results when completed; otherwise `[]`. |

A completed response might be:

```json
{
  "job_id": "job_example",
  "status": "completed",
  "source_name": "invoice.pdf",
  "source_mime_type": "application/pdf",
  "source_file_page_count": 1,
  "template_id": "tpl_example",
  "template_version": 1,
  "model_name": "your-model-name",
  "model_configuration_revision": 1,
  "error_code": null,
  "error_message": null,
  "created_at": "2026-09-27T12:01:00.000Z",
  "updated_at": "2026-09-27T12:01:08.000Z",
  "completed_at": "2026-09-27T12:01:08.000Z",
  "current_attempt": 1,
  "completed_attempt": 1,
  "last_failed_attempt": 0,
  "results": [
    {"field_id":"invoice_number","name":"Invoice Number","data_type":"string","status":"ok","answer":"INV-1042","confidence":0.98,"evidence":"Invoice No. INV-1042"},
    {"field_id":"total","name":"Total","data_type":"number","status":"ok","answer":1250.5,"confidence":null,"evidence":null}
  ]
}
```

Each result contains `field_id`, `name`, `data_type`, `status`, `answer`, `confidence` (number or null), and `evidence` (string or null). Results follow template field order. Confidence is model-provided; the server does not enforce a 0–1 range.

Field statuses are `ok`, `not_found`, `invalid_type`, `unreadable`, and `error`. A missing model result becomes `not_found` with a null answer. Treat `invalid_type` answers as unvalidated values. A job with `status: "completed"` is terminal even if some fields have non-`ok` statuses.

### Polling, retries, and delivery

The normal lifecycle is `queued` → `processing` → `completed` or `failed`. Retryable processing failures can return the same job to `queued`. Poll until a terminal status; an `error_code` on a queued job does not mean it is terminal. Each attempt reads the latest Workspace model configuration, while retaining the template version captured at submission.

Job detail responses include `ETag` and `Cache-Control: private, no-cache`. While queued or processing they also include `Retry-After: 5`. Retain the exact ETag and send it in `If-None-Match` on subsequent requests:

```http
GET /v1/jobs/job_example
Authorization: Bearer <workspace_api_key>
If-None-Match: W/"job-v1-<digest-from-previous-response>"
```

An unchanged job returns `304 Not Modified` with no body. Keep the previous representation and wait before polling again. A changed job returns `200` and a new ETag. Stop polling on `completed` or `failed`; terminal responses do not include `Retry-After`.

For automation clients:

- Honor `Retry-After` where provided. Use bounded backoff for temporary `503` responses and a client-side polling deadline.
- Retry safe reads after transport failures. Do not blindly repeat a document submission after a timeout or lost connection: the server may already have accepted it, and a repeat can create a duplicate job.
- Treat a failed job as an application-level failure even though reading it returns HTTP `200`. Inspect `error_code` and `error_message`. Codes can include `processing_error`, `model_gateway_failed`, `retry_exhausted`, `missing_source_file`, and model-configuration errors.
- There is no API-key webhook, live-update stream, or retry-in-place endpoint. To run a terminal job again, submit the original document as a new job after addressing the failure.

Source binaries are temporary: successful source files are removed after processing; failed sources are retained for an operator-configured period (seven days by default). Results remain available until deleted. There is no source-file download endpoint; retain originals in your own system if you need to resubmit them.

### List and filter jobs

`GET /v1/jobs`

| Query parameter | Type | Behavior |
| --- | --- | --- |
| `search` | string | Case-insensitive literal substring match on source filename, job ID, template ID, or status. Trimmed before matching. Does not search extracted answers. |
| `date_from` | `YYYY-MM-DD` | Inclusive lower bound on creation date, in UTC. |
| `date_to` | `YYYY-MM-DD` | Inclusive upper bound on creation date, in UTC. Must be on or after `date_from`. |
| `model` | string | Exact model-name match after trimming; at most 255 characters. |
| `cursor` | string | Opaque continuation token from the preceding page. |

```bash
curl --fail-with-body --silent --show-error --get \
  "$API_BASE_URL/v1/jobs" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  --data-urlencode 'search=invoice' \
  --data-urlencode 'date_from=2026-09-01' \
  --data-urlencode 'date_to=2026-09-30'
```

Returns `200` with:

| Property | Type | Meaning |
| --- | --- | --- |
| `jobs` | array | Job objects with the detail schema above, but `results` is always `[]`, including for completed jobs. |
| `total` | integer | Total jobs in the Workspace, independent of filters. |
| `status_counts` | object | Workspace-wide integer counts for `queued`, `processing`, `completed`, and `failed`, independent of filters. |
| `next_cursor` | string or null | Token for the next page, or `null` at the end. |
| `has_more` | boolean | Whether another page is available. |

Jobs are ordered by `created_at` descending, then job ID descending. The default server page size is 50; there is no client `limit`, page-number, or sort parameter. There is no dedicated `status` query parameter; use `search` for status text if appropriate.

Pass `next_cursor` with the same filters to read the next page, and keep the same Workspace. Changing filters, modifying the token, or using a cursor after a server restart returns `400 invalid_cursor`; restart from the first page. Pagination is not a frozen snapshot of the Workspace. Fetch individual jobs to retrieve their results.

### Read job counts

`GET /v1/jobs/counts`

Returns `200` with Workspace-wide totals and `Cache-Control: no-store`:

```json
{"total":12,"status_counts":{"queued":2,"processing":1,"completed":8,"failed":1}}
```

### Read available model filters

`GET /v1/jobs/filter-options`

Returns `200` with distinct, non-empty model names recorded on jobs, sorted case-insensitively:

```json
{"available_models":["model-a","model-b"]}
```

### Delete a job

`DELETE /v1/jobs/{job_id}`

Deletes the job and its results, coordinates cancellation of active work, and schedules cleanup of its source file if immediate cleanup fails. Success returns `200`:

```json
{"deleted":true,"job_id":"job_example"}
```

Subsequent reads or deletes return `404 not_found`. Deletion is permanent. A concurrent deletion may return `409 job_deleting` or `409 workspace_deleting`.

### Export jobs

`POST /v1/jobs/export`

Send a JSON object containing `job_ids`, a non-empty array of at most 500 non-empty strings:

```json
{"job_ids":["job_example","job_another"]}
```

Duplicate IDs are deduplicated. Only completed and failed jobs in the authenticated Workspace are included; missing, queued, and processing jobs are skipped. If none are exportable, the response is `409 no_exportable_jobs`. Selected stored result payloads must fit within the 32 MiB export limit, otherwise the response is `413 export_too_large`.

Success is a binary `200` response with these headers:

```http
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="<generated-filename>.xlsx"
Cache-Control: no-store
X-Exported-Job-Count: 2
X-Skipped-Job-Count: 0
```

```bash
curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/jobs/export" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  -H 'Content-Type: application/json' \
  --data "{\"job_ids\":[\"$JOB_ID\"]}" \
  --output results.xlsx
```

The runtime permits two simultaneous exports. Additional exports return `503 export_capacity_unavailable` with `Retry-After: 2`. Use job detail JSON for direct programmatic result consumption.

## Service endpoints

### Health

`GET /v1/health` — no authentication required.

Returns `200` with `ok: true`, `service: "document-extraction-api"`, and an optional `diagnostics` object containing runtime metrics. Diagnostics can change with runtime versions. A successful health response does not verify a Workspace's model gateway or guarantee extraction success.

### Public configuration

`GET /v1/config` — no authentication required.

Returns `200` with `Cache-Control: no-store`. A default local installation returns:

```json
{
  "auth": {
    "emailPasswordEnabled": true,
    "googleEnabled": false,
    "signupEnabled": true,
    "requireEmailVerification": false,
    "mailDelivery": "local"
  },
  "limits": {"maxSourceFileBytes":10485760}
}
```

Authentication properties reflect deployment settings; `mailDelivery` is `local` or `cloudflare`. `limits.maxSourceFileBytes` is the deployment default, not any Workspace-specific override. No gateway credentials or Workspace API keys are exposed.

## Errors and limits

Application errors use this JSON envelope:

```json
{
  "error": {
    "code": "invalid_json",
    "message": "Request body must be valid JSON"
  }
}
```

Branch on both HTTP status and `error.code`; treat `message` as human-readable context. Failed extraction jobs use `error_code` and `error_message` inside the job representation instead. Infrastructure errors from a reverse proxy or a hard request-size limit may have a different body.

| HTTP status | Codes | Meaning / client action |
| --- | --- | --- |
| `400` | `invalid_json`, `invalid_request_body` | Correct the request body. |
| `400` | `invalid_name`, `invalid_description`, `invalid_tags`, `invalid_fields`, `empty_patch` | Correct template properties, tag names, or field definitions. |
| `400` | `invalid_document`, `invalid_pdf_source_file`, `invalid_template_id` | Supply a supported document and a non-empty template ID. |
| `400` | `invalid_multipart`, `invalid_options`, `invalid_template_tags`, `inline_fields_forbidden` | Correct multipart fields, boundaries, or options. |
| `400` | `source_file_too_large` | Reduce the file/request size or ask the operator about limits. |
| `400` | `submission_aborted` | The upload was interrupted. |
| `400` | `invalid_job_filters`, `invalid_cursor` | Correct filters or restart pagination. |
| `400` | `invalid_job_export` | Supply a non-empty array of job IDs. |
| `401` | `unauthorized` | Supply authentication. |
| `403` | `forbidden` | Check the API key or Workspace access. |
| `404` | `not_found`, `template_not_found`, `tag_not_found` | Check the resource ID and route; submission requires an active template. |
| `409` | `workspace_model_not_configured` | Ask a Workspace owner/admin to configure the model gateway. |
| `409` | `workspace_deleting`, `job_deleting` | The resource is being deleted. |
| `409` | `tag_name_conflict` | Rename the shared tag to an unused name; renaming does not merge tags. |
| `409` | `no_exportable_jobs` | Select completed or failed jobs. |
| `413` | `request_body_too_large`, `export_too_large` | Reduce the JSON body or export selection. |
| `415` | `unsupported_media_type` | Use multipart form data for extraction or template generation. |
| `422` | `template_generation_invalid` | The model could not produce a valid template after corrective retries. |
| `499` | `template_generation_cancelled` | Template generation was cancelled. |
| `500` | `document_submission_failed`, `job_export_failed`, `template_generation_failed`, `internal_error` | Server-side failure; investigate before repeating a mutation. |
| `502` | `template_generation_failed` | Template generation's model gateway request failed. |
| `503` | `runtime_starting` | Wait for startup; honor `Retry-After`. |
| `503` | `local_runtime_shutting_down` | The runtime is stopping; reconnect after it restarts. |
| `503` | `local_submission_capacity_unavailable`, `local_product_store_capacity_unavailable`, `export_capacity_unavailable` | Temporary capacity limit; back off using `Retry-After`. |
| `503` | `local_product_store_unavailable` | Workspace storage is unavailable; retry later or contact the operator. |
| `503` | `workspace_model_configuration_unavailable` | The saved gateway credential cannot be read; an owner/admin must replace it. |

Non-file API request bodies have a default limit of **1 MiB**, configurable with `MAX_JSON_REQUEST_BYTES`. File requests use the separate limits described under [Document submission](#document-submission). Capacity is bounded by the local runtime; there is no advertised fixed requests-per-minute quota.
