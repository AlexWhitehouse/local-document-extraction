# Templates API

Use a Workspace API key with Template routes.

```http
GET /v1/templates
POST /v1/templates
GET /v1/templates/{template_id}
PATCH /v1/templates/{template_id}
DELETE /v1/templates/{template_id}
```

Create and update payloads use JSON with `name`, optional `description`, and `fields`. Every field needs a name, description, and supported `data_type`.

## Generate an unsaved template

`POST /v1/templates/generate` accepts multipart form data:

- `document`: exactly one PDF, PNG, JPEG, or WebP file within the Workspace's upload size limit.
- `instructions`: optional extraction guidance, at most 8 KiB.

Authenticate with a Workspace API key or an authenticated session and `x-workspace-id`. The Workspace must have a usable model configuration. The endpoint returns a validated Template payload with `name`, `description`, and `fields`, using the same field representation as Template reads. Object schema metadata is encoded in field descriptions and decoded by the editor. Generation does not save a Template or create an Extraction job; explicitly POST or PATCH the reviewed payload to save it.

An invalid model proposal receives specific feedback and up to three corrective retries (four total model calls). Exhaustion returns `422 template_generation_invalid`. Gateway failures return `502 template_generation_failed` without automatic retries. Missing configuration returns `409 workspace_model_not_configured`; unreadable credentials return `503 workspace_model_configuration_unavailable`. Cancelling the request aborts generation. The temporary sample is removed after completion, failure, or cancellation.
