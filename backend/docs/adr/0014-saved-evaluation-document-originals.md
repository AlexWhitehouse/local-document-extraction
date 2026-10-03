# Saved Evaluation Document Originals

A Workspace can keep documents and their user-verified **Expected answer sets** in an **Evaluation document library** for reuse in later Evaluations and Batch Evaluations. Each **Saved Evaluation document** owns its original file independently of any Extraction job. This extends [Retained Source Files](0013-retained-source-files.md); it does not change how job originals are retained, served or deleted.

## Decision

- **Eligibility.** A new library save uses the existing retention controls: a configured `local` or `s3` store, `SOURCE_ORIGINAL_RETENTION_ENABLED`, and no Workspace opt-out. Eligibility is checked when saving begins. There is no separate library setting. Without it, the browser explains why new saves are unavailable, while temporary Evaluations, existing entries and saved-answer updates keep working. Disabling retention never purges saved entries.
- **Ownership.** Library entries live in the Workspace product database (`evaluation_documents`), each with one versioned, validated Expected answer set (`lib/evaluationReference.ts`) and a revision. No Extraction job is created for a saved original, and ordinary Documents are not imported. Candidate settings, outputs, scores and run history are never saved.
- **Storage layout.** Local originals are written to `source-files/workspaces/<id>/evaluation-documents/<documentId>/source.<ext>` from the save's own upload in `temporary/evaluation-documents`, never from the working file of an active run. S3 keys are `<prefix><namespace>/workspaces/<id>/evaluation-documents/<documentId>/<uuid>.<ext>`. File and user names never become paths or keys. An original is fixed: a different file is a new entry.
- **Manifest owners.** The installation manifest records an explicit owner kind (`job` or `evaluation_document`) and owner id. Existing rows migrate to `job`, with keys, phases and attempts unchanged. Stale `preparing` recovery links a library object only when the committed entry references it, and releases it only when the entry is positively absent; unreadable product data is left for a later pass.
- **Complete save.** Record `preparing` (S3), write the original, then commit the entry and an idempotent save receipt in one short transaction, then link. The browser reports saved only after that commit. A failure exposes no entry. A local original left without a committed entry is reclaimed after a 15-minute grace. Receipts hold only the operation id, a payload digest, the entry id and whether it was saved or deleted. Retrying the same save keeps the same entry; conflicting changes need review; retrying after deletion never recreates the entry.
- **Conditional changes.** Rename and answer updates compare and swap on the revision the browser loaded. If another user has changed the entry, the browser shows the current entry and answers for review; nothing is merged.
- **Deletion.** One transaction removes the entry, records a deletion intent and marks its receipt deleted. Remote objects are marked `deleting`; local files are removed in the background, and the intent stays until cleanup succeeds, surviving restarts. Workspace erasure already covers both owner kinds, and the S3 destination guard counts library objects.
- **Access.** Signed-in Workspace members use the Evaluation library in the browser. Every member can save, browse, rename, update, delete, and download library documents. Original downloads remain private. The app distinguishes a missing original from storage that is temporarily unavailable.
- **Runs.** The runner copies a saved original into a private temporary working file for each document operation. Deleting the entry stops undispatched, queued and retry work for it; a model call already sent may still finish. The working copy and the library original have separate lifetimes.

## Consequences

- Library originals count toward the same storage and backups as retained job originals.
- Save receipts are kept indefinitely, so an old replay can never become a new save. They contain no document or answer content.
- Paging orders by last update, so an entry edited while someone pages can move between pages.
