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

Poll the returned `Location`. Jobs use `GET /v1/jobs/{job_id}`; packets use `GET /v1/packets/{packet_id}` and expose child job summaries. Completed jobs contain a `results` array. A verified all-blank packet completes with `outcome: "no_documents"` and zero children.

Automatic processing investigates ambiguity within a durable initial-plus-two assessment budget. If it cannot resolve a choice, use `POST /v1/jobs/{job_id}/template` for `awaiting_template` or `POST /v1/packets/{packet_id}/plan` for `awaiting_review`, without uploading the available source again. Packet plan changes require the current revision.

`GET /v1/jobs` lists ordinary jobs; `GET /v1/packets` lists parents. Children can be viewed, exported, and deleted independently. Deleting a child leaves the retained parent original intact; `DELETE /v1/packets/{packet_id}` removes the full group.

The [quickstart](overview.md#quickstart-document-to-structured-data) demonstrates ordinary explicit extraction. The [full reference](overview.md#jobs-and-results) covers polling, exports, retention, and deletion.
