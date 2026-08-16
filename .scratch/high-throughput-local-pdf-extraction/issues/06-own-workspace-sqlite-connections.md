# Own Workspace SQLite connections for the process lifetime

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Introduce one deep Workspace product-store registry module that owns at most one long-lived, lease-aware SQLite store per active Workspace. Route HTTP submissions/reads and the Extraction runner through the same owner, run versioned schema initialization once per open, use short immediate transactions, and close/invalidate safely during Workspace deletion and shutdown.

Keep rollback journaling until the runtime safety gate confirms a SQLite version with the documented WAL-reset fix. Add the researched index cleanup and partial active-work index behind an explicit migration.

## Acceptance criteria

- Concurrent callers for one Workspace reuse exactly one owned product store and cannot close it while another lease is active.
- Idle owners are bounded and evictable; Workspace deletion invalidates and closes before database erasure.
- Schema migration/inspection runs once per owner, not per HTTP request or poll.
- Bun/SQLite version and selected journal/durability policy are observable; SQLite 3.51.0 does not enable unsafe multi-connection WAL.
- The redundant Source file and result indexes are removed and active recovery uses the partial active-work index.
- Concurrent submit/complete/poll tests do not emit `SQLITE_BUSY` or `document_submission_failed`.

## Blocked by

None - start here.

## Resolution

Implemented a bounded lease-aware owner registry shared by HTTP, runner, and deletion paths; safe rollback-journal/FULL durability; versioned migration/index cleanup; and owner diagnostics. Focused concurrency/invalidation tests and the 1,000-worker run completed without SQLite busy failures.
