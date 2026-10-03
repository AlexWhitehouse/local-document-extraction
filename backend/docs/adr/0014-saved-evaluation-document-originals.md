# Saved Evaluation Document Originals

A Workspace can keep documents and user-verified **Expected answer sets** in an **Evaluation document library**. Members can reuse them in Evaluations and Batch Evaluations. Each **Saved Evaluation document** owns its original independently of any Extraction job. This extends [Retained Source Files](0013-retained-source-files.md). It does not change retention, delivery, or deletion of job originals.

## Decision

- **Eligibility.** New library saves use existing retention controls: a `local` or `s3` store, `SOURCE_ORIGINAL_RETENTION_ENABLED`, and no Workspace opt-out. Eligibility is determined when saving starts. There is no separate library setting. If saving is unavailable, the browser explains why. Temporary Evaluations, existing entries, and saved-answer updates remain available. Disabling retention never removes saved entries.
- **Ownership.** The Workspace product database stores entries in `evaluation_documents`. Each entry has one versioned, validated Expected answer set (`lib/evaluationReference.ts`) and a revision. A saved original does not create an Extraction job. The library does not import ordinary Documents or save candidate settings, outputs, scores, or run history.
- **Storage layout.** Local originals use `source-files/workspaces/<id>/evaluation-documents/<documentId>/source.<ext>`. They come from the save's upload in `temporary/evaluation-documents`, never an active run's working file. S3 keys use `<prefix><namespace>/workspaces/<id>/evaluation-documents/<documentId>/<uuid>.<ext>`. File and user names never become paths or keys. An original cannot change. A different file requires a new entry.
- **Manifest owners.** The installation manifest records an owner kind (`job` or `evaluation_document`) and owner ID. Existing rows migrate to `job`. Their keys, phases, and attempts do not change. Recovery links a stale `preparing` object only if a committed entry references it. It releases the object only if the entry is definitely absent. Unreadable product data remains for a later pass.
- **Complete save.** Saving records `preparing` for S3, writes the original, and commits the entry and an idempotent receipt in one short transaction. It then links the entry. The browser reports success only after the commit. A failure exposes no entry. Cleanup reclaims uncommitted local originals after 15 minutes. Receipts contain only the operation ID, payload digest, entry ID, and saved or deleted state. Retrying the same save keeps the same entry. Conflicting changes require review. Retrying after deletion never recreates the entry.
- **Conditional changes.** Rename and answer updates compare and swap the revision that the browser loaded. If another user changed the entry, the browser shows the current entry and answers for review. It does not merge changes.
- **Deletion.** One transaction removes the entry, records a deletion intent, and marks its receipt deleted. Remote objects become `deleting`. Local files are removed in the background. The intent survives restarts and remains until cleanup succeeds. Workspace erasure covers both owner kinds. The S3 destination guard includes library objects.
- **Access.** Signed-in Workspace members use the Evaluation library in the browser. Every member can save, browse, rename, update, delete, and download library documents. Original downloads remain private. The app distinguishes missing originals from temporarily unavailable storage.
- **Runs.** Each document operation uses a private temporary copy of the saved original. Deletion stops work that has not started, queued work, and retries for that entry. A model call already sent can still finish. The working copy and library original have separate lifetimes.

## Consequences

- Library originals use the same storage and backups as retained job originals.
- Save receipts remain indefinitely. An old retry cannot become a new save. Receipts contain no document or answer content.
- Lists sort by last update. An entry can move between pages if someone edits it during paging.
