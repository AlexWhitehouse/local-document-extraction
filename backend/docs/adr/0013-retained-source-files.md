# Retained Source Files

An installation may keep the original **Source file** of each Document, so authorised users can view it beside its Extraction results and download it. Retention is an installation capability with a per-Workspace opt-out; it is not per-Workspace storage.

## Decision

- `SOURCE_STORAGE_PROVIDER` selects `none` (default), `local` or `s3`. Selecting a store enables `SOURCE_ORIGINAL_RETENTION_ENABLED` by default, so upgrades without a store never start retaining.
- Retention is decided once, when the server begins accepting an upload, and stored as an immutable `retained` flag on the Source file row. Existing rows migrate as not retained.
- With local storage, the promoted processing file *is* the retained original. Completed-job cleanup and the failed-source sweep skip retained rows, so no second copy is written. Document and Workspace deletion remove retained originals through the existing deletion intents.
- The Workspace opt-out lives in the control database beside other Workspace settings, so admission reads it with Workspace authorisation. Only signed-in owners/admins change it.
- `GET|HEAD /v1/jobs/:jobId/source` streams the original with standard product authorisation (session plus `x-workspace-id`, or a Workspace API key). It sends `private, no-store`, `nosniff` and an RFC 6266 attachment filename, and supports full-file responses only. It distinguishes `source_not_retained`, `source_missing` and `source_unavailable`.
- The browser fetches originals through the request adapter into memory and shows them from an object URL, released when the Document, layout, session or Workspace changes. Nothing is persisted in the browser.

### S3-compatible storage

- The S3 adapter uses Bun's built-in `S3Client`, with no SDK. Originals go up as one PUT (part size above the file size), so there is no multipart state to recover. Bun takes no `AbortSignal`, so every call has a deadline and each upload attempt uses a unique key: `<prefix><installation namespace>/workspaces/<id>/jobs/<id>/<uuid>.<ext>`. A qualification spike passed on RustFS; AWS S3 is not yet qualified.
- Acceptance order: record a `preparing` entry in the installation manifest (`control.sqlite`), PUT, commit the job with its object key, then link the entry. The job transaction is the acceptance point. If the PUT fails, no job is created and the upload receives a retryable `503 source_storage_unavailable`.
- The promoted local file is only a working copy. It is removed when processing completes, or by the sweep once a job has failed; retrieval streams from S3.
- Only `NoSuchKey` means missing. Access denied, timeouts and unknown errors are unavailable, because access denied can hide a missing key.
- Document deletion marks the object `deleting` before its product deletion intent clears. Workspace deletion marks every object of the Workspace before product data is erased, and neither waits for S3. A background runner deletes objects with jittered exponential backoff and never drops intent. It keeps each entry for a late-write window after the delete is confirmed.
- Recovery links a stale `preparing` entry only when the job references it. It releases the entry when the Workspace is gone or the job positively does not reference it; unreadable product data is left for a later pass.
- Buckets must not use object versioning or Object Lock. The app does not verify this and deletes by key only, so it claims nothing about earlier versions.

## Consequences

- Local retained originals live in the private state directory, so application-state backups include them.
- Local Workspace erasure still awaits local file removal, as before; only remote erasure is asynchronous.
- The S3 destination (endpoint, bucket, prefix, addressing style; not credentials) is recorded in `control.sqlite`. Startup and `document-extraction storage configure` refuse to change it while objects or unfinished cleanup depend on it; moving originals is not supported. `storage configure` runs only with the app stopped, probes S3 with a synthetic object, requires the operator to confirm the bucket requirement, and saves `config.env` atomically.
