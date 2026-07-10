# Extraction Jobs API

Submit a document using multipart form data:

```http
POST /v1/extract
Authorization: Bearer <workspace_api_key>
```

Required form fields are `template_id` and `document`. Successful submission returns `202` with a queued `job_id`.

Read jobs with:

```http
GET /v1/jobs
GET /v1/jobs/{job_id}
```

Completed job detail contains normalized field results. Failed detail contains an operational error code and message.
