# Extraction jobs API

## Submit a document

```http
POST /v1/extract
Authorization: Bearer <workspace_api_key>
```

Send one multipart `document` with `template_id` or a nonempty `template_tags` JSON array. An explicit Template takes priority. Without an ID, the model assesses templates matching any supplied tag. It uses their names and descriptions. Unknown tags match nothing and do not expand the scope. Optional PDF-only `pages` selects physical page numbers.

With Workspace Smart splitting disabled, submission returns `202 Accepted` and `job_id`. This is the default. With splitting enabled, a PDF returns `packet_id` and a polling location. Each resulting logical document receives its own job. Acceptance confirms processing admission; extraction is not yet complete.

The Workspace also controls blank-page exclusion, which requires Smart splitting. Both settings default to No. Requests cannot override them. See [Document submission](overview.md#document-submission) and [Document packets and review](overview.md#document-packets-and-review).

## Get results and handle review holds

Poll the returned `Location`. Jobs use `GET /v1/jobs/{job_id}`. Packets use `GET /v1/packets/{packet_id}` and include child job summaries.

Completed jobs contain `results`; packet child summaries do not. Retrieve each child `job_id` from the packet. Read `/v1/jobs/{job_id}` for its results. A failed packet can contain successful or running children. Monitor each child independently.

A verified all-blank packet completes with `outcome: "no_documents"` and no children.

Automatic processing permits one initial assessment and at most two targeted reassessments to resolve ambiguity. If the choice remains unresolved, pause polling. Direct a Workspace member to **Documents** in the browser. They can [select a template or review page groups](../usage/document-extraction.md#progress-and-review) for `awaiting_template` or `awaiting_review`. Keep the IDs and resume polling after review. The app reuses the existing source without another upload.

`GET /v1/jobs` lists extraction jobs, including packet children. `GET /v1/packets` lists parents. You can read, export, and delete children independently. Child deletion keeps the retained parent original. `DELETE /v1/packets/{packet_id}` deletes the group.

One-page PDFs and accepted one-document plans retain packet identity, even when the frontend presents them as ordinary documents. Read child sources with `GET|HEAD /v1/jobs/{job_id}/source`. Read the full original with `GET|HEAD /v1/packets/{packet_id}/source`. Retention and review-source availability control access.

The [packet request-chain example](overview.md#follow-the-packet-and-child-request-chain) covers submission, child discovery, and result retrieval. The [quickstart](overview.md#quickstart-document-to-structured-data) covers explicit extraction. The [full reference](overview.md#jobs-and-results) covers polling, exports, retention, and deletion.
