# Which SQLite access and retention design sustains the target workload?

Category: research
Status: completed
Labels: wayfinder:research, completed
Assignee: research_sqlite_retention

## Parent

../PRD.md

## Decision question

How should per-Workspace SQLite access, transactions, indexing, and indefinite Extraction result retention be configured so lifecycle writes and 1,000 independent pollers remain efficient at one million retained jobs per Workspace?

## Why this is unresolved

The current product store opens a Workspace database for individual operations and repeats schema/pragma inspection during open. It does not establish an explicit WAL, busy-timeout, synchronous, connection-reuse, or writer-serialization policy. Job listing also performs counts and search patterns that can scan large collections, although the dominant production path polls one job by identifier.

The earlier recommendation was WAL plus bounded connection reuse, short transactions, and a coordinated writer per Workspace. That direction needs to be checked against Bun's current SQLite implementation, SQLite's actual locking guarantees, the one-database-per-Workspace layout, and indefinite result growth.

## Research brief

- Trace the exact SQL and connection lifecycle for queued creation, lifecycle transitions, individual job retrieval, Source file cleanup, recovery, and list/search paths.
- Use official SQLite and Bun documentation to compare rollback journal versus WAL, synchronous levels, busy handling, transaction modes, checkpoints, and connection reuse.
- Determine an appropriate read/write connection topology for one Bun runtime and one database file per Workspace; do not assume a generic pool is beneficial.
- Verify the indexes and query plan required for repeated lookup of one Extraction job, including its Source file metadata and Extraction results, while lifecycle writes are occurring.
- Estimate and, where practical, measure database growth at one million retained jobs with representative result counts and payload sizes.
- Address WAL checkpointing, vacuum/free-page behavior, integrity/recovery, schema migration frequency, prepared-statement reuse, and startup scanning.
- Separate optimizations needed for the dominant submit/poll path from list/search/export work that can be deferred or isolated.
- Identify failure modes on macOS/Linux local filesystems and safe operational defaults.

## Resolution criteria

- A concrete SQLite operating policy covers connection ownership, WAL/journal mode, synchronous level, busy handling, transactions, checkpoints, migrations, and shutdown.
- Required query/index changes for individual polling and lifecycle writes are supported by query-plan or benchmark evidence.
- The recommendation explains how one million retained jobs per Workspace affects latency, disk usage, and maintenance.
- Tradeoffs and rollback/safety considerations are explicit.
- Expected code seams and a focused validation plan are identified without yet implementing the design.
- Findings are captured in `../research/sqlite-access-and-retention.md` with direct links to primary sources.

## Blocked by

None - can start immediately.

## Comments

Resolved in [`../research/sqlite-access-and-retention.md`](../research/sqlite-access-and-retention.md). Use one long-lived, bounded per-Workspace SQLite owner rather than a pool; adopt WAL+FULL only behind a runtime safety gate, retain the current point-read schema, and remove/replace the proven redundant or retention-scaled indexes.
