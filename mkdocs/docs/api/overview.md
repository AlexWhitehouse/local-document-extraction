# Workspace API specification

Use the Workspace API to define templates, submit PDFs and images, and retrieve structured data. Scripts, applications, and automated workflows can use these operations. Processing is asynchronous. Submission returns a job ID or, for PDFs with Smart splitting enabled, a packet ID. Poll the returned location, then read completed jobs for results.

This reference covers Workspace API-key endpoints. For browser procedures, see [Accounts and Workspaces](../usage/accounts-and-workspaces.md), [Templates](../usage/templates.md), and [Document extraction](../usage/document-extraction.md).

## Base URL and conventions

The default local base URL is:

```text
http://127.0.0.1:8787
```

Behind a reverse proxy, use the deployment’s public URL. All listed endpoints start with `/v1`.

- Send JSON bodies with `Content-Type: application/json`. File submissions use `multipart/form-data`; let your HTTP client supply the boundary.
- Responses use JSON unless specified otherwise. Responses with `204` or `304` have no body. Exports contain Excel workbooks. Source reads contain document binaries. Page previews contain PNG images.
- Resource IDs are opaque strings. URL-encode IDs in paths and query values.
- Resource timestamps are UTC ISO 8601 strings. Extracted fields with `data_type: "date"` use `DD/MM/YYYY` instead.
- Optional values can be `null`. Completion does not guarantee successful extraction of every field. Inspect each result’s `status`.

## Authentication and setup

1. Create an account and Workspace in the browser.
2. As an owner or admin, open **Workspaces → Model gateway → Set up**. Enter the gateway URL, model name, and gateway credential.
3. Generate a Workspace API key in the app. Copy it immediately; the app shows the raw key once.

Authenticate every template, job, and packet request with:

```http
Authorization: Bearer <workspace_api_key>
```

The key identifies its Workspace. Store it on your server or in your script’s secret configuration. Rotation invalidates the previous key. The Workspace API key authenticates incoming requests. The separate model gateway credential authenticates outgoing model calls.

API keys permit template and shared-tag management, document submission, template generation, result reads, and processing-setting reads. They also permit job and packet deletion and result export within the Workspace.

Manage accounts, membership, invitations, and model settings on the app’s **Workspaces** and account pages. Use **Templates → Assistant** for draft assistance. Use **Documents** to review held work.

Missing authentication returns `401 unauthorized`. A supplied but invalid API key returns `403 forbidden`. Resources in another Workspace are not accessible with your key.

Template creation, reads, updates, and deletion do not require a model gateway. Existing result reads also work without a gateway. Extraction and template generation require usable Workspace model settings. Missing settings return `409 workspace_model_not_configured`. An unreadable saved credential returns `503 workspace_model_configuration_unavailable`.

Template generation uses the Template assistant model. This role inherits the extraction model unless an owner or admin selects another model.

## Endpoint index

All endpoints below except health require a Workspace API key. The health endpoint is public.

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
| `POST` | `/v1/extract` | Submit one document or PDF packet | `202` |
| `GET` | `/v1/document-processing-settings` | Read effective Workspace processing switches | `200` |
| `GET` | `/v1/packets` | List document packets with paging | `200` |
| `GET` | `/v1/packets/{packet_id}` | Read split progress, plan and child jobs | `200` |
| `GET` | `/v1/packets/{packet_id}/pages/{page}/preview` | Preview a selected physical page | `200` |
| `GET`, `HEAD` | `/v1/packets/{packet_id}/source` | Read the packet original when available | `200` |
| `DELETE` | `/v1/packets/{packet_id}` | Delete the packet and all children | `200` |
| `GET` | `/v1/jobs/{job_id}` | Read status and completed results | `200`, `304` |
| `GET`, `HEAD` | `/v1/jobs/{job_id}/source` | Read a retained or held document source | `200` |
| `GET` | `/v1/jobs` | List and filter job summaries | `200` |
| `GET` | `/v1/jobs/counts` | Read Workspace-wide job totals | `200` |
| `GET` | `/v1/jobs/filter-options` | List model names available for filtering | `200` |
| `DELETE` | `/v1/jobs/{job_id}` | Delete a job and its results | `200` |
| `POST` | `/v1/jobs/export` | Download selected jobs as an Excel workbook | `200` |
| `GET` | `/v1/health` | Check runtime health | `200` |

## Quickstart: document to structured data

These Bash examples require `curl` and `jq`. Set `WORKSPACE_API_KEY` in the environment. Replace `./invoice.pdf` with your document. The examples use explicit template selection and the default disabled Smart splitting setting. With splitting enabled, use the [packet response contract](#document-packets-and-review).

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

The example waits two seconds after submission, then polls every five seconds for at most five minutes. A client timeout leaves the server job running. Keep `JOB_ID` to resume polling. Increase the deadline for slower models or larger documents.

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

A template defines extraction fields. Explicit submissions fix the current template version during submission. Automatic or manual selection fixes the version when the choice is accepted. Later field changes do not alter an existing binding.

### Template request schema

| Property | Type | Create | Description |
| --- | --- | --- | --- |
| `name` | string | Required | Non-empty after trimming. |
| `description` | string or null | Optional | Trimmed description; `null` clears it on update. |
| `tags` | array of strings | Optional | Tag names associated with the template; defaults to `[]` on create. Omit on update to preserve associations, or send `[]` to clear them. |
| `fields` | array of field definitions | Required | Between 1 and 50 fields in extraction order. |

The app converts tag names to lowercase, trims whitespace, and collapses repeated whitespace. Normalized names must be nonempty and must not contain control characters. Spaces and punctuation are permitted. Limits are 64 characters per normalized name and 50 names per supplied array. The app removes duplicate normalized names.

For example, `[" INVOICE ", "invoice", "Accounts  Payable"]` reads as `["accounts payable", "invoice"]`. Invalid names or arrays return `400 invalid_tags`.

Saving a template creates unknown tag names in its Workspace and associates the supplied tags. Tags are shared Workspace metadata, separate from field versions. They define automatic-selection candidates when a submission supplies tags instead of a Template ID. They do not change fields or existing job bindings. See [Manage template tags](#manage-template-tags).

Each field has:

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Field name; normalized to ASCII letters, digits, and spaces. |
| `description` | string | Yes | Non-empty instructions describing what to extract. |
| `data_type` | string | Yes | One of the types below. |
| `object_schema` | object | No | Table-column guidance for `object` or `array<object>` fields. |

The server generates field IDs from normalized names. For example, `Invoice Number` becomes `invoice_number`. Supplied IDs do not override generation. Names must remain nonempty after normalization. Normalized names and IDs must be unique within the template. Read the saved template for its actual IDs.

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

An object schema requires 1–20 columns with unique generated keys. Each column needs a heading with ASCII letters, digits, and single spaces. It also requires a nonempty description and a `string`, `number`, `boolean`, or `date` type. If supplied, `object_schema.data_type` must match the field type.

The server encodes schema and table guidance in the saved field’s `description`, inside `[[OBJECT_SCHEMA]]` and `[[OBJECT_TABLE_GUIDANCE]]` blocks. Reads do not return a separate `object_schema` property. Preserve these blocks when resubmitting saved fields, or supply a replacement `object_schema`.

### Create a template

`POST /v1/templates`

Send the template request schema as JSON. Success returns `201`:

```json
{"template_id":"tpl_example","version":1,"status":"active"}
```

### List templates

`GET /v1/templates`

Returns `200` with `{"templates": [...]}`. Each summary contains `id`, `name`, `description`, `tags`, `status`, `current_version`, `created_at`, and `updated_at`. Results use descending creation order and exclude deleted templates. This endpoint has no pagination and omits fields. Use the detail endpoint for fields.

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

`position` is zero-based. Reads use `id` and `current_version`. Create and update acknowledgments use `template_id` and `version`. Missing or deleted templates return `404 not_found`.

### Update a template

`PATCH /v1/templates/{template_id}`

Send at least one of `name`, `description`, `tags`, or `fields`. Omitted properties keep their values. A supplied `tags` array replaces all associations. An empty `[]` clears associations without deleting shared tags.

A supplied `fields` array replaces all fields and increments the version, even when contents are unchanged. Name, description, and tag updates alone preserve the version.

```json
{"description":"Invoices received from suppliers","tags":["invoice","finance"]}
```

Returns `200` with `{"template_id":"tpl_example","version":1,"status":"active"}`. An empty patch returns `400 empty_patch`. A missing or deleted template returns `404 not_found`. Template updates have no version precondition.

### Delete a template

`DELETE /v1/templates/{template_id}`

Returns `204` without a body. The template disappears from reads and lists and cannot accept new submissions. Deletion removes tag associations but preserves shared tags, including unused tags. Existing jobs and versioned field definitions remain available. Missing or previously deleted templates return `404 not_found`.

### Manage template tags

Tag endpoints use template authentication and access rules. Tag IDs identify shared vocabulary entries. Template create/update and extraction requests use tag **names**.

`GET /v1/template-tags` returns `200` with all shared tags in the Workspace, sorted by name, including unused tags:

```json
{
  "tags": [
    {"id":"tag_finance","name":"finance","template_count":2},
    {"id":"tag_invoice","name":"invoice","template_count":0}
  ]
}
```

`template_count` counts associated templates that are not deleted. Create shared tags by saving their names in a template’s `tags`. There is no separate create endpoint. Removing an association or deleting a template preserves the shared tag.

`PATCH /v1/template-tags/{tag_id}` renames a tag throughout the Workspace. Send JSON containing `name`:

```json
{"name":"accounts payable"}
```

Name normalization and the 64-character limit also apply here. Success returns `200` with `id`, `name`, and `template_count`. Another tag’s name returns `409 tag_name_conflict`; tags do not merge. Renaming changes template read responses without creating field versions.

`DELETE /v1/template-tags/{tag_id}` deletes the shared tag and all its associations. Success returns `204` without a body. Templates, fields, and versions remain available. Rename and delete return `404 tag_not_found` for missing tags or tags in another Workspace.

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

Returns `200` with a draft `{name, description, fields}` payload and `Cache-Control: no-store`. Fields use the saved representation: `id`, `name`, `description`, and `data_type`. This includes encoded object-schema guidance where applicable. The request waits for generation without creating a job or saving a template. Review the draft, then send it to `POST /v1/templates` or use its fields in a `PATCH`.

Invalid model proposals receive at most three corrective retries after the initial call. Exhaustion returns `422 template_generation_invalid`. Gateway errors return `502 template_generation_failed` without automatic gateway retries. Other failures can return `500 template_generation_failed`.

Canceling the request aborts generation. If a response remains possible, it returns `499 template_generation_cancelled`. The app removes the temporary sample after success, failure, or cancellation.

## Document submission

`POST /v1/extract`

Send multipart form data:

| Part | Type | Required | Description |
| --- | --- | --- | --- |
| `template_id` | string | ID or nonempty tags | ID of an active, usable template in the Workspace. An explicit ID takes precedence over tags. |
| `template_tags` | JSON string | ID or nonempty tags | An array of tag names, such as `["invoice","finance"]`, defining automatic selection candidates when no ID is supplied. |
| `pages` | JSON string | No | PDF-only nonempty array of unique, in-range physical page numbers, such as `[1,2,5]`. Omission uses all pages; original order is preserved. |
| `document` | file | Yes | Exactly one PDF, PNG, JPEG, or WebP document. |
| `options` | JSON string | No | Accepts boolean `include_confidence` and `include_evidence` properties. See limitation below. |

`template_tags` uses the same normalization and limits as template `tags`. Supply at most 50 strings. Each must remain nonempty and at most 64 characters after lowercase conversion, trimming, and whitespace normalization. Control characters are prohibited. Malformed JSON, non-arrays, and invalid names return `400 invalid_template_tags`.

Unknown names are accepted without creating tags. Without a nonempty explicit ID or nonempty tags, submission returns `400 invalid_template_id` before acceptance or model work. An explicitly blank, invalid, or inaccessible ID never falls back to automatic selection.

Without `template_id`, the durable job retains the canonical tag scope. Usable Workspace Templates matching **any** supplied tag are candidates. The classifier receives the document and candidate IDs, names, and descriptions. It does not receive field definitions or guidance. Even a single candidate must fit the document.

A nonempty filter with no candidates waits for manual resolution. It neither calls the classifier nor expands the filter. Explicit IDs take priority over tags, but tag-format validation still applies.

Submission records the Workspace’s **Enable smart splitting** and **Exclude blank pages** settings. Multipart fields and `options` cannot override them. Both default to false. Splitting applies to PDFs; images produce one job. Blank exclusion requires splitting. PDF page selection limits the source before processing and does not override these settings.

For automatic selection, omit `template_id` and supply tags:

```bash
curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/extract" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  --form-string 'template_tags=["invoice","finance"]' \
  --form-string 'pages=[1,2,5]' \
  -F 'document=@./packet.pdf;type=application/pdf'
```

**Current options limitation:** The server validates `options` but does not save these flags or send them to the extraction runner. They do not control confidence or evidence. Both response properties are always present and can be `null`.

Inline `fields` return `400 inline_fields_forbidden`. Save a template first. Unknown or duplicate multipart fields are rejected. Each text part, including `pages`, has an 8 KiB limit.

Supported MIME types are `application/pdf`, `image/png`, `image/jpeg`, and `image/webp`. The default file limit is **10 MiB (10,485,760 bytes)**. Deployment settings or a Workspace override can change it. PDFs must be readable. The complete multipart body permits the file limit plus 40 KiB for the envelope.

An oversized source or body normally returns `400 source_file_too_large`. A proxy or runtime hard limit can reject much larger requests before they reach the application.

PDF inspection separately limits decoded data, parser complexity, and processing time. Fixed limits are 32 MiB per PDF, 16 MiB per decoded stream, and 32 MiB of cumulative decoder allocations. Exceeding these limits returns `400 pdf_source_file_limit_exceeded`. A malformed PDF returns `400 invalid_pdf_source_file`. Full inspection capacity returns `503 pdf_validation_capacity_unavailable`.

These validations apply to Document submission and Template generation. They occur before job storage or Model gateway calls.

With Smart splitting disabled, or for image uploads, success returns `202 Accepted`:

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

`202` confirms acceptance, not successful extraction. Automatic jobs initially have null `template_id` and `template_version`. Binding a suitable Template version sets both values. Save the identifier and poll `Location`.

Repeated uploads create independent work. Submission has no idempotency-key support. With PDF splitting enabled, submission returns a packet as described below.

### Read effective processing settings

`GET /v1/document-processing-settings` accepts the same Workspace authentication and returns the current switches with `Cache-Control: no-store`:

```json
{"enable_smart_splitting":true,"exclude_blank_pages":false}
```

Workspace API keys can read these settings. Owners and admins change them through **Workspaces → Document processing**; see [Document processing](../usage/accounts-and-workspaces.md#document-processing).

Submission records the effective values at acceptance. A concurrent settings change can affect the next submission. Inspect its ID and `Location` to determine whether it created a job or packet.

## Document packets and review

With Smart splitting enabled, PDF acceptance returns `202`, `Location: /v1/packets/{packet_id}`, `Retry-After: 2`, and a packet representation. The packet owns the original file and selected physical pages. It is not an extraction result.

An explicit Template fixes the version for all children at admission. Later edits or deletion do not change that binding. Automatic children inherit the supplied tags. Each classifies independently after its page boundaries are committed.

`GET /v1/packets/{packet_id}` returns:

| Property | Meaning |
| --- | --- |
| `packet_id`, `source_name`, `source_mime_type`, `source_file_page_count` | Packet identity and original PDF metadata. |
| `status` | `queued`, `processing`, `awaiting_review`, `materializing`, `processing_children`, `completed`, or `failed`. |
| `stage` | `analysis`, `review`, `materialization`, `extraction`, or `finished`. |
| `selected_pages` | Physical, one-based original page numbers, in source order. |
| `processing_policy` | Captured `enable_smart_splitting` and `exclude_blank_pages` booleans. |
| `template_id`, `template_version`, `template_tags` | Explicit pinned Template or automatic tag scope. |
| `plan_revision`, `plan_accepted` | Revision of the split plan and whether its groups are immutable after automatic acceptance or frontend review. |
| `plan.groups` | Objects containing `pages` arrays of original page numbers. |
| `plan.exclusions` | `{page, reason, verified_blank}` records. |
| `children` | Extraction job summaries with independent status and source-page lineage. Fetch `/v1/jobs/{job_id}` for full results; packet summaries do not contain extracted fields. |
| `reason`, `evidence`, `assessment_rounds` | Concise assessment outcome and durable decision progress. |
| `outcome` | `no_documents` for a verified all-blank packet, otherwise null. |
| `error_code`, `error_message` | Actionable processing failure details. |
| `created_at`, `updated_at`, `source_retained` | Timestamps and original-retention metadata. |

Clear, valid plans commit automatically. Split assessment and each child classification permit one initial assessment and at most two targeted follow-ups. A successful assessment stops further attempts. Budgets survive restarts and configuration changes.

Unresolved packets enter `awaiting_review`. Unresolved children enter `awaiting_template`. Holds do not retry continuously. Extraction retries do not split or classify committed work again.

With blank exclusion enabled, automatic omission requires independent verification of blank pages. Nonblank covers, unreadable pages, and uncertain content do not qualify. If all selected pages are verified blank, the packet completes with `outcome: "no_documents"`. It records exclusions and has no children. No child classification or extraction runs.

### Follow the packet and child request chain

One-page PDFs and accepted one-document plans still return packets. The browser presents them as ordinary documents. API clients use the packet contract for all child counts.

This example requires Smart splitting and suitable templates tagged `invoice` or `prescription`. The JSON examples are abbreviated. IDs and results are illustrative.

```bash
curl --fail-with-body --silent --show-error \
  "$API_BASE_URL/v1/extract" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  --form-string 'template_tags=["invoice","prescription"]' \
  -F 'document=@./combined.pdf;type=application/pdf'
```

The upload responds:

```http
HTTP/1.1 202 Accepted
Location: /v1/packets/pkt_example
Retry-After: 2
Content-Type: application/json
```

```json
{
  "packet_id": "pkt_example",
  "status": "queued",
  "stage": "analysis",
  "source_name": "combined.pdf",
  "source_file_page_count": 4,
  "template_tags": ["invoice", "prescription"],
  "selected_pages": [1, 2, 3, 4],
  "plan_accepted": false,
  "children": []
}
```

Save `packet_id` and poll `GET /v1/packets/pkt_example` with the same authorization. After plan acceptance and creation of two children, the response can contain:

```json
{
  "packet_id": "pkt_example",
  "status": "processing_children",
  "stage": "extraction",
  "plan_accepted": true,
  "plan": {
    "groups": [{"pages": [1, 2]}, {"pages": [3, 4]}],
    "exclusions": []
  },
  "children": [
    {
      "job_id": "job_invoice",
      "parent_packet_id": "pkt_example",
      "source_pages": [1, 2],
      "status": "completed",
      "template_id": "tpl_invoice",
      "template_version": 1
    },
    {
      "job_id": "job_prescription",
      "parent_packet_id": "pkt_example",
      "source_pages": [3, 4],
      "status": "processing",
      "template_id": "tpl_prescription",
      "template_version": 7
    }
  ]
}
```

Read `GET /v1/jobs/job_invoice` as soon as it completes; other children can keep processing:

```json
{
  "job_id": "job_invoice",
  "parent_packet_id": "pkt_example",
  "source_pages": [1, 2],
  "status": "completed",
  "template_id": "tpl_invoice",
  "template_version": 1,
  "results": [
    {"field_id":"invoice_number","name":"Invoice Number","data_type":"string","status":"ok","answer":"INV-123","confidence":0.98,"evidence":"Invoice number: INV-123"}
  ]
}
```

Implement the chain as follows:

1. Save the submission ID and `Location`. Poll every 2–5 seconds, using `Retry-After` when present. Apply a client deadline and backoff for temporary read errors.
2. Poll the packet and record each child `job_id`. The server creates, classifies, and extracts children automatically. Do not submit their pages again. `source_pages` contains one-based physical page numbers from the uploaded original.
3. Read each `completed` child’s job and consume its `results`. Record consumed IDs to prevent duplicate imports after polling or restarts. For `failed` children, inspect `error_code` and `error_message`.
4. Pause when a packet reaches `awaiting_review` or a child reaches `awaiting_template`. Polling cannot clear holds. A signed-in Workspace member must resolve the choice in the frontend. Resume polling after resolution.
5. Continue to monitor discovered children if the parent becomes `failed`. Partial materialization can leave successful or running children. Keep successful results. A completed packet with `outcome: "no_documents"` has no children to retrieve.

Packet reads use `Cache-Control: private, no-store`. They omit conditional ETags and polling `Retry-After` headers. Child job reads support [conditional polling](#polling-retries-and-delivery). A client timeout does not cancel accepted work. Resume with saved IDs instead of uploading again.

### Holds requiring frontend review

A packet in `awaiting_review` or a job in `awaiting_template` requires review in **Documents** by a Workspace member. See [browser review steps](../usage/document-extraction.md#progress-and-review) to confirm groups or select a template.

Keep packet and job IDs, show the hold to a user, and resume polling after review. The app reuses the existing source. Another upload is unnecessary. Accepted page groups, child IDs, and template bindings remain fixed.

### Read and manage packets

Read a selected page’s PNG preview with `GET /v1/packets/{packet_id}/pages/{original_page}/preview`. Read the original with `GET|HEAD /v1/packets/{packet_id}/source`. Active or held work exposes its available working source for resolution, even without completed-original retention. Normal cleanup applies when processing no longer needs the source. Child reads use `GET|HEAD /v1/jobs/{job_id}/source` and contain only assigned pages.

`GET /v1/packets` returns `{packets, has_more, next_cursor}`, with at most 50 packets per page. Supply `cursor` for the next page. Packets do not increase job counts or export rows.

`DELETE /v1/packets/{packet_id}` deletes the packet and children and returns `{deleted:true,packet_id}`. Child deletion does not redact pages from a retained original. Durable cleanup intents and remote retries control storage deletion.

### Processing limits

Automatic classification permits at most 100 eligible candidates and 64 KiB of candidate metadata. Split assessment permits 128 selected PDF pages and 100 child groups. Derived artifacts have a 32 MiB individual limit and a 64 MiB total limit. PDF operations are isolated and cancellable. Upload, parser, and model payload bounds also apply. Exceeding a bound stops work with an actionable result, without truncating candidates or pages.

Classification and splitting add model work before extraction. Gateway limits on image count, payload, context, or output can be lower than application limits. Without Direct PDF input, each assessment sends selected pages as images in one request. The app does not automatically batch around provider limits. Use a compatible route or smaller `pages` selection. Test connection verifies text connectivity, not document capabilities or classification accuracy.

## Jobs and results

### Read a job

`GET /v1/jobs/{job_id}`

Returns `200` with the following schema, or `404 not_found` if the job is absent or deleted:

| Property | Type | Meaning |
| --- | --- | --- |
| `job_id` | string | Job identifier. |
| `status` | string | `queued`, `awaiting_template`, `processing`, `completed`, or `failed`. |
| `source_name` | string or null | Uploaded filename. |
| `source_mime_type` | string | Submitted file MIME type. |
| `source_file_page_count` | integer or null | Page count of this job’s source PDF, including a derived child PDF; `null` for images. |
| `source_retained` | boolean | Whether its original or derived source is marked for retention beyond processing. Working sources may also be available during a template hold. |
| `template_id` | string or null | Bound Template; null while automatic selection is unresolved. |
| `template_version` | integer or null | Version captured at explicit submission or automatic/manual binding. |
| `template_tags`, `selection_mode`, `routing_status`, `selection_reason`, `routing_rounds` | optional routing metadata | Original canonical scope, `explicit`/`automatic`/`manual` selection, and durable assessment state. |
| `parent_packet_id`, `source_pages` | string/null, integer array/null | Parent and original physical page references for split children or page selections. |
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

Each result contains `field_id`, `name`, `data_type`, `status`, `answer`, `confidence`, and `evidence`. Confidence is a number or null. Evidence is a string or null. Results follow template field order. The model supplies confidence; the server does not enforce a 0–1 range.

Field statuses are `ok`, `not_found`, `invalid_type`, `unreadable`, and `error`. A missing model result becomes `not_found` with a null answer. Treat `invalid_type` answers as unvalidated. A job with `status: "completed"` is terminal even with non-`ok` fields.

### Polling, retries, and delivery

The normal lifecycle is `queued` → `processing` → `completed` or `failed`. Retryable failures can return the same job to `queued`. Poll until a terminal state. An `error_code` on a queued job does not make it terminal.

Each attempt uses the latest Workspace model settings and retains its accepted template binding. Automatic jobs remain queued during classification. They enter `awaiting_template` when manual selection is necessary. Treat this state as a hold, not a retry or failure.

Job detail responses include `ETag` and `Cache-Control: private, no-cache`. Queued or processing jobs also include `Retry-After: 5`. Keep the exact ETag and send it in `If-None-Match` on later requests:

```http
GET /v1/jobs/job_example
Authorization: Bearer <workspace_api_key>
If-None-Match: W/"job-v1-<digest-from-previous-response>"
```

An unchanged job returns `304 Not Modified` without a body. Keep the previous representation and wait before the next poll. A changed job returns `200` with a new ETag. Stop polling at `completed` or `failed`; these responses omit `Retry-After`.

`awaiting_template` also has no polling hint. A user must resolve the choice in the frontend before processing continues.

For automation clients:

- Honor `Retry-After` where provided. Use bounded backoff for temporary `503` responses and a client-side polling deadline.
- Retry safe reads after transport failures. Before repeating a timed-out or disconnected submission, establish whether the server accepted it. Repeated submissions can create duplicate jobs.
- Treat failed jobs as application failures even when reads return HTTP `200`. Inspect `error_code` and `error_message`. Codes include `processing_error`, `model_gateway_failed`, `retry_exhausted`, `missing_source_file`, and model-configuration errors.
- To rerun a terminal job, correct the failure and submit the original as a new job. The API provides no webhook, live-update stream, or retry-in-place endpoint.

### Read a document source

```http
GET /v1/jobs/{job_id}/source
HEAD /v1/jobs/{job_id}/source
```

Source endpoints use job-read authentication. `GET` returns the binary; `HEAD` returns identical headers without a body. Success includes the MIME type, `Content-Length`, attachment `Content-Disposition`, and `Cache-Control: private, no-store`.

A child source contains only assigned pages. Its `source_pages` maps them to the original PDF. `/v1/packets/{packet_id}/source` separately returns the original, including excluded pages and pages from deleted children.

Completed originals remain available when retention was enabled at submission. Otherwise, successful working sources are removed. Failed sources follow the operator’s retention period, which defaults to seven days.

A job in `awaiting_template` exposes its available working source for resolution. Packets in analysis, review, or materialization do the same. Completed-original retention is unnecessary for this access.

Retention does not guarantee storage availability. `404 source_not_retained` means no readable source remains retained. `404 source_missing` means the recorded file is missing. `503 source_unavailable` means storage is temporarily unavailable. Retrieval failures do not change processing status or results.

Results remain until deletion. Keep your own source copy if the integration requires guaranteed resubmission.

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
| `status_counts` | object | Workspace-wide integer counts for `queued`, `awaiting_template`, `processing`, `completed`, and `failed`, independent of filters. Packets are excluded. |
| `next_cursor` | string or null | Token for the next page, or `null` at the end. |
| `has_more` | boolean | Whether another page is available. |

Jobs use descending `created_at` order, then descending job ID. The default page size is 50. The API has no client `limit`, page number, or sort parameter. There is no dedicated `status` filter. Use `search` for status text when appropriate.

Supply `next_cursor` with the same filters and Workspace for the next page. Changed filters, modified tokens, or cursors from before a restart return `400 invalid_cursor`. Restart from the first page. Pagination does not provide a frozen Workspace snapshot. Read individual jobs for results.

### Read job counts

`GET /v1/jobs/counts`

Returns `200` with Workspace-wide totals and `Cache-Control: no-store`:

```json
{"total":12,"status_counts":{"queued":2,"awaiting_template":0,"processing":1,"completed":8,"failed":1}}
```

### Read available model filters

`GET /v1/jobs/filter-options`

Returns `200` with distinct, non-empty model names recorded on jobs, sorted case-insensitively:

```json
{"available_models":["model-a","model-b"]}
```

### Delete a job

`DELETE /v1/jobs/{job_id}`

Deletion removes the job and results and coordinates cancellation of active work. Failed immediate source cleanup is scheduled for retry. Success returns `200`:

```json
{"deleted":true,"job_id":"job_example"}
```

Later reads or deletions return `404 not_found`. Deletion is permanent. Concurrent deletion can return `409 job_deleting` or `409 workspace_deleting`.

### Export jobs

`POST /v1/jobs/export`

Send a JSON object containing `job_ids`, a non-empty array of at most 500 non-empty strings:

```json
{"job_ids":["job_example","job_another"]}
```

The app removes duplicate IDs and includes only completed or failed jobs from the authenticated Workspace. It skips missing, queued, and processing jobs. If no jobs are exportable, it returns `409 no_exportable_jobs`. Selected stored results must fit the 32 MiB export limit. Larger selections return `413 export_too_large`.

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

The runtime permits two concurrent exports. Additional exports return `503 export_capacity_unavailable` with `Retry-After: 2`. Use job detail JSON for direct programmatic access to results.

## Service endpoints

### Health

`GET /v1/health` — no authentication required.

Returns `200` with `ok: true` and `service: "document-extraction-api"`. Optional `diagnostics` contains runtime metrics that can change between runtime versions. Health success does not verify a Workspace model gateway or guarantee extraction success.

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

Use both HTTP status and `error.code` in application logic. Treat `message` as human-readable context. Failed jobs instead use `error_code` and `error_message` within the job. Proxy errors or hard request-size failures can have different bodies.

| HTTP status | Codes | Meaning / client action |
| --- | --- | --- |
| `400` | `invalid_json`, `invalid_request_body` | Correct the request body. |
| `400` | `invalid_name`, `invalid_description`, `invalid_tags`, `invalid_fields`, `empty_patch` | Correct template properties, tag names, or field definitions. |
| `400` | `invalid_document`, `invalid_pdf_source_file`, `invalid_template_id` | Supply a supported document and an explicit template ID or nonempty tags. |
| `400` | `invalid_multipart`, `invalid_options`, `invalid_template_tags`, `inline_fields_forbidden` | Correct multipart fields, boundaries, or options. |
| `400` | `invalid_page_selection` | Supply a valid original-page selection. |
| `400` | `pdf_source_file_limit_exceeded` | Reduce PDF size or complexity. |
| `400` | `source_file_too_large` | Reduce the file/request size or ask the operator about limits. |
| `400` | `submission_aborted` | The upload was interrupted. |
| `400` | `invalid_job_filters`, `invalid_cursor` | Correct filters or restart pagination. |
| `400` | `invalid_job_export` | Supply a non-empty array of job IDs. |
| `401` | `unauthorized` | Supply authentication. |
| `403` | `forbidden` | Check the API key or Workspace access. |
| `404` | `not_found`, `template_not_found`, `tag_not_found` | Check the resource ID and route; submission requires an active template. |
| `404` | `source_not_retained`, `source_missing` | The source is unavailable; stored results remain readable. |
| `409` | `workspace_model_not_configured` | Ask a Workspace owner/admin to configure the model gateway. |
| `409` | `workspace_deleting`, `job_deleting` | The resource is being deleted. |
| `409` | `tag_name_conflict` | Rename the shared tag to an unused name; renaming does not merge tags. |
| `409` | `no_exportable_jobs` | Select completed or failed jobs. |
| `413` | `request_body_too_large`, `export_too_large` | Reduce the JSON body or export selection. |
| `415` | `unsupported_media_type` | Use multipart form data for extraction or template generation. |
| `422` | `template_generation_invalid` | The model could not produce a valid template after corrective retries. |
| `499` | `template_generation_cancelled` | Template generation was canceled. |
| `500` | `document_submission_failed`, `job_export_failed`, `template_generation_failed`, `internal_error` | Server-side failure; investigate before repeating a mutation. |
| `502` | `template_generation_failed` | Template generation's model gateway request failed. |
| `503` | `packet_preview_busy`, `pdf_validation_capacity_unavailable` | PDF preview or processing capacity is full; back off before retrying. |
| `503` | `source_unavailable`, `source_storage_unavailable` | Original-document storage is temporarily unavailable. |
| `503` | `runtime_starting` | Wait for startup; honor `Retry-After`. |
| `503` | `local_runtime_shutting_down` | The runtime is stopping; reconnect after it restarts. |
| `503` | `local_submission_capacity_unavailable`, `local_product_store_capacity_unavailable`, `export_capacity_unavailable` | Temporary capacity limit; back off using `Retry-After`. |
| `503` | `local_product_store_unavailable` | Workspace storage is unavailable; retry later or contact the operator. |
| `503` | `workspace_model_configuration_unavailable` | The saved gateway credential cannot be read; an owner/admin must replace it. |

Non-file requests have a default **1 MiB** body limit. Configure it with `MAX_JSON_REQUEST_BYTES`. File requests use [separate submission limits](#document-submission). Local runtime capacity bounds requests. The API does not advertise a fixed requests-per-minute quota.
