# Extraction jobs API

## Submit a document

```http
POST /v1/extract
Authorization: Bearer <workspace_api_key>
```

Send one multipart `document` and either `template_id` or a nonempty `template_tags` JSON array. An explicit Template wins. Without an ID, templates matching any supplied tag are assessed against the document using their names and descriptions. Unknown tags match nothing; the scope never broadens automatically. Optional PDF-only `pages` selects physical page numbers.

With Workspace Smart splitting off (the default), the response is `202 Accepted` with a `job_id`. With splitting on, a PDF returns a `packet_id` and a pollable packet location; each resulting logical document gets its own job. The response means processing was accepted, not that extraction is complete.

The Workspace also controls blank-page exclusion, which only operates within Smart splitting. Both settings default to No and cannot be overridden per request. See [Document submission](overview.md#document-submission) and [Document packets and review](overview.md#document-packets-and-review).

## Get results or resolve a hold

Poll the returned `Location`. Jobs use `GET /v1/jobs/{job_id}`; packets use `GET /v1/packets/{packet_id}` and expose child job summaries. Completed jobs contain a `results` array; packet child summaries do not. Discover each child `job_id` from the packet, then read `/v1/jobs/{job_id}` for its results. A failed packet may still contain successful or running children, so track them independently. A verified all-blank packet completes with `outcome: "no_documents"` and zero children.

Automatic processing investigates ambiguity within a durable initial-plus-two assessment budget. If it cannot resolve a choice, a signed-in Workspace member must open the held document in the frontend to select a template for `awaiting_template` or review the page groups for `awaiting_review`. Workspace API keys cannot resolve these holds. Retain the IDs and resume polling after review; the existing source is reused without another upload.

`GET /v1/jobs` lists extraction jobs, including packet children; `GET /v1/packets` lists parents. Children can be viewed, exported, and deleted independently. Deleting a child leaves the retained parent original intact; `DELETE /v1/packets/{packet_id}` removes the full group.

One-page PDFs and accepted one-document plans still use this packet API, even when the UI displays them as ordinary documents. Source reads use `GET|HEAD /v1/jobs/{job_id}/source` for the child document and `GET|HEAD /v1/packets/{packet_id}/source` for the full original, subject to retention and review-source availability.

The [packet request-chain example](overview.md#follow-the-packet-and-child-request-chain) shows the upload response, child discovery, and results retrieval. The [quickstart](overview.md#quickstart-document-to-structured-data) demonstrates ordinary explicit extraction. The [full reference](overview.md#jobs-and-results) covers polling, exports, retention, and deletion.
