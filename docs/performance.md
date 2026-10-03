# Performance notes

This guide describes performance controls as job, document, and user counts increase. [ADR-0009](../backend/docs/adr/0009-indexed-work-and-resource-admission.md) and [ADR-0010](../backend/docs/adr/0010-ram-aware-model-preparation.md) record the design decisions.

## Job lists and search

- **Paging** uses a cursor, also called keyset pagination. Later pages remain as fast as the first.
- **Totals and per-status counts** update through SQLite triggers. The server does not recount them for every request. Job lists include `total` and `status_counts`. `/v1/jobs/counts` returns only the counts.
- **Search** uses a SQLite FTS5 trigram index to find candidates. Each candidate must then match a literal substring without case sensitivity. Results match a plain substring search, including `%`, `_`, quotes, and backslashes. Searches shorter than three characters and very broad searches use an ordered scan.
- The migration fills these indexes from existing jobs. On large databases, the first start after an upgrade takes longer and requires more disk space.

## Extraction queue

- By default, extraction starts with 16 simultaneous jobs and can adapt up to 32. Explicit environment settings replace these defaults. Changes apply after server restart.
- Before each job starts, the queue reads the Workspace's current sequential-calls setting. Jobs waiting for a sequential Workspace keep only a small amount of queue metadata in memory.
- An empty Workspace queue refills from SQLite. Queue overflow also causes recovery from SQLite.
- The runtime reconciles the queue with SQLite every minute (`EXTRACTION_RECONCILE_INTERVAL_MS`) to recover missed work. Recovery does not take over running attempts. It orders jobs by `COALESCE(next_retry_at, updated_at)`, then ID.

## Memory for preparing documents

Preparation renders PDF pages and encodes the model request. A shared budget reserves the required memory:

- The default budget is 90% of the process memory allowance. With `LOCAL_MEMORY_LIMIT_RATIO=0.8`, this equals 72% of physical RAM. `MODEL_PREPARATION_MAX_BYTES` can decrease it. This replaces the earlier fixed budget of 256 MiB.
- The renderer processes PDF pages one at a time as PNGs at their normal resolution. Encoded images cannot exceed 64 MiB in total.
- After request preparation, the reservation decreases to the actual request size.
- Large requests can wait for free memory. Reservations are estimates and do not limit actual native-decoder memory use. Memory-pressure controls therefore remain active.
- `/v1/health` shows the budget, reserved amount, and number of waiting requests.

## Uploads

- The free-space check does not scan old upload folders. File deletion removes empty job folders. A slower background task maintains storage totals.
- Browser batch uploads send two files at a time. A file can have at most two retries. Retries apply only when the server reports temporary capacity exhaustion before acceptance.
- Sign-out stops files that have not been sent. A Workspace change during a batch does not change its destination. Remaining files use the original Workspace.

## Exports

- Each export permits at most 500 documents and 32 MiB of stored results. Larger requests receive `413 export_too_large`.
- At most two exports run simultaneously. Additional requests receive `503 export_capacity_unavailable` and `Retry-After: 2`.
- A worker thread builds spreadsheets without blocking other requests. Request cancellation or Workspace removal cancels the build. The build times out after 60 seconds.

## Browser

- Lists with more than 100 documents render only visible rows. Arrow, Home, and End navigation tracks the selection. A selection change does not sort the list again.
- The API response cache permits at most 50 entries and 4 MiB. The completed-document cache between visits permits 2 MiB in total and 50 entries per Workspace. Larger results remain visible but are not cached.
- Cache size estimates use serialized text. They do not measure actual memory use.

## Analytics

Analytics writes use batches of at most 64 KiB. At most 1 MiB can wait for storage. If the disk cannot keep up, the runtime drops events and reports their count in a warning. Extraction data remains unchanged. Shutdown writes all accepted events.

## Static files and SQLite

- Frontend files with content hashes in their names use permanent caching. HTML and other files require revalidation.
- SQLite uses `FULL` durability. WAL requires SQLite 3.51.3 or newer, which includes [the WAL reset fix](https://sqlite.org/wal.html#walreset). Older versions use rollback journaling. Bun 1.4.2 includes SQLite 3.54.0, so WAL is normally enabled.

References: [Bun Workers](https://bun.sh/docs/runtime/workers), [SQLite FTS5 trigram tokenizer](https://sqlite.org/fts5.html#the_trigram_tokenizer).
