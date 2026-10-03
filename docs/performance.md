# Performance notes

How the app stays responsive as jobs, documents, and users add up. The design trade-offs are recorded in [ADR-0009](../backend/docs/adr/0009-indexed-work-and-resource-admission.md) and [ADR-0010](../backend/docs/adr/0010-ram-aware-model-preparation.md).

## Job lists and search

- **Paging** uses a cursor (keyset pagination), so later pages are as fast as the first.
- **Totals and per-status counts** are kept up to date by SQLite triggers instead of being counted on every request. Job lists return them as `total` and `status_counts`, and `/v1/jobs/counts` returns just the counts.
- **Search** uses a SQLite FTS5 trigram index to find candidate jobs, then checks each one for a literal, case-insensitive match. Results are the same as a plain substring search, including for `%`, `_`, quotes, and backslashes. Searches shorter than three characters, and very broad ones, fall back to scanning in order.
- The migration that adds these indexes fills them from existing jobs. On a large existing database, the first start after upgrading takes longer and uses extra disk space.

## Extraction queue

- Extraction starts with 16 simultaneous jobs and can adapt up to 32 by default. Explicit environment settings override these defaults; changes apply when the server restarts.
- Before starting each job, the queue checks the Workspace's current sequential-calls setting. Jobs waiting behind a sequential Workspace hold only a small amount of queue metadata in memory.
- When a Workspace's in-memory queue runs dry, it refills from SQLite. The same happens if the in-memory queue overflows.
- The queue is also checked against the database every minute (`EXTRACTION_RECONCILE_INTERVAL_MS`), as a safety net for missed work. Recovery never takes over an attempt that's still running, and it picks up jobs in order of `COALESCE(next_retry_at, updated_at)`, then ID.

## Memory for preparing documents

Before a document is sent to the model it's prepared: PDF pages are rendered and the request is encoded. That memory is reserved from a shared budget:

- The default budget is 90% of the process's memory allowance, which works out to 72% of physical RAM with the default `LOCAL_MEMORY_LIMIT_RATIO=0.8`. `MODEL_PREPARATION_MAX_BYTES` can lower it. This replaced an earlier fixed budget of 256 MiB.
- PDF pages are rendered one at a time, as PNGs at their usual resolution, until they reach 64 MiB of encoded images in total.
- Once the request is built, its reservation shrinks to match the request's actual size.
- Large requests may wait until memory is free. Reservations are estimates and don't cap the memory native decoders actually use, so the memory-pressure controls stay active as a backstop.
- `/v1/health` shows the budget, the amount reserved, and how many requests are waiting.

## Uploads

- The free-space check before accepting an upload doesn't walk old upload folders. Emptied job folders are removed when their files are deleted, and a slower background task keeps the storage figures accurate.
- In the browser, a batch upload sends two files at a time. It retries a file at most twice, and only when the server says it's temporarily at capacity before accepting it.
- Signing out stops files that haven't been sent yet. Switching Workspace mid-batch still sends the remaining files to the Workspace the batch started in.

## Exports

- One export can include at most 500 documents and 32 MiB of stored results. Larger requests get `413 export_too_large`.
- At most two exports run at once. Others get `503 export_capacity_unavailable` with `Retry-After: 2`.
- Spreadsheets are built in a worker thread, so they don't block other requests. A build is cancelled if the request or Workspace goes away, and it times out after 60 seconds.

## Browser

- Document lists with more than 100 rows only render the visible rows. Keyboard navigation (arrows, Home, End) follows the selection, and changing the selection doesn't re-sort the list.
- Cached API responses are limited to 50 entries and 4 MiB. The cache of completed documents kept between visits is limited to 2 MiB in total and 50 entries per Workspace. Results too big for the cache are shown but not cached.
- Cache sizes are estimated from the serialised text, not measured from actual memory use.

## Analytics

Analytics events are written in batches of up to 64 KiB, with at most 1 MiB waiting. If the disk can't keep up, events are dropped and a warning reports how many. Extraction data is unaffected. Accepted events are written out on shutdown.

## Static files and SQLite

- Frontend files with a content hash in their name are cached permanently. HTML and everything else is revalidated.
- SQLite always uses `FULL` durability. It only uses WAL mode on SQLite 3.51.3 or newer, which includes [a fix for a WAL reset bug](https://sqlite.org/wal.html#walreset), and uses rollback journaling on anything older. Bun 1.4.2 bundles SQLite 3.54.0, so WAL is normally on.

References: [Bun Workers](https://bun.sh/docs/runtime/workers), [SQLite FTS5 trigram tokenizer](https://sqlite.org/fts5.html#the_trigram_tokenizer).
