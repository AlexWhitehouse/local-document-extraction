# Performance notes

This guide describes performance controls as job, document, and user counts increase. [ADR-0009](../backend/docs/adr/0009-indexed-work-and-resource-admission.md) and [ADR-0010](../backend/docs/adr/0010-ram-aware-model-preparation.md) record the design decisions.

## Job lists and search

- **Paging** uses a cursor, also called keyset pagination. Later pages remain as fast as the first.
- **Totals and per-status counts** update through SQLite triggers. The server does not recount them for every request. Job lists include `total` and `status_counts`. `/v1/jobs/counts` returns only the counts.
- **Search** uses a SQLite FTS5 trigram index to find candidates. Each candidate must then match a literal substring without case sensitivity. Results match a plain substring search, including `%`, `_`, quotes, and backslashes. Searches shorter than three characters and very broad searches use an ordered scan.
- The migration fills these indexes from existing jobs. On large databases, the first start after an upgrade takes longer and requires more disk space.

## Extraction queue

- By default, extraction starts with 16 simultaneous jobs and can adapt up to 32. Explicit environment settings replace these defaults. Changes apply after server restart.
- Within a Workspace, packet processing and ready extraction alternate when both stages are waiting. FIFO order is preserved within each stage so a packet backlog cannot starve its child Documents.
- Before each job starts, the queue reads the Workspace's current sequential-calls setting. Jobs waiting for a sequential Workspace keep only a small amount of queue metadata in memory.
- An empty Workspace queue refills from SQLite. Queue overflow also causes recovery from SQLite.
- The runtime reconciles the queue with SQLite every minute (`EXTRACTION_RECONCILE_INTERVAL_MS`) to recover missed work. Recovery does not take over running attempts. It orders jobs by `COALESCE(next_retry_at, updated_at)`, then ID.

## Memory for preparing documents

Preparation renders PDF pages and encodes the model request. A shared budget reserves the required memory:

- The default budget is 90% of the process memory allowance. With `LOCAL_MEMORY_LIMIT_RATIO=0.8`, this equals 72% of physical RAM. `MODEL_PREPARATION_MAX_BYTES` can decrease it. This replaces the earlier fixed budget of 256 MiB.
- The renderer processes PDF pages one at a time as PNGs at their normal resolution. Encoded images cannot exceed 64 MiB in total.
- Worst-case derivative reservations decrease after materialization to the actual source/artifact size. After model request preparation, they decrease again to the retained request size.
- Large requests can wait for free memory. Reservations are estimates and do not limit actual native-decoder memory use. Memory-pressure controls therefore remain active.
- `/v1/health` shows the budget, reserved amount, and number of waiting requests.

## Uploads

- Eight isolated PDF inspectors and four isolated page-operation workers reuse their parser for up to 32 requests or 64 MiB of source input. Workers retire on errors, at 128 MiB sampled RSS, and after five seconds idle. Per-document parser limits and cancellation remain active; this is a sampled recycling threshold, not an OS memory ceiling.
- If resource sampling fails, admission drains the upload and returns a retryable `503` before accepting work. A later retry can proceed after sampling recovers.
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
- SQLite uses `FULL` durability. WAL requires SQLite 3.51.3 or newer, which includes [the WAL reset fix](https://sqlite.org/wal.html#walreset). Older versions use rollback journaling. The installed Bun 1.4.2 reports SQLite 3.53.2, so WAL is enabled. The runtime checks the actual SQLite version rather than inferring it from the Bun version.

References: [Bun Workers](https://bun.sh/docs/runtime/workers), [SQLite FTS5 trigram tokenizer](https://sqlite.org/fts5.html#the_trigram_tokenizer).

## Benchmark measurements

Use `bun run benchmark:loopback-saturation` for the real preparation, automatic selection, splitting, and extraction paths with simulated model replies. CPU profiling is opt-in through `LOOPBACK_BENCH_CPU_PROFILE=true`: [Bun 1.4.2 can retain sampled closures and their captured buffers](https://github.com/oven-sh/bun/issues/42377). Profiled runs are diagnostic; use unprofiled runs for capacity and memory comparisons. Reports distinguish API RSS from the sum for its process tree, which includes PDF workers and may count shared pages more than once.


A 2026-10-04 run on Bun 1.4.2, Linux x64, six logical CPUs and 11.4 GiB RAM used two-page PDFs, a 1 MiB inline attachment, 100 ms simulated model latency, 24 runners, 48 submitters and a 96-item offered backlog. Each pass ran for 60 seconds with a 10-second warm-up and a separate drain. Preparation was limited to 512 MiB; eight inspectors and four page-operation workers used a five-second idle timeout.

| Inline PDF scenario | Completed uploads/s | Extracted Documents/s | Upload p95 | Peak API RSS | Peak API + worker RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Explicit template | 55.34 | 55.34 | 297 ms | 530 MiB | 1,012 MiB |
| Smart splitting + automatic selection | 18.04 | 36.09 | 6,912 ms | 352 MiB | 1,025 MiB |

All 4,414 accepted uploads completed, with no failed Documents, network errors, or resource pauses. Capacity rejections were retried as directed. An earlier eight-scenario matrix also completed all 7,884 uploads and 10,134 Documents. It used the shorter one-second worker idle timeout; extending that timeout reduced repeated process startup between upload bursts. Rendered PDFs remained substantially slower because page rendering repeats for model stages.

A final check using the five-second idle timeout, 32 inspectors, 48 runners and 96 submitters reached 500 ms event-loop lag and reduced throughput to 36.91 uploads/s through protective pauses. Peak process-tree RSS rose to 2.51 GiB. The selected eight-inspector configuration retained better throughput and latency. Doubling page-operation workers from four to eight and preparation from 512 MiB to 1 GiB barely improved the split test while raising event-loop lag. These are single-host observations, not real-model service capacity guarantees. The former 7.34 uploads/s run included CPU profiling, so the improvement reflects both pipeline changes and removal of measurement overhead.
