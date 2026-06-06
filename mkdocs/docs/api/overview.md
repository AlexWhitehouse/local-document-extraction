# API Overview

The customer API lets external systems create Templates, submit Documents for extraction, list jobs, and read completed results.

## Base URLs

Use this base URL:

```text
https://extract.t3m.uk
```

All customer API routes in this documentation are under `/v1`.

## Authentication

External systems authenticate with a Workspace API key:

```http
Authorization: Bearer <workspace_api_key>
```

Generate or rotate the key from the Workspace area in the app. API access depends on the active Workspace plan.

## Required Headers

| Header | Required For | Value |
| --- | --- | --- |
| `Authorization` | All customer API routes except `GET /v1/health` | `Bearer <workspace_api_key>` |
| `Content-Type` | JSON request bodies | `application/json` |
| `Content-Type` | Document upload | `multipart/form-data` with a boundary |

Most HTTP clients set the multipart boundary automatically when you send form data. Do not manually set `Content-Type: multipart/form-data` unless your client also includes the boundary.

## Response Format

Successful JSON responses use `application/json`. Delete routes may return `204 No Content`. Errors use the JSON shape described in [Errors](errors.md).

## Core Flow

1. Generate a Workspace API key in the app.
2. Create or retrieve a Template.
3. Submit a Document with `POST /v1/extract`.
4. Poll `GET /v1/jobs/{job_id}` until the job is completed or failed.
5. Read structured results from the completed job response.

## Health

```http
GET /v1/health
```

Response:

```json
{
  "ok": true,
  "service": "document-extraction-api"
}
```
