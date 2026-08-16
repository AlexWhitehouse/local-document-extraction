# SQLite access and indefinite Extraction-result retention

Research completed 2026-08-16 against the repository's current Bun runtime and current first-party SQLite/Bun documentation.

## Recommended decision

Use **one long-lived, process-owned `bun:sqlite` connection per active Workspace**, exposed through a bounded, lease-aware Workspace store registry. Route all product-database reads and writes through that owner, including writes produced by any future PDF worker threads. Do **not** build a generic SQLite connection pool: SQLite permits many readers but only one simultaneous writer, Bun's SQLite adapter uses a single connection rather than a pool, and the current synchronous JavaScript runtime already serializes these short database calls. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions) and [Bun's SQLite connection notes](https://bun.sh/docs/runtime/sql)

The target operating mode should be **WAL with `synchronous=FULL`**, short `BEGIN IMMEDIATE` write transactions, a short bounded busy timeout, and default automatic checkpoints initially. However, WAL must have a production safety gate: the installed Bun 1.3.14 reports SQLite 3.51.0, while SQLite documents a rare WAL-reset corruption bug through 3.51.2 when two or more connections in different threads/processes write or checkpoint concurrently. Pin a runtime containing SQLite 3.51.3 or a documented fixed backport before permitting any second connection, background checkpointer, or external writer. Until then, either enforce the single-owner invariant absolutely or keep `journal_mode=DELETE`; the safer rollout order is connection reuse first, fixed SQLite second, WAL third. [SQLite WAL-reset bug](https://www.sqlite.org/wal.html#the_wal_reset_bug) and [SQLite 3.51.3 release](https://sqlite.org/releaselog/3_51_3.html)

Keep the current normalized `jobs`, `source_files`, and `job_results` shape for the first performance pass. The dominant individual poll is already indexed correctly at one million jobs. Make three focused index changes instead:

1. Drop `idx_job_results_job`, because the existing primary-key autoindex on `(job_id, field_id)` already serves the `job_id` prefix lookup.
2. Drop `idx_source_files_job`, because `source_files.job_id UNIQUE` already creates the index used by the join.
3. Replace the full `idx_jobs_status_updated(status, updated_at)` with a covering partial active-work index on `(status, updated_at, id) WHERE status = 'queued' OR status = 'processing'`. This keeps the recovery index proportional to active backlog rather than indefinitely retained terminal history and removes the temporary sort on `id`. SQLite explicitly documents that partial indexes can reduce database size and improve read/write performance when most rows are excluded. [SQLite partial indexes](https://www.sqlite.org/partialindex.html)

At one million retained jobs, no partitioning or database-per-time-window scheme is justified by the measured point-read path. Keep one database per Workspace, add storage telemetry and a low-disk admission guard, and isolate list/search/export maintenance from the submit/poll path. “Indefinite retention” can mean no automatic result TTL, but a finite local disk cannot promise unbounded future submissions; the runtime must surface capacity before the filesystem fills.

## What the application does today

### Connection and schema lifecycle

- Every API submission or job read constructs a new Workspace `Database`, and every construction executes the entire idempotent schema, calls `PRAGMA table_info(jobs)`, conditionally alters columns, and runs `CREATE INDEX IF NOT EXISTS`; the request closes the connection in `finally`. See [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L199-L305), submission cleanup in [`localApplication.ts`](../../../backend/src/localApplication.ts#L560-L670), and poll cleanup in [`localApplication.ts`](../../../backend/src/localApplication.ts#L772-L796).
- Each extraction run opens another connection and holds that handle across Source-file I/O, the remote Model-gateway call, result persistence, lifecycle notification, and Source-file cleanup before closing it. No SQLite transaction spans the remote await, but an unbounded extraction fan-out can still produce an unbounded number of open connections. See [`localExtractionRunner.ts`](../../../backend/src/localExtractionRunner.ts#L142-L295).
- `createProductStore` does not set `journal_mode`, `synchronous`, `busy_timeout`, or `foreign_keys`; a file database therefore uses SQLite/Bun build defaults. The `product_schema_version` table exists, but the current bootstrap does not read or advance it. See the schema bootstrap and schema in [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L258-L305) and [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L1023-L1109).
- `bun:sqlite` caches the compiled statement returned by `db.query()` on a Database instance. Opening a fresh Database per request discards that cache, while a long-lived connection reuses it safely with new bound values. [Bun `db.query()` documentation](https://bun.sh/docs/runtime/sqlite#query)

### Dominant submit/poll writes and reads

- Submission atomically inserts one `source_files` row and one queued `jobs` row. Claim atomically reads the job, conditionally moves it to `processing`, and loads Template fields. Completion atomically upserts the result rows and changes the job to `completed`. These transaction boundaries are correct and should stay short. See [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L479-L684).
- A poll for one job executes two synchronous reads: a job/source summary by `jobs.id`, then all result rows for `job_results.job_id` joined to the immutable Template version for names, types, and display order. See [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L854-L891) and [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L999-L1018).
- Startup recovery searches only `queued` and stale `processing` jobs, so retained completed jobs do not require a full table scan today. The current `(status, updated_at)` index supplies the filter and first ordering column, but `EXPLAIN QUERY PLAN` reports a temporary B-tree for the final `id` ordering term. See [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L761-L828).
- The UI list path is separate from individual polling. It executes `COUNT(*)`, and leading-wildcard `LOWER(...) LIKE '%term%'` search scans the ordered jobs index. See [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts#L921-L987) and the list response in [`localApplication.ts`](../../../backend/src/localApplication.ts#L734-L770). This does not justify changing the point-poll schema; it justifies keeping list/search/export off the admission and polling critical path.

## Primary-source constraints that shape the decision

### Concurrency and transactions

SQLite allows simultaneous read transactions on separate connections but only one simultaneous write transaction. `BEGIN IMMEDIATE` starts the write transaction immediately and therefore discovers writer contention before performing the read half of a read-then-write transition. [SQLite transactions](https://www.sqlite.org/lang_transaction.html)

For this Bun server, more product-database connections do not create useful CPU parallelism by themselves: `bun:sqlite` calls are synchronous, Bun documents each SQLite `SQL` instance as one connection rather than a database-style pool, and all current store methods finish their transactions without an `await`. A single owner also gives one place to enforce migrations, PRAGMAs, shutdown, deletion invalidation, and metrics. [Bun SQLite](https://bun.sh/docs/runtime/sqlite) and [Bun SQL SQLite notes](https://bun.sh/docs/runtime/sql)

If future PDF rendering uses Bun Workers, workers should return prepared work/results to the runtime's database owner rather than opening Workspace databases themselves. This preserves one-writer ownership, prevents lock storms, and decouples CPU concurrency from persistence concurrency.

### WAL, durability, and checkpoints

WAL normally improves throughput, makes database I/O more sequential, and lets readers proceed while the writer appends. It still has only one writer. The default automatic checkpoint runs when the WAL reaches 1,000 pages; checkpoints can be delayed by long read transactions, and an ever-present reader can cause checkpoint starvation and unbounded WAL growth. WAL also requires all clients to be on the same host and must not be used over a network filesystem, which matches the local-machine destination. [SQLite WAL overview, concurrency, and checkpointing](https://www.sqlite.org/wal.html)

In WAL mode, `synchronous=NORMAL` remains consistent but can roll back recently committed transactions after a power loss or hard reset; `synchronous=FULL` adds a WAL sync at each commit and is ACID across power loss. Because a queued job can already have a durable Source file and completed results must remain available indefinitely, `FULL` is the safe default. Make `NORMAL` an explicit operator tradeoff only if losing the latest committed jobs after host power loss is acceptable. [SQLite `PRAGMA synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)

The current runtime probe is important:

```text
bun --version                       -> 1.3.14
SELECT sqlite_version()             -> 3.51.0
PRAGMA compile_options              -> DEFAULT_WAL_AUTOCHECKPOINT=1000
                                       DEFAULT_WAL_SYNCHRONOUS=1
                                       DEFAULT_PAGE_SIZE=4096
```

SQLite now documents that versions 3.7.0 through 3.51.2 are likely affected by a rare WAL-reset corruption race requiring at least two connections on separate threads/processes and concurrent write/checkpoint activity. The connection-owner design removes those preconditions, but a version gate is still warranted because a backup utility or future worker could accidentally introduce a second connection. [SQLite WAL-reset bug](https://www.sqlite.org/wal.html#the_wal_reset_bug)

On macOS, Bun also documents that Apple's SQLite build may keep `-wal` and `-shm` sidecars after close. A database file must never be copied, moved, or deleted independently of live WAL state. Bun exposes `SQLITE_FCNTL_PERSIST_WAL` and shows a truncating checkpoint for portable graceful cleanup. [Bun WAL sidecar cleanup](https://bun.sh/docs/runtime/sqlite#wal-sidecar-file-cleanup)

## Empirical evidence from this repository and target machine

All probes used generated temporary databases and removed them afterward. They did not modify product data. Numbers are comparative evidence for this machine, not portable latency guarantees.

### Fresh-open overhead

On the current Apple Silicon target, 1,000 repetitions of “open the current store, rerun schema inspection, read one queued job, close” took 193.6 ms total (193.6 microseconds per poll). Reusing one initialized store for the same 1,000 reads took 9.13 ms total (9.13 microseconds each), a 21.2x reduction in the measured database/store portion. This is a small-database warm-cache microbenchmark, but it directly demonstrates that per-request open/schema/close work is avoidable and prevents Bun's statement cache from paying off.

### Query plans

`EXPLAIN QUERY PLAN` against the current schema reported:

| Path | Plan evidence | Finding |
| --- | --- | --- |
| Job summary | `SEARCH j USING INDEX sqlite_autoindex_jobs_1 (id=?)`; `SEARCH s USING INDEX sqlite_autoindex_source_files_2 (job_id=?)` | Primary/unique indexes already make individual polling logarithmic. |
| Results | jobs primary-key lookup; Template-field ordered index; `SEARCH r USING INDEX sqlite_autoindex_job_results_1 (job_id=? AND field_id=?)` | The composite primary-key autoindex is used; `idx_job_results_job` is redundant. |
| Recovery | `SEARCH jobs USING INDEX idx_jobs_status_updated (status=? ...)` plus `USE TEMP B-TREE FOR LAST TERM OF ORDER BY` | Add `id` to the active-work index. |
| Normal list | ordered scan of `idx_jobs_created_id` with `LIMIT` | Keyset list remains bounded. |
| Leading-wildcard search | scan of `idx_jobs_created_id` | Search is not a point-poll concern and needs separate FTS/isolation work if it becomes important. |

A prototype active-work index:

```sql
CREATE INDEX idx_jobs_active_updated_id
ON jobs(status, updated_at, id)
WHERE status = 'queued' OR status = 'processing';
```

was selected as a covering index for both current recovery queries, including the full `ORDER BY updated_at, id`, with no temporary B-tree. The OR terms are deliberately written to match the literal recovery predicates under SQLite's documented partial-index implication rules. [SQLite partial-index query rules](https://www.sqlite.org/partialindex.html#queries_using_partial_indexes)

### One-million-job retention probe

The current production schema was populated with:

- 1,000,000 completed jobs;
- 1,000,000 retained Source-file metadata rows, with the Source content itself absent;
- 5 results per job (5,000,000 result rows);
- per-result payloads of 59 bytes of JSON answer, 30 bytes of normalized text, and 106 bytes of evidence.

Seeding used one transaction with journaling disabled only to make fixture generation practical; its insertion rate is not a production result. After `PRAGMA optimize`, the database was 3,261,235,200 bytes (3.04 GiB), about 3.26 KB per retained job for this five-small-field distribution. Ten thousand deterministic, uniformly distributed, warm-cache lookups using the actual two-query shape measured 262 microseconds p50, 455 microseconds p95, 545 microseconds p99, and 2.78 ms maximum. The database fit in the target machine's filesystem cache, so cold-cache and end-to-end authenticated HTTP tests are still required, but the probe shows no point-query cliff at one million rows.

`dbstat` attributed 259,465,216 bytes to the redundant `idx_job_results_job` and 51,867,648 bytes to the redundant `idx_source_files_job`. Dropping them avoids about 297 MiB, or 9.5% of this fixture, as well as their insert/update work. The current full status index consumed another 48,807,936 bytes even though every fixture job was terminal; the partial active-work replacement makes that cost track backlog instead.

The 3.04 GiB number is not a universal capacity estimate. Large objects, arrays, tables, long evidence, more Template fields, and failure messages grow the database roughly with stored payload bytes plus B-tree overhead. Record actual `answer_json`, evidence, and total database bytes per completed job; capacity planning should use high-percentile real jobs rather than only averages.

### Journal microbenchmark

A separate single-connection probe inserted 2,000 jobs using three `BEGIN IMMEDIATE` commits per job (queued creation, claim, and five-result completion):

| Mode | Jobs/s | Commits/s |
| --- | ---: | ---: |
| rollback `DELETE`, `FULL` | 1,229 | 3,686 |
| `WAL`, `FULL` | 3,551 | 10,654 |
| `WAL`, `NORMAL` | 11,396 | 34,189 |

This simplified warm-filesystem probe excludes HTTP, auth, PDFs, and the remote Model gateway, so it is not an application throughput claim. It shows two useful things: WAL+FULL materially reduces rollback-journal churn on this host, and FULL already supports far more lifecycle commits than the remote extraction path is likely to complete. The additional NORMAL-mode speed is not worth silently weakening the indefinite-retention durability contract.

## Concrete operating policy

### Connection ownership

1. Introduce a process-scoped Workspace product-store registry. It owns at most one read/write Database per active Workspace and returns lightweight leases, not raw independently closable connections.
2. Keep registry size bounded with idle/LRU eviction and reference counts. Never evict a store with an active lease. A runner may keep a lease while awaiting the Model gateway, but the connection must remain shareable because it has no open transaction during that await.
3. Run every database method synchronously on the owner. Marshal persistence requests from any worker thread back to this owner.
4. On Workspace deletion, prevent new leases, wait for active operations using the existing operation coordinator, close/checkpoint the owner, evict it, then erase the database and sidecars.
5. At process shutdown, stop admission, drain short transactions, checkpoint/close each owner, and then close the control database.

### Open and migration sequence

For each Workspace's first open in a process:

1. Open the database and record `sqlite_version()` and relevant compile options.
2. Set `PRAGMA foreign_keys=ON` and `PRAGMA busy_timeout=250`. The 250 ms timeout is a deliberately short starting ceiling because `bun:sqlite` is synchronous and a long busy handler would stall the HTTP event loop; any hit should be counted and investigated.
3. After the runtime safety gate, set `PRAGMA journal_mode=WAL` outside a transaction and verify that the returned mode is `wal`. Until that gate passes, stay on `DELETE` unless the code can enforce the one-connection/no-external-checkpoint invariant.
4. Explicitly set `PRAGMA synchronous=FULL` after selecting the journal mode. This matters because the probed Bun build advertises `DEFAULT_WAL_SYNCHRONOUS=1` (NORMAL); do not rely on its default.
5. Run explicit numbered migrations once under an immediate transaction and advance the existing `product_schema_version`. Do not execute the whole schema or `PRAGMA table_info` on every lease/request.
6. Run `PRAGMA optimize=0x10002` on the newly long-lived connection and `PRAGMA optimize` periodically during idle time and after index migrations. This is SQLite's documented pattern for long-lived connections. [SQLite `PRAGMA optimize`](https://www.sqlite.org/pragma.html#pragma_optimize)

Keep the default 4 KiB page size, default page cache, `mmap_size=0`, and `auto_vacuum=NONE` initially. The measured lookup is already fast, while larger per-Workspace caches compete with PDF/model memory. Auto-vacuum is unnecessary for append-dominant indefinite retention, can add fragmentation, and cannot be enabled on existing databases without a rebuild. Freed pages from occasional deletes remain reusable. [SQLite `auto_vacuum`](https://www.sqlite.org/pragma.html#pragma_auto_vacuum) and [SQLite VACUUM](https://sqlite.org/lang_vacuum.html)

### Transactions and busy handling

- Use Bun's `.transaction.immediate` for create, claim, complete, delete, recovery, and any other read-then-write or multi-write transition. Bun exposes deferred, immediate, and exclusive transaction variants directly. [Bun transactions](https://bun.sh/docs/runtime/sqlite#transactions)
- Keep transactions to database work only. Never perform PDF parsing, file I/O, network calls, sleeps, event broadcasting, or analytics emission within them.
- Do not retry `SQLITE_BUSY` in a tight synchronous loop. A busy from the single-owner design is unexpected external contention; emit a metric, release the event loop, and use a bounded async retry or a retryable HTTP/runner result.
- Do not batch unrelated jobs into one very large transaction by default. Short job-level transactions bound rollback/WAL growth and preserve the existing recovery semantics. A later benchmark may group only the lightest lifecycle writes if commit cost is proven material.

### Checkpoint and shutdown policy

- Start with SQLite's 1,000-page automatic passive checkpoint, which is about 4 MiB at the current page size. Record WAL bytes and checkpoint results under sustained load before changing it.
- Do not run FULL/RESTART/TRUNCATE checkpoints on request handlers. If auto-checkpoint causes commit-tail spikes, schedule a PASSIVE checkpoint from the same Workspace owner during idle gaps; do not add a second checkpointer until the runtime is on a WAL-reset-fixed SQLite.
- On graceful final close or before database deletion/move, use a truncating checkpoint only after admission is stopped and all leases are released. On macOS, disable persistent WAL through Bun's documented file-control before cleanup. A crash may legitimately leave `-wal` and `-shm`; treat them as part of the database, not disposable temporary files. [SQLite WAL files](https://www.sqlite.org/wal.html#the_wal_file) and [Bun sidecar cleanup](https://bun.sh/docs/runtime/sqlite#wal-sidecar-file-cleanup)

## Retention, maintenance, and recovery

- Keep completed/failed job metadata and result rows without a TTL. Track database bytes, WAL bytes, freelist pages, result payload bytes/job, retained jobs, and free filesystem bytes. Stop admitting new Documents at a configurable low-disk reserve rather than discovering disk exhaustion during result completion. Never auto-delete retained results to recover space.
- Dropping redundant indexes only places pages on the freelist; SQLite reuses them, but the file does not shrink under `auto_vacuum=NONE`. Do not block startup with `VACUUM`. If physical compaction is needed, expose an offline/maintenance operation after checking for enough temporary space; SQLite notes that ordinary VACUUM can require up to twice the database size. [SQLite VACUUM](https://sqlite.org/lang_vacuum.html)
- Use a consistent SQLite snapshot for backups. Do not copy only the `.sqlite` file while WAL is live. SQLite's Online Backup API is incremental, while `VACUUM INTO` creates a compact consistent snapshot at higher CPU/I/O cost. Bun's full `serialize()` materializes the database in memory and is not appropriate once the database is multiple GiB. [SQLite Online Backup API](https://www.sqlite.org/backup.html), [SQLite `VACUUM INTO`](https://sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause), and [Bun `serialize()`](https://bun.sh/docs/runtime/sqlite#serialize)
- Run `PRAGMA quick_check` on restored backups and periodically during an idle maintenance window; run the more expensive `integrity_check` less frequently. SQLite documents quick-check as O(N), while full integrity-check also verifies index consistency and is O(N log N). [SQLite integrity PRAGMAs](https://www.sqlite.org/pragma.html#pragma_quick_check)
- Startup recovery should remain indexed by active status but should page/stream a very large queued backlog rather than calling `.all()` for every queued job at once. This is a backlog-memory concern, not a one-million-completed-jobs concern.

## Changes deliberately deferred

- **No generic read pool.** A second read connection is only justified if database work moves to a separate execution thread and profiling proves main-thread database latency is a bottleneck. It must not become a second writer.
- **No time partitioning or separate result database.** Point reads remain sub-millisecond in the warm one-million-job probe; partitioning would complicate lookup, migration, backup, and retention without evidence.
- **No immediate `WITHOUT ROWID` rebuild.** `job_results` has a composite text primary key and its autoindex is sizable, so this deserves a prototype. SQLite says `WITHOUT ROWID` can save space for composite keys but may be slower when rows are relatively large; current result rows can contain large JSON/evidence. Benchmark realistic scalar and table-heavy distributions before accepting a multi-million-row rebuild. [SQLite WITHOUT ROWID](https://www.sqlite.org/withoutrowid.html)
- **No FTS/search redesign in the submit/poll change.** Leading-wildcard UI search scans at scale, but it is not used by the dominant individual result worker. Isolate it or add FTS only if its own acceptance workload requires it.
- **No synchronous exact total on the critical path.** `COUNT(*)` belongs to the list UI. It can become approximate/cached or separately refreshed later without changing individual polling.

## Expected code seams

- Add a `LocalWorkspaceProductStoreRegistry` beside [`localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts) with lease, release, invalidate, and close-all operations.
- Inject the same registry into `createLocalApplication`, `createLocalExtractionRunner`, Workspace deletion/recovery, and shutdown wiring in [`server.ts`](../../../backend/src/server.ts). Preserve the store interface so SQL/domain operations do not leak into HTTP or queue code.
- Replace ad hoc schema inspection with explicit migrations using the existing version table. Include the redundant-index drops and partial active-work index migration.
- Centralize PRAGMA application and runtime SQLite safety checks in the registry/open seam; expose selected journal mode/version through diagnostics.
- Keep backups, VACUUM, integrity checks, and large list/search/export operations in a maintenance seam that is separately scheduled and cannot block admission indefinitely.

## Focused validation plan

1. **Connection invariant:** With 1,000 concurrent authenticated poll tasks and active extraction completions, assert exactly one product Database per Workspace, no close while leased, bounded idle stores, and zero unexpected `SQLITE_BUSY` events.
2. **Runtime safety:** Test vulnerable and fixed `sqlite_version()` decisions. Refuse multi-connection WAL/checkpointer configuration on 3.51.0; verify the actual production Bun binary during startup.
3. **Query plans:** Seed terminal history plus queued/processing rows; assert no table scan on job/result lookup, verify the partial active index serves both recovery queries without a temp sort, and confirm dropped indexes are absent.
4. **Retention scale:** Build a one-million-job fixture with at least scalar-heavy and table-heavy result distributions. Measure database/WAL bytes, cold and warm authenticated `GET /v1/jobs/:id` p50/p95/p99, CPU, memory, and writes while 1,000 clients obey the polling contract.
5. **Long-run checkpoint:** Sustain submit/claim/complete/poll traffic long enough to cross many checkpoints. Assert WAL size remains bounded, commit tail latency is visible, and no reader transaction is held across an await.
6. **Crash/recovery:** Kill the runtime after each lifecycle boundary, restart, and confirm queued/stale processing recovery, completed result visibility, Source-file cleanup semantics, and no duplicate result rows.
7. **Backup/restore:** Take a live consistent snapshot, restore it to a separate directory, run quick/integrity checks, and sample job/results across the retained range.
8. **Deletion/invalidation:** Delete a Workspace under active poll/runner leases; assert admission stops, leases drain, the connection checkpoints/closes, and database plus sidecars are erased only afterward.

## Bottom line

The earlier “WAL plus bounded connection reuse” hypothesis is directionally right but too generic. The best fit here is **one bounded, long-lived owner per active Workspace, not a pool**, with **WAL+FULL after a runtime safety gate**, immediate short writes, automatic checkpoints initially, versioned migrations once, and storage/backup operations isolated from live traffic. One million retained jobs does not require an architectural database replacement: the current point indexes scale, and focused index cleanup removes roughly 10% of the measured small-result fixture while keeping recovery cost proportional to active work.
