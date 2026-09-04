# Indexed work and resource admission

Large durable histories made list searches, recovery, retention and upload admission perform work unrelated to the current request. We retain per-Workspace SQLite authority, add transactionally maintained search/count indexes, and move gateway eligibility ahead of source preparation so sequential Workspace calls cannot consume all global extraction permits.

This revises ADR-0006: drained Workspaces refill directly, buffer overflow requests reconciliation, and a 60-second repair sweep remains for missed hints and abandoned work. Queued work is ordered by its retry due time or initial update time, then ID; attempts owned by the current runner are excluded from stale recovery. Free-space admission is separate from diagnostic filesystem enumeration. WAL with FULL durability is enabled only for SQLite 3.51.3 or newer; the current 3.51.0 runtime retains rollback journaling.

Search uses bounded FTS5 trigram candidates with the original literal predicate as authority. Broad terms use the date-ordered path, and short/NUL-containing terms retain literal scanning. Indexes and exact totals are backfilled once and maintained in the same transaction as job mutations. This spends additional write work and disk space to keep common reads independent of historical volume.

Model preparation reserves an estimated 256 MiB shared budget and caps cumulative rendered PNGs at 64 MiB, keeping existing rendering quality and inline transport. Exports admit at most two workers, 500 Documents and 32 MiB of stored answer/evidence data per request. These bounds protect the local runtime; gateway-managed files and lossy image conversion still require compatibility and extraction-quality evidence before adoption.
