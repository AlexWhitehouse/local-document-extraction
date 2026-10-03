# Retained Source Files

An installation can keep each Document's original **Source file**. Authorized users can view it beside the Extraction results or download it. Retention is an installation capability. Each Workspace can disable retention, but does not have separate storage.

## Decision

- `SOURCE_STORAGE_PROVIDER` selects `none` (default), `local`, or `s3`. Selecting a store enables `SOURCE_ORIGINAL_RETENTION_ENABLED` by default. Upgrades without a store therefore do not start retention.
- The server determines retention when it starts accepting an upload. It stores this decision as an immutable `retained` flag on the Source file row. Existing rows migrate as not retained.
- With local storage, the promoted processing file is the retained original. Completed-job cleanup and failed-source cleanup skip retained rows. The runtime does not write a second copy. Document and Workspace deletion remove retained originals through existing deletion intents.
- The control database stores the Workspace opt-out beside other Workspace settings. Admission reads it during Workspace authorization. Only signed-in owners and admins can change it.
- `GET|HEAD /v1/jobs/:jobId/source` streams the original with standard product authorization. This accepts a session with `x-workspace-id`, or a Workspace API key. Responses include `private, no-store`, `nosniff`, and an RFC 6266 attachment filename. Only full-file responses are supported. Errors distinguish `source_not_retained`, `source_missing`, and `source_unavailable`.
- The browser request adapter loads originals into memory and displays them through object URLs. A Document, layout, session, or Workspace change releases the URL. The browser does not persist the original.

### S3-compatible storage

- The S3 adapter uses Bun's built-in `S3Client` without an SDK. Each original uses one PUT with a part size larger than the file. There is no multipart state to recover. Bun does not accept an `AbortSignal`, so every call has a deadline. Each upload attempt uses a unique key: `<prefix><installation namespace>/workspaces/<id>/jobs/<id>/<uuid>.<ext>`. A qualification experiment passed on RustFS. AWS S3 is not yet qualified.
- Acceptance has four stages: record `preparing` in the installation manifest (`control.sqlite`), PUT, commit the job and object key, then link the entry. The job transaction is the acceptance point. If PUT fails, the server creates no job and returns retryable `503 source_storage_unavailable`.
- The promoted local file is only a working copy. The runtime removes it after successful processing or during cleanup after failure. Retrieval streams the original from S3.
- Only `NoSuchKey` means missing. Access denied, timeout, and unknown errors mean unavailable. Access denied can conceal a missing key.
- Document deletion marks the object `deleting` before clearing its product deletion intent. Workspace deletion marks all its objects before erasing product data. Neither action waits for S3. A background runner deletes objects with jittered exponential backoff and keeps every unfinished intent. After confirmed deletion, each entry remains for a late-write window.
- Recovery links a stale `preparing` entry only if the job references it. It releases the entry if the Workspace is gone or the job definitely has no reference. Unreadable product data remains for a later recovery pass.
- Buckets must not use object versioning or Object Lock. The app does not verify these settings and deletes only by key. It provides no guarantee about earlier object versions.

## Consequences

- Local retained originals stay in the private state directory. Application-state backups include them.
- Local Workspace erasure still waits for local file removal. Only remote erasure is asynchronous.
- `control.sqlite` records the S3 endpoint, bucket, prefix, and addressing style. It does not record credentials as part of the destination. Startup and `document-extraction storage configure` reject destination changes while objects or unfinished cleanup depend on it. Moving originals is not supported. `storage configure` requires the app to be stopped. It tests S3 with a synthetic object and requires confirmation of the bucket requirements. It saves `config.env` atomically.
