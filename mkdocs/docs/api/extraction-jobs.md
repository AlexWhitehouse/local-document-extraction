# Extraction Jobs

Extraction routes use your Workspace API key. Jobs created through the API appear in the same Workspace as Documents submitted in the app.

## Submit Document

```http
POST /v1/extract
Authorization: Bearer <workspace_api_key>
Content-Type: multipart/form-data
```

When using browser `FormData`, `curl -F`, or most SDK HTTP clients, let the client set the multipart `Content-Type` header so the required boundary is included.

Form fields:

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `template_id` | Yes | string | Template ID. |
| `document` | Yes | file | PNG, JPEG, WebP, or PDF Source file. |
| `options` | No | JSON string | `include_confidence` and `include_evidence` booleans. |

Example:

```bash
curl https://extract.t3m.uk/v1/extract \
  -H "Authorization: Bearer wk_live_example" \
  -F "template_id=tpl_123" \
  -F "document=@invoice.pdf;type=application/pdf" \
  -F 'options={"include_confidence":true,"include_evidence":true}'
```

Response status: `202 Accepted`.

```json
{
  "job_id": "job_123",
  "status": "queued",
  "source_name": "invoice.pdf",
  "template_id": "tpl_123",
  "template_version": 3
}
```

## List Jobs

```http
GET /v1/jobs
Authorization: Bearer <workspace_api_key>
```

Query parameters:

| Parameter | Description |
| --- | --- |
| `limit` | Positive integer. Maximum and default are `200`. |
| `search` | Optional search text. Trimmed and capped at 120 characters. |
| `cursor` | Cursor from `next_cursor`. |

Response:

```json
{
  "jobs": [
    {
      "job_id": "job_123",
      "status": "completed",
      "source_name": "invoice.pdf",
      "template_id": "tpl_123",
      "template_version": 3,
      "error_code": null,
      "error_message": null,
      "created_at": "2026-06-01T10:00:00.000Z",
      "updated_at": "2026-06-01T10:00:12.000Z",
      "completed_at": "2026-06-01T10:00:12.000Z",
      "current_attempt": 1,
      "completed_attempt": 1,
      "last_failed_attempt": 0,
      "results": []
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

## Get Job

```http
GET /v1/jobs/{job_id}
Authorization: Bearer <workspace_api_key>
```

Completed job response:

```json
{
  "job_id": "job_123",
  "status": "completed",
  "source_name": "invoice.pdf",
  "template_id": "tpl_123",
  "template_version": 3,
  "error_code": null,
  "error_message": null,
  "created_at": "2026-06-01T10:00:00.000Z",
  "updated_at": "2026-06-01T10:00:12.000Z",
  "completed_at": "2026-06-01T10:00:12.000Z",
  "current_attempt": 1,
  "completed_attempt": 1,
  "last_failed_attempt": 0,
  "results": [
    {
      "field_id": "invoice_total",
      "name": "Invoice Total",
      "data_type": "number",
      "status": "ok",
      "answer": 240.5,
      "confidence": 0.93,
      "evidence": "Total due GBP 240.50"
    }
  ]
}
```

## Delete Job

```http
DELETE /v1/jobs/{job_id}
Authorization: Bearer <workspace_api_key>
```

Deletes the Extraction job and its stored Source file if present.

Response status: `204 No Content`.
