# Extraction jobs API

## Submit a document

```http
POST /v1/extract
Authorization: Bearer <workspace_api_key>
```

Send multipart form data with a `template_id` and one `document`. The response is `202 Accepted` with a `job_id`. That means the document is queued, not that extraction has finished.

You may also send `template_tags` as a JSON array of names, such as `["invoice","finance"]`. The API validates this optional field but does not store or use it. Unknown tag names are accepted, and `template_id` remains required and determines the extraction template. See [Document submission](overview.md#document-submission) for tag limits and an example.

## Get the results

```http
GET /v1/jobs/{job_id}
```

Check this until `status` is `completed` or `failed`. A completed job has a `results` array with one entry per template field; a failed job has an `error_code` and `error_message`.

To list jobs, use `GET /v1/jobs`, which supports search, date filters, and paging.

The [quickstart](overview.md#quickstart-document-to-structured-data) has a complete script. [Jobs and results](overview.md#jobs-and-results) covers efficient polling with `ETag`s, retries, exports, and deletion.
