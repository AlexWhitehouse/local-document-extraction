# Performance audit — 4 September 2026

There are substantial wins available without changing the product, and several architectural changes worth pursuing. Start with upload admission, pagination, and gateway scheduling. Search and recovery become important as durable history and queue depth grow. Existing ADRs should be revised where measurements justify it.

This records the original audit before production changes. The subsequent implementation and measurements are in [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Measured findings

Local synthetic fixtures on Apple M3 Pro, Bun 1.4.1, bundled SQLite 3.51.0. SQL figures are warm medians, with two warmups and 5–9 samples. Current queries call production store methods. Candidate queries preserve the selected columns and tested results. No customer files, `.local` databases, real credentials, or external model calls were used.

| Opportunity | Current measurement | Candidate measurement | Effort |
| --- | --- | --- | --- |
| Deep cursor pagination, 1m jobs, 90% into history | 57.82 ms | 0.049 ms | Small |
| Retention, 1m terminal jobs, 100 undeleted sources | 324.09 ms | 0.053 ms | Small–medium |
| Retention, 1m terminal jobs, no sources left | 339.45 ms | 0.014 ms | Small–medium |
| Upload admission, 10k empty job directories | 311.32 ms for one capacity check | Remove directory enumeration from admission; not yet measured | Small–medium |
| No-match substring search, 1m jobs | 462.43 ms | Indexed search candidate; not yet measured | Medium |
| Recover first 1,000 jobs from 1m queued jobs | 155.47 ms per recovery query | Indexed ready-work scheduling; not yet measured | Medium |
| Five-write job lifecycle, rollback journal vs WAL, both FULL | 1.35 ms | 0.34 ms | Medium, runtime prerequisite |
| Eight sequential jobs from workspace A, then one from B | 8 active slots; only A has started a gateway call; B waits | Admit only gateway-eligible work; not yet implemented | Medium |

These are operation timings, not end-to-end extraction speedups. The WAL experiment uses zero result rows and excludes source I/O and model time. Directory timings are single observations, not medians. Fixtures have repeated timestamps to exercise pagination tie-breaking. Candidate equality checks cover those fixtures, not the entire behavioral contract. Large histories are scale tests, not claims about the user's current data volume.

Raw evidence: [query and reconciliation results](results.json), [pipeline results](pipeline-results.json).

## 1. Remove historical filesystem scans from upload admission

**Priority: high.** [localResourceController.ts](../../backend/src/localResourceController.ts#L264) combines free-space measurement with recursive source-size accounting. `canReserveSubmission` awaits that entire operation when its sample is two seconds old. Separately, periodic sampling refreshes storage after 60 seconds.

[localSourceFileStore.ts](../../backend/src/localSourceFileStore.ts#L35) deletes the binary but leaves its per-job directory. The walker therefore keeps visiting completed-job directories indefinitely. Ten thousand empty directories, containing **zero source bytes**, took 398 ms to sample and 311 ms for an admission check. These are asynchronous filesystem waits, not one continuous synchronous event-loop block, but the upload still waits for them.

Split cheap `statfs` capacity checks from diagnostic directory accounting. Coalesce concurrent sampling. Maintain source-byte totals on promotion and deletion, with infrequent background reconciliation. Remove the empty job directory after successful file deletion using a nonrecursive empty-directory operation. Measure admission latency after the split with both empty history and retained-source backlogs.

## 2. Make cursor pagination seek directly into the existing index

**Priority: high; easiest measured win.** [localWorkspaceProductStore.ts](../../backend/src/localWorkspaceProductStore.ts#L1103) uses:

```sql
j.created_at < ? OR (j.created_at = ? AND j.id < ?)
```

The measured plan is `SCAN j USING INDEX idx_jobs_created_id`. Replacing it with:

```sql
(j.created_at, j.id) < (?, ?)
```

changes the plan to `SEARCH ... ((created_at,id)<(?,?))`, using the existing index. At 100k jobs the query fell from 5.34 to 0.049 ms; at 1m from 57.82 to 0.049 ms. The cursor format and ordering can stay the same. SQLite documents this pattern for [scrolling window queries](https://www.sqlite.org/rowvalue.html#scrolling_window_queries).

Before shipping, exercise tied timestamps, deleted cursor rows, date/model filters, search, and full pagination traversal. The first page is already fast: 0.044 ms at 1m rows before the separate total count.

## 3. Acquire gateway capacity before consuming extraction slots and preparing payloads

**Priority: high for sequential configurations and multiple workspaces.** [localExtractionQueue.ts](../../backend/src/localExtractionQueue.ts#L93) limits active handlers. [modelGateway.ts](../../backend/src/consumer/modelGateway.ts#L100) separately serializes gateway calls, **after** reading, rendering, and base64 preparation.

The actual queue and gateway scheduler, with locally stubbed HTTP, reproduced eight occupied handlers for workspace A but only one gateway call. Workspace B stayed pending. Seven handlers were waiting for A's serial gateway turn while holding prepared payloads and product-store leases. Round-robin pending queues cannot recover permits already occupied by these waiters. Adaptive concurrency can mistake these waiters for productive saturation and prepare more payloads.

Use gateway eligibility in dispatch: per-workspace concurrency one for sequential configurations, plus a global resource bound. Reserve that capacity before source reads/rendering and count actual stage work separately from waiting. Preserve the attempt's configuration snapshot, cancellation, and workspace-deletion coordination. If different workspaces share one physically constrained endpoint, consider an explicit gateway capacity pool; do not silently infer shared credentials or configuration.

Also align recovery's five-minute stale threshold with actual active ownership: waiting inside the serial scheduler contributes to job age, but the gateway timeout starts only when the HTTP call starts. Long waits can make still-owned jobs look stale. Test this while changing scheduling so optimization does not create duplicate model work.

## 4. Query retention from the small outstanding set

**Priority: medium–high at large history sizes.** [localWorkspaceProductStore.ts](../../backend/src/localWorkspaceProductStore.ts#L1128) starts from terminal jobs and joins sources to discover that almost all are already deleted. Its row limit bounds returned cleanup work, not historical scanning. The hourly sweep also runs at startup.

The experiment adds a partial index on `source_files(job_id, key) WHERE deleted_at IS NULL` and drives the join from that set. At 1m terminal jobs, even finding no cleanup work currently costs 339 ms synchronously. With 100 outstanding sources the candidate returns identical rows in 0.053 ms versus 324 ms.

The prototype uses `CROSS JOIN` to force the candidate access order and still sorts the outstanding set. For very large active/failed backlogs, a dedicated indexed cleanup schedule is the stronger design: persist cleanup eligibility/due time transactionally, then query only due entries. Validate recent failures, expired failures, active jobs, retrying deletions, and dense outstanding sets before choosing the final index/query.

## 5. Replace full-history substring scans

**Priority: high once histories become large.** [localWorkspaceProductStore.ts](../../backend/src/localWorkspaceProductStore.ts#L1084) lowercases four columns and applies `%term%` predicates. A no-match search scans the history despite `LIMIT 51`: 47.69 ms at 100k rows and 462.43 ms at 1m. This synchronous SQLite call delays unrelated HTTP and queue work in the same process.

Prototype an FTS5 trigram candidate index, followed by the current literal predicate to preserve exact semantics. Do not simply add an FTS table and retain the current query: SQLite explicitly says a trigram index cannot optimize `LIKE ... ESCAPE`, and the current query uses `ESCAPE`. Short searches, literal `%`/`_`/backslashes, Unicode handling, and lifecycle status updates need explicit treatment. A prefix/exact-search product contract is a simpler alternative if acceptable. [SQLite FTS5 documentation](https://sqlite.org/fts5.html#the_trigram_tokenizer).

Moving expensive queries to a bounded database worker would also isolate HTTP responsiveness, but does not eliminate scanning. First improve access paths, then decide whether a worker-owned database boundary is warranted by mixed-load latency measurements. This is a valid architectural change even though the current runtime performs SQLite work in-process.

## 6. Make recovery proportional to actionable work

**Priority: medium, high for large queued backlogs or many workspaces.** [localExtractionRunner.ts](../../backend/src/localExtractionRunner.ts#L119) enumerates every workspace database every five seconds. [recoverExtractionJobs](../../backend/src/localWorkspaceProductStore.ts#L880) uses time-dependent `CASE` ordering over queued jobs. Returning 1,000 rows from a 1m-row queue took 155 ms, before scheduling them.

The reconciliation pass rediscovers already buffered jobs and relies on in-memory deduplication. More than 64 inactive workspace databases can also churn the connection registry; reopen runs permissions checks, schema statements, and migration inspection. Recovery holds the store lease while feeding its batch.

Introduce indexed ready work and next-due retry scheduling, with targeted refill when queue capacity becomes available. Track which workspaces have pending work; retain a slower repair sweep for restart/crash recovery and missed hints. Separate ready and future retries, or maintain an explicit scheduling key with a documented fairness policy. This revisits ADR-0006's periodic reconciliation strategy without abandoning durable SQLite authority. Benchmark queue saturation, retry storms, and 100+ workspaces as well as a single large queue.

## 7. Revisit rollback journaling and reduce commits per job

**Priority: medium; measured CPU/storage-stage win.** The product store explicitly uses `synchronous=FULL` and defaults to rollback journaling. A successful lifecycle does separate durable transactions for enqueue, claim, model metadata, completion, and cleanup marking. [Store setup](../../backend/src/localWorkspaceProductStore.ts#L285).

In a temporary single-writer experiment, WAL with FULL reduced this five-write lifecycle from 1.35 to 0.34 ms, roughly 4x for this narrow operation. It is worth pursuing even though [ADR-0006](../../backend/docs/adr/0006-bounded-local-extraction-pipeline.md) currently gates WAL.

The gate has a concrete prerequisite: this Bun embeds SQLite **3.51.0**. SQLite's WAL-reset fix is in 3.51.3+ and selected backports, and the documented race involves concurrent connections writing/checkpointing. Qualify a patched embedded SQLite runtime, then benchmark WAL+FULL under real mixed workloads and checkpoint policies. The isolated scratch experiment is evidence of potential, not a recommendation to flip existing databases on this runtime. [SQLite WAL-reset documentation](https://sqlite.org/wal.html#walreset).

Combining claim and model attribution into one short transaction can remove a commit independently of WAL, provided configuration revision and source-read failure behavior remain explicit. Batched cleanup marking is another candidate. WAL+NORMAL may provide further gains, but loses some power-failure durability: treat that as an explicit product choice, not a free tuning flag. [SQLite synchronous documentation](https://www.sqlite.org/pragma.html#pragma_synchronous).

## 8. Bound PDF preparation by bytes and avoid unnecessary reads

**Priority: medium–high for large PDFs; code-supported, no extraction-quality benchmark yet.** [Submission](../../backend/src/localApplication.ts#L472) rereads every streamed temporary upload into memory, even images whose page-count function immediately returns `null`. Read bytes only for PDFs on the streamed path. This removes one whole-file read/allocation for PNG, JPEG, and WebP submissions.

PDF submission fully loads the PDF with pdf-lib. Extraction then reads it again; fallback rendering loads it with PDF.js, retains every encoded PNG, converts all pages to base64, and finally serializes the whole request. [Page renderer](../../backend/src/consumer/pdfPageRenderer.ts#L27), [gateway preparation](../../backend/src/consumer/modelGateway.ts#L73). A compressed input-size bound does not bound decoded pages or the total rendered payload. At 2048×2048 a four-channel canvas alone is about 16 MiB; base64 adds roughly a third to binary payload size before JSON/transport buffers.

Reserve preparation bytes/pages as well as job slots. Use a bounded worker pool for page-count/render work, release intermediate page buffers promptly, and evaluate lower render resolution or JPEG with an extraction-accuracy corpus. Prefer native PDF input when supported and configured. Do not claim JPEG or lower resolution is universally equivalent.

Reopen ADR-0008's inline-only/no-managed-upload decision for gateways that support file references. Streaming a file to a managed-upload endpoint can avoid inline expansion and permit reuse across retries. Make this an explicit workspace capability with deletion, retry lifetime, and credential isolation rules. It adds a request and can hurt small-file latency; benchmark supported gateways before adoption. The current source store's `open()` method alone would not help because `runExtraction` converts a Blob to an ArrayBuffer immediately.

## 9. Stop loading completed results just to discard them in live updates

**Priority: medium; small implementation.** [notifyJobLifecycle](../../backend/src/localExtractionRunner.ts#L459) fetches `getExtractionJob`, including completed result JSON, on every successful completion. [broadcastJob](../../backend/src/localLiveUpdateHub.ts#L109) sends only lifecycle metadata and returns immediately if there are no subscribers.

Use `getExtractionJobSummary` for lifecycle notifications and narrow the callback type accordingly. This avoids a result query and JSON hydration even when no browser is connected, and avoids duplicating potentially large results immediately after persistence. Verify unchanged lifecycle payloads and completion metrics. Benefit depends on result size; no numerical speedup measured here.

## 10. Keep browser work and caches bounded

**Priority: medium for long sessions; lower than backend query fixes at ordinary page sizes.** [Reconciliation publish](../../frontend/src/features/documents/documentReconciliation.js#L53) rebuilds, filters, date-parses, sorts, and indexes the whole document list for selection/loading changes as well as live updates. Bun-only state measurements rose from about 0.026 ms per selection at 50 rows to 1.54 ms at 10k; these exclude React rendering and browser layout, so they do not establish an INP regression.

[DocumentContextList](../../frontend/src/features/documents/DocumentContextList.jsx#L26) renders all loaded rows and repeatedly uses selection-array `includes`, creating quadratic selection work when many rows are selected. Preserve list identity for non-list changes, maintain incremental order, use a selection Set, and virtualize long lists. Batch burst live updates while preserving reconciliation ordering and conflict handling.

The persistent completed cache caps **entry count**, not bytes, and synchronously clones/serializes the cache into localStorage. The request adapter's separate [validator map](../../frontend/src/features/documents/documentRequestAdapter.js#L7) retains full result responses without an eviction limit during its lifetime. Add a shared byte-aware LRU; retain validators only alongside their corresponding representation. Consider asynchronous IndexedDB persistence for large results. Preserve the existing session/workspace clearing behavior and graceful persistence-failure handling.

The upload loop also awaits each document sequentially, while the backend admits up to eight submissions. After fixing admission scans, try a small bounded client upload pool (initially 2–4) with backoff on capacity rejection. Keep the current captured-workspace and stop-unsent-files-on-session-change semantics; do not replace it with unbounded `Promise.all`.

## Additional opportunities worth retaining

- **Job totals:** the list endpoint counts all jobs on every page. At 1m rows this took 6.03 ms, exceeding the 0.044 ms first-page selection by over 100x. A transactionally maintained workspace count preserves the exact total contract and makes the operation constant-sized. Rebuild/verify it during migration and test deletion and recovery behavior.
- **Exports:** [localApplication.ts](../../backend/src/localApplication.ts#L761) accepts an unbounded job-ID list, hydrates each export individually, builds an in-memory workbook, and copies the resulting bytes. Group reads by template/version, avoid repeated template reads, and use bounded export admission plus a streaming or background export path. A synchronous main-thread workbook build can interfere with all workloads. Measure large table answers, not only job count.
- **Analytics:** [localProductAnalytics.ts](../../backend/src/localProductAnalytics.ts#L55) builds an unbounded promise chain and does directory creation plus append per event. Batch bounded buffers to a persistent daily writer and preserve shutdown flushing. Lower priority until analytics backlogs are measured.
- **Static delivery:** build output is one 373.91 kB JS asset (110.75 kB gzip estimate) and 69.97 kB CSS (13.67 kB gzip estimate). The custom static handler sets validators but no immutable cache policy or content encoding. Add immutable caching for hashed assets and optionally build-time compressed variants with correct representation validators/range behavior. Lazy loading admin/export presentation is possible, but the present bundle is a smaller target than the measured backend stalls. The build's gzip estimates are not proof that the runtime serves compressed responses.

## Suggested implementation order and validation

1. Split admission storage diagnostics; change the pagination predicate; use summary-only lifecycle reads. These are small, concrete changes with clear behavioral checks.
2. Make dispatch gateway-aware; add byte-aware PDF preparation limits; then trial bounded client upload concurrency.
3. Fix retention access, indexed search, and recovery refill. Test representative histories, queued backlogs, and mixed-workspace load.
4. Qualify patched SQLite and WAL+FULL, measure commit consolidation, then address large-session browser rendering and exports.

Track p50/p95/p99 submission and list latency **while extraction, search, recovery, and retention run together**, plus completed jobs/sec, actual gateway concurrency, preparation bytes, event-loop delay, and RSS. Do not infer extraction throughput from isolated query ratios or raise global concurrency before fixing stage eligibility.

Reproduce:

```sh
bun --no-env-file .scratch/performance-audit-2026-09-04/benchmark.ts > .scratch/performance-audit-2026-09-04/results.json
bun --no-env-file .scratch/performance-audit-2026-09-04/pipeline-benchmark.ts > .scratch/performance-audit-2026-09-04/pipeline-results.json
bun run build
```

Both experiment scripts completed, checked their candidate fixture results where indicated, and deleted their temporary databases/directories. The production frontend build passed. No runtime source was changed, so full application regression tests were not run for this audit. Shipping any proposal still needs its focused behavioral checks and appropriate root checks.
