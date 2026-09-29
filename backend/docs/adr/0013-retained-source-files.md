# Retained Source Files

An installation may keep the original **Source file** of each Document, so authorised users can view it beside its Extraction results and download it. Retention is an installation capability with a per-Workspace opt-out; it is not per-Workspace storage.

## Decision

- `SOURCE_STORAGE_PROVIDER` selects `none` (default) or `local`; S3-compatible storage is a later increment. Selecting a store enables `SOURCE_ORIGINAL_RETENTION_ENABLED` by default, so upgrades without a store never start retaining.
- Retention is decided once, when the server begins accepting an upload, and stored as an immutable `retained` flag on the Source file row. Existing rows migrate as not retained.
- With local storage, the promoted processing file *is* the retained original. Completed-job cleanup and the failed-source sweep skip retained rows, so no second copy is written. Document and Workspace deletion remove retained originals through the existing deletion intents.
- The Workspace opt-out lives in the control database beside other Workspace settings, so admission reads it with Workspace authorisation. Only signed-in owners/admins change it.
- `GET|HEAD /v1/jobs/:jobId/source` streams the original with standard product authorisation (session plus `x-workspace-id`, or a Workspace API key). It sends `private, no-store`, `nosniff` and an RFC 6266 attachment filename, and supports full-file responses only. It distinguishes `source_not_retained`, `source_missing` and `source_unavailable`.
- The browser fetches originals through the request adapter into memory and shows them from an object URL, released when the Document, layout, session or Workspace changes. Nothing is persisted in the browser.

## Consequences

- Local retained originals live in the private state directory, so application-state backups include them.
- S3-compatible storage, durable cross-store acceptance and cleanup manifests, non-blocking remote erasure, and the `storage configure` command are later increments of the same design.
