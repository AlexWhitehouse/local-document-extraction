# Workspace API Overview

The local Workspace API is served from:

```text
http://127.0.0.1:8787
```

All product routes are under `/v1`. External clients authenticate with a Workspace API key:

```http
Authorization: Bearer <workspace_api_key>
```

The core flow is: create a Template, submit a Document with `POST /v1/extract`, then poll `GET /v1/jobs/{job_id}` until it completes or fails.
