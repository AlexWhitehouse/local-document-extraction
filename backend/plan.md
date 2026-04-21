# Cloudflare Document Extraction API Plan

## Goal

Build a schema-driven document question answering API on Cloudflare using:

- **Cloudflare Workers** for the public API and internal processing
- **Cloudflare Queues** for asynchronous job processing
- **Cloudflare R2** for temporary image storage
- **Cloudflare D1** for job metadata, templates, processing status, and results
- **Cloudflare AI Gateway** as the required AI egress and control plane
- **OpenAI GPT-5.4 nano** behind Cloudflare AI Gateway for multimodal extraction from document images

The API will accept an image plus a **template reference**. A template contains up to **50 field definitions**, where each field contains:

- a stable `id`
- a `name`
- a natural-language `description`
- a `data_type`
- optional flags such as `required`

The extraction endpoint will only accept a **`template_id`**. Clients will **not** be allowed to submit ad hoc fields inline when uploading an image.

The system will return answers for the fields defined in that template in structured JSON.

A key requirement for this design is that the uploaded image is stored in **R2 only temporarily** and is **deleted after successful processing**.

---

## Product requirements

### Functional requirements

1. Allow authenticated users to create reusable extraction templates.
2. Allow authenticated users to list, read, update, delete, and use only templates they own.
3. Accept a document image from a client.
4. Require a `template_id` on extraction requests.
5. Reject extraction requests that attempt to send raw field definitions directly.
6. Support up to 50 fields per template.
7. Support free-text field descriptions inside templates.
8. Support typed outputs, such as:
   - `string`
   - `number`
   - `boolean`
   - `date`
   - `object`
   - `array`
   - `array<object>`
9. Process the extraction asynchronously.
10. Return a `job_id` immediately after submission.
11. Allow the client to poll for job status and final results.
12. Use Cloudflare AI Gateway first, then route to OpenAI GPT-5.3 using BYOK.
13. Use a single multimodal extraction pass per image.
14. Delete the image from R2 once processing succeeds and the results have been stored.

### Non-functional requirements

1. Handle variable extraction schemas through stored templates.
2. Enforce strict tenant ownership boundaries for templates and jobs.
3. Be reliable under retries and queue redelivery.
4. Be safe for multi-tenant use.
5. Be observable and debuggable.
6. Be cost-aware.
7. Be resilient to malformed requests and partial extraction failures.
8. Avoid keeping source images longer than necessary.
9. Centralize AI routing, logging, policy, and provider abstraction through AI Gateway.

---

## Core product rule changes

This version of the system makes two major product changes.

### Change 1: Templates are mandatory

The client must create a template first, then reference its `template_id` when posting an image.

This means:

- no inline `fields` array on `POST /v1/extract`
- no ad hoc extraction schemas at submission time
- every job is tied to a persisted template snapshot

### Change 2: AI Gateway is the required AI entry point

The processing worker must call **Cloudflare AI Gateway** first, and AI Gateway then routes to **OpenAI GPT-5.3**

This means:

- the Worker does not call OpenAI directly
- AI Gateway becomes the single outbound AI endpoint
- provider credentials are managed through AI Gateway configuration
- AI usage, observability, and controls are centralized

---

## High-level architecture

```text
Client
  |
  v
Public Worker API
  |
  |-- authenticate tenant
  |-- template CRUD
  |-- validate extraction request
  |-- verify template ownership
  |-- write image to R2
  |-- write job + template snapshot to D1
  |-- push job message to Queue
  v
Cloudflare Queue
  |
  v
Queue Consumer Worker
  |
  |-- read job from D1
  |-- load template snapshot
  |-- fetch image from R2
  |-- build AI Gateway request
  |-- AI Gateway routes to OpenAI GPT-5.3 via BYOK
  |-- validate + normalize output
  |-- write results to D1
  |-- delete image from R2 on success
  |-- mark job complete
  v
Client polls GET /v1/jobs/:id
```

---

## Main components

## 1. Public API Worker

This Worker is the ingress point for external clients.

### Responsibilities

- authenticate incoming requests
- determine the caller's `tenant_id`
- enforce ownership boundaries
- handle template CRUD
- parse extraction request body
- validate image metadata
- verify the referenced `template_id` exists and is owned by the caller
- generate a unique `job_id`
- write the source image to R2
- write job metadata into D1
- snapshot the template version used by the job
- publish a processing message to Cloudflare Queues
- return `202 Accepted` with a `job_id`

### Endpoints

#### Template endpoints

##### `POST /v1/templates`

Creates a new template owned by the authenticated tenant.

##### `GET /v1/templates`

Lists templates owned by the authenticated tenant.

##### `GET /v1/templates/:id`

Returns one owned template.

##### `PATCH /v1/templates/:id`

Updates one owned template.

##### `DELETE /v1/templates/:id`

Deletes one owned template.

#### Extraction endpoints

##### `POST /v1/extract`

Creates a new extraction job using a required `template_id`.

##### `GET /v1/jobs/:id`

Returns job status and, when ready, the final results.

#### Optional endpoints

##### `GET /v1/health`

Basic health check.

---

## 2. Cloudflare R2

R2 is used for **temporary object storage** for uploaded document images.

### Why R2 is used

- image binaries should not be stored in D1
- Workers can read/write R2 efficiently
- enables async processing because the queue consumer can fetch the source image later

### Lifecycle requirement

The image should be removed from R2 after successful processing.

### Suggested object key format

```text
tenants/{tenant_id}/jobs/{job_id}/source.{ext}
```

### Retention policy

- default behavior: delete immediately after successful processing
- failed jobs: keep the image temporarily for retries and debugging
- add a cleanup mechanism for abandoned or permanently failed jobs if needed

---

## 3. Cloudflare D1

D1 stores all structured metadata and results.

### Responsibilities

- track tenants
- store templates and template fields
- store jobs
- store template snapshots used by jobs
- store extraction results
- store error metadata
- support polling and analytics

### Suggested schema

#### `tenants`

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  rate_limit_per_minute INTEGER,
  max_templates INTEGER,
  max_fields_per_template INTEGER,
  max_image_bytes INTEGER
);
```

#### `templates`

```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

#### `template_fields`

```sql
CREATE TABLE template_fields (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  field_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  PRIMARY KEY (template_id, version, field_id),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);
```

#### `jobs`

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  image_r2_key TEXT,
  image_mime_type TEXT,
  image_deleted_at TEXT,
  model_name TEXT,
  ai_gateway_route TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);
```

#### `job_template_fields`

This is the immutable snapshot of the template fields used for a specific job.

```sql
CREATE TABLE job_template_fields (
  job_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  PRIMARY KEY (job_id, field_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

#### `job_results`

```sql
CREATE TABLE job_results (
  job_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  status TEXT NOT NULL,
  answer_json TEXT,
  normalized_value TEXT,
  confidence REAL,
  evidence_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, field_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

### Why template versioning matters

Templates will change over time. A completed job must remain reproducible against the exact field set it used when submitted.

That is why each job stores:

- `template_id`
- `template_version`
- a copied field snapshot in `job_template_fields`

This avoids historical drift when a template is later edited.

---

## 4. Cloudflare Queue

Cloudflare Queue decouples request ingestion from model execution.

### Why Queue is needed

- avoids doing AI inference in the client-facing request
- provides retry semantics
- smooths bursty workloads
- prevents request timeout issues in the public API

### Queue message shape

```json
{
  "job_id": "job_abc123",
  "tenant_id": "tenant_001",
  "template_id": "tpl_invoice_v1",
  "template_version": 3,
  "image_r2_key": "tenants/tenant_001/jobs/job_abc123/source.png",
  "enqueued_at": "2026-04-14T12:00:00Z"
}
```

### Queue processing expectations

- consumers must be idempotent
- messages may be delivered more than once
- status transitions in D1 must protect against duplicate processing

---

## 5. Queue Consumer Worker

This Worker consumes messages from the queue and performs extraction.

### Responsibilities

1. read queue message
2. load job record from D1
3. ensure job is still processable
4. load job template snapshot from D1
5. fetch source image from R2
6. build the AI Gateway request and output schema
7. call AI Gateway, which routes to OpenAI GPT-5.3 via BYOK
8. validate returned JSON
9. normalize values by type
10. store results in D1
11. delete image from R2 if all persistence steps succeed
12. mark job as `completed`

### Recommended status transitions

```text
queued -> processing -> completed
queued -> processing -> failed
queued -> processing -> retryable_failed
```

To avoid duplicate processing, the consumer should update the job row from `queued` to `processing` atomically before doing expensive work.

---

## 6. Cloudflare AI Gateway + OpenAI GPT-5.3

AI Gateway is the required AI control plane for this system.

### Required routing model

The Worker must send the AI request to **Cloudflare AI Gateway**.

AI Gateway then forwards that request to **OpenAI GPT-5.3**

### Why use AI Gateway first

- centralizes provider routing
- centralizes observability and request logging
- centralizes rate controls and governance
- makes it easier to swap providers later
- avoids scattering provider-specific auth logic in Workers

### Responsibilities of the processing worker

- construct the multimodal request payload
- send it to the AI Gateway endpoint
- identify the configured route or model alias for GPT-5.3
- parse the structured JSON response

### Responsibilities of AI Gateway configuration

- store the provider credentials
- route requests to OpenAI GPT-5.3
- apply any gateway-level usage, logging, or policy settings

### Usage pattern

Make one multimodal request per job rather than one request per field.

### Why one request is better

- lower latency than 50 separate calls
- lower cost than repeated image processing
- better cross-field consistency
- easier to enforce a structured response contract

### Model task

The model should be instructed to:

- inspect the provided image
- answer only the requested fields from the selected template snapshot
- follow the declared data type for each field
- return `null` when the answer is absent or unreadable
- avoid hallucinating missing values
- include optional confidence and evidence fields if requested

### Internal output contract from the model

```json
{
  "results": [
    {
      "field_id": "f1",
      "status": "ok",
      "answer": 1499.95,
      "confidence": 0.97,
      "evidence": "Total: $1,499.95"
    },
    {
      "field_id": "f2",
      "status": "not_found",
      "answer": null,
      "confidence": 0.12,
      "evidence": null
    }
  ]
}
```

---

## Ownership and access control model

Every mutable or readable resource belongs to exactly one tenant.

### Ownership rules

A tenant may only:

- create templates for itself
- view templates it owns
- update templates it owns
- delete templates it owns
- submit jobs using templates it owns
- view jobs and results it owns

A tenant may not:

- list another tenant's templates
- reference another tenant's `template_id`
- read another tenant's jobs
- infer the existence of another tenant's resources through error details

### Recommended enforcement pattern

Every D1 query should include `tenant_id` in the selection predicate for user-visible resources.

Examples:

- `SELECT * FROM templates WHERE id = ? AND tenant_id = ?`
- `SELECT * FROM jobs WHERE id = ? AND tenant_id = ?`

### Delete behavior

Use soft-delete for templates at first.

That means:

- mark `deleted_at`
- hide deleted templates from normal reads and lists
- reject new extraction requests using deleted templates
- preserve historical references for old jobs

---

## Template API design

## `POST /v1/templates`

Creates a template owned by the authenticated tenant.

### Request

```json
{
  "name": "invoice-basic",
  "description": "Template for standard invoice extraction",
  "fields": [
    {
      "id": "f1",
      "name": "total_amount",
      "description": "Return the final total payable amount shown on the invoice.",
      "data_type": "number",
      "required": true
    },
    {
      "id": "f2",
      "name": "company_name",
      "description": "Return the company name that issued the invoice.",
      "data_type": "string",
      "required": true
    },
    {
      "id": "f3",
      "name": "lines",
      "description": "Return all invoice line items with description, quantity, unit price, and line total.",
      "data_type": "array<object>",
      "required": true
    }
  ]
}
```

### Response

```json
{
  "template_id": "tpl_abc123",
  "version": 1,
  "status": "active"
}
```

## `GET /v1/templates`

Lists templates owned by the caller.

## `GET /v1/templates/:id`

Returns one owned template plus its current version and fields.

## `PATCH /v1/templates/:id`

Updates an owned template.

### Recommended update rule

On update, increment `current_version` and write a new set of `template_fields` rows for the new version.

This preserves historical versions.

## `DELETE /v1/templates/:id`

Soft-deletes an owned template.

### Recommended delete rule

- set `deleted_at`
- set `status = archived` or `deleted`
- forbid future extraction jobs from using it
- preserve old jobs that reference prior versions

---

## Extraction API design

## `POST /v1/extract`

### Required behavior

This endpoint must accept a `template_id` and image only.

### Request

Use `multipart/form-data` for image upload plus JSON metadata, or use JSON with a base64 image for smaller payloads.

Recommended logical payload:

```json
{
  "template_id": "tpl_abc123",
  "options": {
    "include_confidence": true,
    "include_evidence": true
  }
}
```

### Validation rules

- `template_id` is required
- template must exist
- template must belong to the authenticated tenant
- template must not be deleted or archived for new use
- request must not contain `fields`
- image must satisfy MIME and size limits

### Immediate response

```json
{
  "job_id": "job_abc123",
  "status": "queued",
  "template_id": "tpl_abc123",
  "template_version": 3
}
```

---

## `GET /v1/jobs/:id`

### While queued or processing

```json
{
  "job_id": "job_abc123",
  "status": "processing",
  "template_id": "tpl_abc123",
  "template_version": 3
}
```

### On completion

```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "template_id": "tpl_abc123",
  "template_version": 3,
  "results": [
    {
      "field_id": "f1",
      "name": "total_amount",
      "data_type": "number",
      "status": "ok",
      "answer": 1499.95,
      "confidence": 0.97,
      "evidence": "Total: $1,499.95"
    },
    {
      "field_id": "f2",
      "name": "company_name",
      "data_type": "string",
      "status": "ok",
      "answer": "Acme Supplies Ltd",
      "confidence": 0.98,
      "evidence": "Header text"
    },
    {
      "field_id": "f3",
      "name": "lines",
      "data_type": "array<object>",
      "status": "ok",
      "answer": [
        {
          "description": "Widget A",
          "quantity": 2,
          "unit_price": 500,
          "line_total": 1000
        }
      ],
      "confidence": 0.9,
      "evidence": "Line items section"
    }
  ]
}
```

---

## Detailed processing flow

## Step 1. Client creates a template

1. Client sends template metadata and field definitions.
2. Public Worker authenticates the request.
3. Worker validates:
   - field count <= 50
   - unique field ids and names within the template
   - supported data types
   - max description length
4. Worker inserts a `templates` row.
5. Worker inserts `template_fields` rows at version 1.
6. Worker returns `template_id`.

## Step 2. Client submits an extraction job

1. Client sends image plus `template_id`.
2. Public Worker authenticates the request.
3. Worker validates:
   - `template_id` exists
   - template belongs to caller
   - template is active
   - request does not include `fields`
   - allowed image MIME type
   - max image size
4. Worker loads the template and current version.
5. Worker generates `job_id`.
6. Worker writes the image to R2.
7. Worker inserts the `jobs` row with status `queued`.
8. Worker copies current template fields into `job_template_fields`.
9. Worker publishes a queue message.
10. Worker responds with `202 Accepted`.

## Step 3. Queue consumer claims the job

1. Consumer receives queue message.
2. Consumer reads the `jobs` record.
3. Consumer verifies the job is in `queued` or retryable state.
4. Consumer atomically updates the job to `processing`.

## Step 4. Consumer loads source data

1. Consumer reads all `job_template_fields` rows.
2. Consumer fetches the source image from R2.
3. Consumer confirms the image exists and matches expectations.

## Step 5. Consumer calls AI Gateway

1. Consumer builds the system instruction.
2. Consumer builds the template field list payload.
3. Consumer sends the multimodal request to Cloudflare AI Gateway.
4. AI Gateway routes the request to OpenAI GPT-5.3 using BYOK.
5. Consumer receives the structured JSON response.

## Step 6. Consumer validates output

1. Ensure returned JSON parses.
2. Ensure all returned `field_id`s are known.
3. Ensure values roughly match declared types.
4. Coerce or normalize values where safe.
5. Fill missing fields with `not_found` and `null` if needed.

## Step 7. Consumer persists final result

1. Upsert rows into `job_results`.
2. Update the `jobs` row with:
   - `status = completed`
   - `completed_at`
   - `updated_at`
   - `model_name = openai:gpt-5.3`
   - `ai_gateway_route`
   - `prompt_version`
   - `schema_version`

## Step 8. Delete image from R2 after success

This remains a required behavior.

### Deletion rule

Delete the source image from R2 only after:

- the AI response has been validated
- all result rows have been written to D1 successfully
- the job has been marked `completed`

### Why deletion should happen after persistence

If the image is deleted too early and a later write fails, the system may lose the ability to retry the job.

### Deletion sequence

Recommended order:

1. persist results to D1
2. mark job `completed`
3. delete object from R2
4. update `jobs.image_deleted_at`

### Important tradeoff

There is a small edge case where the job can be marked `completed` but the R2 delete fails transiently. That should not fail the job. Instead:

- keep the job `completed`
- log the deletion failure
- store a null `image_deleted_at`
- retry deletion later with a cleanup job or scheduled worker

This prevents a successful extraction from being reported as failed just because cleanup failed.

---

## Template field model

Since templates are now mandatory, the template field definition format is central.

### Recommended field format

```json
{
  "id": "f1",
  "name": "total_amount",
  "description": "Return the final total payable amount shown on the invoice.",
  "data_type": "number",
  "required": true
}
```

### Field validation rules

- `id`: required, unique within the template version
- `name`: required, unique within the template version, machine-friendly
- `description`: required, non-empty, length-limited
- `data_type`: required, from allowed set
- `required`: optional boolean

### Supported data types

Start with a small set:

- `string`
- `number`
- `boolean`
- `date`
- `object`
- `array`
- `array<object>`

A later version can support richer typed schemas such as nested object definitions.

---

## Prompt design

The prompt should be deterministic and constrained.

### System instruction

Use a strong system message such as:

- You are extracting fields from a document image.
- Use only visible information from the document.
- Do not guess or infer missing values.
- If a field cannot be answered, return `status = not_found` and `answer = null`.
- Match each requested `data_type`.
- Return JSON only.

### User payload to the model

Pass:

- the image
- the selected template field snapshot
- optional extraction options

### Why this works well

The extraction request stays generic across invoices, receipts, forms, letters, or other visual documents, while the template system gives users reusable schemas.

---

## Type normalization strategy

The model output should be normalized before persistence.

### Examples

#### number

- strip currency symbols if needed
- parse decimal values safely
- preserve original evidence text separately

#### date

- convert to ISO 8601 if confidently parsed
- otherwise keep original text in evidence and return `not_found` or raw text depending on policy

#### boolean

- map values like `yes` or `true` consistently

#### array/object

- ensure valid JSON structure
- reject malformed nested structures

Normalization should be conservative. When uncertain, preserve the raw answer in `answer_json` and mark lower confidence.

---

## Error handling strategy

### Job-level errors

Examples:

- invalid request payload
- template not found
- template not owned by caller
- template archived or deleted
- image upload failure
- D1 insertion failure
- AI Gateway failure
- provider failure
- malformed model response

### Field-level errors

Examples:

- field not found in document
- field unreadable
- value type mismatch

### Status values

At job level:

- `queued`
- `processing`
- `completed`
- `failed`
- optional `retryable_failed`

At field level:

- `ok`
- `not_found`
- `invalid_type`
- `unreadable`
- `error`

### Failure policy

- malformed request: reject synchronously with `400`
- unauthorized resource access: return `404` or `403` based on your exposure policy
- temporary AI Gateway or provider issue: let queue retry
- unrecoverable processing issue: mark job failed and preserve error details

---

## Idempotency and retries

Queue systems require idempotent consumers.

### Rules

1. The same `job_id` may be delivered more than once.
2. The consumer must check current job state before processing.
3. If job is already `completed`, the consumer should no-op.
4. Writes to `job_results` should be upserts.
5. R2 deletion should tolerate the object already being missing.

### Recommended pattern

- update `jobs.status` from `queued` to `processing`
- if the update affects zero rows because the job is already being processed or completed, stop processing that delivery

---

## Security plan

### Authentication

Use API keys for the first version.

### Authorization

Associate each API key with a tenant.

All template and job operations must be authorized against that tenant.

### Request limits

Per tenant, enforce:

- max requests per minute
- max concurrent queued jobs
- max templates
- max fields per template
- max image size

### Input controls

- allow only expected image MIME types
- reject oversized payloads
- cap description length to reduce prompt abuse
- sanitize names and ids used in storage or logs

---

## Suggested project structure

```text
/src
  /api
    extract.ts
    getJob.ts
    templatesCreate.ts
    templatesList.ts
    templatesGet.ts
    templatesUpdate.ts
    templatesDelete.ts
    auth.ts
    validation.ts
  /consumer
    processJob.ts
    aiGateway.ts
    normalize.ts
    persistence.ts
    cleanup.ts
  /db
    tenants.ts
    templates.ts
    templateFields.ts
    jobs.ts
    jobTemplateFields.ts
    results.ts
    schema.sql
  /lib
    types.ts
    errors.ts
    logger.ts
    ids.ts
    time.ts
  index.ts
  queue.ts
wrangler.jsonc
README.md
```

### Responsibilities by file

#### `templatesCreate.ts`

Handles `POST /v1/templates`.

#### `templatesList.ts`

Handles `GET /v1/templates`.

#### `templatesGet.ts`

Handles `GET /v1/templates/:id`.

#### `templatesUpdate.ts`

Handles `PATCH /v1/templates/:id` and version bumping.

#### `templatesDelete.ts`

Handles `DELETE /v1/templates/:id`.

#### `extract.ts`

Handles `POST /v1/extract` using a required `template_id`.

#### `getJob.ts`

Handles `GET /v1/jobs/:id`.

#### `validation.ts`

Contains request and template validation.

#### `processJob.ts`

Main queue consumer orchestration.

#### `aiGateway.ts`

Builds the AI Gateway request and parses the response from the routed OpenAI model.

#### `normalize.ts`

Normalizes model output to typed values.

#### `persistence.ts`

Writes job state and results to D1.

#### `cleanup.ts`

Deletes R2 objects and records cleanup state.

---

## Suggested TypeScript interfaces

```ts
export type FieldDefinition = {
  id: string;
  name: string;
  description: string;
  data_type:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "object"
    | "array"
    | "array<object>";
  required?: boolean;
};

export type Template = {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  current_version: number;
  status: "active" | "archived" | "deleted";
};

export type CreateTemplateRequest = {
  name: string;
  description?: string;
  fields: FieldDefinition[];
};

export type UpdateTemplateRequest = {
  name?: string;
  description?: string;
  fields?: FieldDefinition[];
};

export type CreateJobRequest = {
  template_id: string;
  options?: {
    include_confidence?: boolean;
    include_evidence?: boolean;
  };
};

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "retryable_failed";

export type FieldResultStatus =
  | "ok"
  | "not_found"
  | "invalid_type"
  | "unreadable"
  | "error";
```

---

## Implementation phases

## Phase 1. Core asynchronous pipeline with templates

Build:

- API key auth
- template CRUD with ownership checks
- `POST /v1/extract` requiring `template_id`
- `GET /v1/jobs/:id`
- R2 upload
- D1 tables for templates, versions, jobs, results
- snapshotting template fields onto jobs
- Queue publishing
- queue consumer
- AI Gateway integration
- routing through OpenAI GPT-5.3 via BYOK
- result persistence
- delete image from R2 on success

Deliverable:
A working end-to-end MVP.

## Phase 2. Hardening

Add:

- stronger validation
- tenant rate limiting
- retry controls
- improved error codes
- structured logging
- cleanup fallback for failed R2 deletions
- stricter ownership tests

Deliverable:
Production-ready reliability improvements.

## Phase 3. Advanced features

Add:

- webhooks on completion
- richer typed schemas
- audit trail of prompt versions
- provider failover via AI Gateway
- support for PDFs or multi-page docs
- manual review workflows

Deliverable:
A more flexible platform.

---

## Key design decisions

### Decision 1: Templates are mandatory

Chosen to make extraction reusable, consistent, and easier to govern.

### Decision 2: Per-tenant template ownership is strict

Chosen to prevent cross-tenant data exposure and keep authorization simple.

### Decision 3: Asynchronous by default

Chosen because AI processing time is variable and queue-based execution is more reliable.

### Decision 4: Temporary R2 storage

Chosen because binary files need a shared handoff point between the public Worker and consumer Worker.

### Decision 5: Delete image only after successful persistence

Chosen to protect retriability and avoid losing the source before results are safe.

### Decision 6: AI Gateway first, OpenAI behind it via BYOK

Chosen to centralize provider routing, credentials, logging, and policy.

### Decision 7: Single multimodal model call per document

Chosen for cost, latency, and consistency.

### Decision 8: Stable response envelope rather than dynamic top-level keys

Chosen to support per-field status, evidence, confidence, and partial failure handling.

---

## Final recommended MVP scope

Build first:

1. API key auth
2. template CRUD with ownership enforcement
3. `POST /v1/extract` requiring `template_id`
4. `GET /v1/jobs/:id`
5. one image per job
6. up to 50 fields per template
7. one AI Gateway call per job
8. AI Gateway route to OpenAI GPT-5.3 via BYOK
9. D1 for tenants, templates, template versions, jobs, results
10. R2 temporary image storage
11. Queue-based async processing
12. delete image from R2 after successful processing

---

## Summary

The recommended architecture is:

- **Public Worker** manages template CRUD and extraction job creation
- **Templates** are mandatory and owned per tenant
- **R2** stores the image temporarily
- **D1** stores tenants, templates, template versions, jobs, and results
- **Queue** decouples ingestion from AI processing
- **Queue Consumer Worker** calls **Cloudflare AI Gateway**, which routes to **OpenAI GPT-5.3 via BYOK**, writes results, and deletes the source image from R2 after success

This architecture fits your updated requirement for a template-driven document question answering API and enforces that users may only create, see, update, delete, and use templates they own.
