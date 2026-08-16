# Bounded Processing and Backpressure Research

Date: 2026-08-16  
Decision ticket: [Which bounded processing and backpressure model should govern local extraction?](../issues/01-choose-bounded-processing-and-backpressure-model.md)

## Recommended decision

Use a **durable, database-reconciled work pump with hierarchical permits**:

1. The persisted Source file and queued Extraction job remain the source of truth. An in-memory notification only wakes the pump; it is never the durable queue.
2. The pump admits a bounded number of active jobs under both a count limit and a byte-weighted memory budget.
3. CPU-heavy PDF preparation uses a small, reusable Bun Worker pool with its own adjustable permit limit. Ordinary remote HTTP I/O stays on the main runtime.
4. Model gateway calls use a separate bounded, slowly adaptive concurrency limit. They honor `429`/`503` `Retry-After`, classify retryable statuses, and persist jittered `next_retry_at` values.
5. Workspaces are visited round-robin, with FIFO ordering inside each Workspace. A job is atomically claimed only after an execution permit is available.
6. Submission staging has its own short-lived count/byte limit. Processing saturation queues already accepted jobs on disk; admission pressure returns a retryable response before the app materializes another multipart body.

This is deliberately **not** a new hosted queue or a multi-process architecture. It deepens the current local seams: durable state is already in SQLite, but discovery, capacity control, fairness, retry timing, and resource feedback move into one coordinator.

## Why the current path is unstable

### The “queue” is an unbounded broadcaster

`schedule()` immediately calls every handler, and asynchronous handler promises are deliberately not awaited. A future retry gets its own timer. The server subscriber then starts `localExtractionRunner.run(job)` without awaiting it. Consequently, a burst creates one end-to-end runner promise per job with no concurrency, memory, or gateway cap ([queue implementation](../../../backend/src/localExtractionQueue.ts#L27-L49), [server wiring](../../../backend/src/server.ts#L89-L92)).

This in-memory object is not the durability mechanism. Submission first writes the Source file and a queued SQLite row, then calls `scheduleQueuedJob`, and only then returns `202` ([submission path](../../../backend/src/localApplication.ts#L574-L659)). That ordering is useful and should remain, but scheduling failure currently converts an otherwise persisted queued job into a terminal failure. Under the recommended design, a wake-up failure cannot lose work: startup and periodic reconciliation rediscover the row.

### A single runner spans different resource classes

After claiming a row, each runner reads the complete Source file, makes another complete `ArrayBuffer` copy, prepares the model input, waits on remote I/O, normalizes results, writes terminal state, and removes the successful Source file ([runner path](../../../backend/src/localExtractionRunner.ts#L149-L225), [explicit byte copy](../../../backend/src/localExtractionRunner.ts#L352-L355)). Those steps should not share one undifferentiated concurrency policy:

- PDF page rendering is CPU- and memory-heavy.
- Base64 construction and `JSON.stringify` are synchronous main-thread CPU and allocate additional strings.
- `fetch` waiting is remote I/O, but each in-flight request retains its request data and response state.
- SQLite lifecycle writes and Source file cleanup are short local I/O operations.

The gateway offers only two modes today: one global sequential promise chain or no bound at all ([gateway scheduler](../../../backend/src/consumer/modelGateway.ts#L395-L408)). Every non-2xx response is reduced to the same retryable error, response headers are discarded, and the complete request and response bodies are materialized as strings ([gateway call](../../../backend/src/consumer/modelGateway.ts#L506-L568)). Retries default to a fixed zero delay and are represented by one timer per scheduled job ([runner retry](../../../backend/src/localExtractionRunner.ts#L231-L260), [queue timer](../../../backend/src/localExtractionQueue.ts#L39-L48)). This combination can produce synchronized retry storms.

### PDF rendering can block the HTTP event loop

Direct-PDF-capable models avoid page rendering, but other models render every page sequentially and retain every PNG until the whole document has been prepared ([gateway branch](../../../backend/src/consumer/modelGateway.ts#L70-L117), [renderer](../../../backend/src/consumer/pdfPageRenderer.ts#L23-L63)). The exact PDF.js version used here force-disables its internal real worker in Node-like environments and falls back to a same-thread “fake” worker ([PDF.js v6.1.200 source](https://raw.githubusercontent.com/mozilla/pdf.js/v6.1.200/src/display/api.js#L1900-L1930)).

An indicative local probe on Bun 1.3.14 rendered a generated three-page, text-only PDF through the repository function in 237 ms and observed a 65 ms maximum gap in a 1 ms interval. This is not a capacity benchmark—the PDF was only 1.3 KB and real scans are different—but it demonstrates event-loop interference even for a trivial document. The worker/no-worker decision therefore needs the target-machine prototype specified below.

```sh
cd backend
bun -e '/* create a 3-page pdf-lib document; sample a 1 ms interval; await renderPdfPagesToPng */'
# {"inputBytes":1308,"outputBytes":72251,"pages":3,"wallMs":237,
#  "intervalSamples":119,"maxEventLoopGapMs":65}
```

### Recovery loads the backlog rather than pumping it

Startup recovery scans Workspace databases sequentially and materializes **all** queued rows in each Workspace before scheduling them ([runner recovery](../../../backend/src/localExtractionRunner.ts#L87-L124), [store recovery query](../../../backend/src/localWorkspaceProductStore.ts#L761-L795)). That will not scale to a large backlog. It also only revisits stale `processing` rows during startup; a recently claimed row can remain stuck after a crash because no later reconciliation is scheduled ([stale recovery](../../../backend/src/localWorkspaceProductStore.ts#L797-L828)).

The existing conditional update is a sound duplicate guard: only a queued row with an older attempt can become `processing` ([atomic claim](../../../backend/src/localWorkspaceProductStore.ts#L553-L595)). The new pump should preserve that property while selecting and claiming one due job at a time instead of loading the entire backlog.

## Recommended processing topology

| Stage | Resource class | Control | Important rule |
| --- | --- | --- | --- |
| Multipart admission and Source file staging | Memory, file I/O, brief PDF validation CPU | Count semaphore plus reserved-byte budget | Acquire before `formData()`/`arrayBuffer()`; fail quickly under pressure rather than buffer 1,000 PDFs concurrently. |
| Durable ready discovery | SQLite reads, tiny metadata | One work pump; `LIMIT 1`/small pages; one nearest-deadline timer | The database is truth. In-memory state contains Workspace IDs and job IDs only, never the backlog or PDF bytes. |
| Active Extraction jobs | Aggregate memory and task count | Global job permits plus byte-weighted reservations | Acquire before claim/read; release in `finally`; stop dispatch when memory crosses the soft watermark. |
| PDF preparation | CPU, native canvas memory, PNG buffers | Reusable Bun Worker pool and PDF permits | Transfer an owned `ArrayBuffer`; do not create one Worker per job; do not use Workers for gateway I/O. |
| Model gateway | Remote capacity, retained request memory, some main-thread encoding CPU | Bounded async semaphore with a fixed ceiling and slow adaptive current limit | Do not prepare an unbounded in-memory queue of gateway payloads. |
| Result persistence and cleanup | SQLite writes and file I/O | Short transactions; existing per-Workspace serialization refined by the SQLite decision | Never hold PDF or gateway permits while broadcasting live updates or deleting the successful Source file. |
| Individual polling | HTTP and indexed point reads | No extraction permit | Polling stays independently schedulable and follows the separate polling/SQLite decisions. |

Bun Workers create a separate JavaScript instance on another thread and share I/O resources with the main runtime, so they are an appropriate isolation boundary for measured CPU work ([Bun Workers](https://bun.com/docs/runtime/workers)). Bun supports transferring an `ArrayBuffer` rather than cloning it ([Bun `Worker.postMessage`](https://bun.com/reference/bun/Worker/postMessage)). The runner already creates a standalone owned copy; that buffer can be transferred and detached instead of cloned again. The Worker API is still described as experimental, especially termination, so the pool should be long-lived and worker crashes/leaks must be included in the prototype.

Node's worker guidance reaches the same resource-class distinction: threads help CPU-intensive JavaScript and generally do not improve asynchronous I/O ([Node worker threads](https://nodejs.org/download/release/latest/docs/api/worker_threads.html)). Moving the whole Extraction job into Workers would duplicate database/gateway orchestration and spend threads waiting on `fetch`; only PDF parsing/rendering should move initially.

## Durable pump, fairness, and duplicate prevention

### Discovery and ordering

Add store operations equivalent to:

```text
peekNextDueJob(workspaceId, now) -> one lightweight candidate
claimNextDueJob(workspaceId, candidateId, bootId, now) -> claimed job or null
nextDeferredJobTime(workspaceId) -> timestamp or null
```

The query should use a matching status/due/order index chosen by the SQLite ticket and return one row or a small page, not `.all()` over the backlog. Submission and retry commits add the Workspace ID to an in-memory ready ring and wake the pump. A low-frequency reconciler covers lost wake-ups and external/test writes. Deferred retries use one timer for the nearest known due time; the durable `next_retry_at` remains authoritative.

The ready ring dispatches at most one job from a Workspace per turn. If only one Workspace has work, successive turns fill all available permits from it. If several have work, none can monopolize admission. FIFO (`created_at`, `id`) within each Workspace is simple and predictable; do not introduce shortest-job-first until a benchmark proves head-of-line cost is material.

### Claim and execution ownership

Acquire the global execution/memory permit **before** changing a job to `processing`. Then use one conditional transaction to verify `status='queued'`, `next_retry_at <= now`, and advance the attempt. Keep an in-memory reserved-job set as an optimization, but rely on the conditional update for correctness.

For robust restart recovery, add a runtime boot identifier to processing ownership (for example `processing_owner`) and either a renewable lease expiry or a state-directory single-instance lock. Completion/requeue/failure updates must match job ID, attempt, and owner. On a clean shutdown, stop admission, stop new claims, cancel or drain active work, and persist requeues. On restart, rows owned by a dead boot are requeued and rediscovered without first loading them all. A lease without a periodic expiry scan is insufficient; the pump reconciler must schedule the next expiry.

This ownership field is preferable to relying only on `updated_at`: the current five-minute stale threshold equals the default five-minute gateway timeout, and a crash immediately after claim otherwise creates an avoidable blind wait. The design still assumes one active runtime for the state directory, but an ownership check also prevents a late result from an old runtime from overwriting a newer attempt.

Exactly-once model execution is not attainable across a crash between remote acceptance and local completion. The practical guarantee is **at-least-once attempt execution with idempotent local terminal writes**: the owner/attempt condition drops stale completions, while result replacement occurs in the same terminal transaction. This limitation should be explicit in tests and operations.

## Backpressure and overload behavior

1. **Processing full:** keep accepted jobs durably `queued`; do not create runner promises or read Source files.
2. **Submission slots/bytes full:** return `503 Service Unavailable` with a short `Retry-After` before parsing another body. Reserve from validated `Content-Length` where available; otherwise reserve the configured maximum until the ingestion ticket supplies a streaming counter. Use `429` only for a caller-specific rate limit.
3. **Memory soft watermark reached:** stop new claims and submission materialization; let active jobs complete. Resume below a lower watermark to avoid oscillation.
4. **Memory hard watermark approached:** reduce PDF and gateway current permits to their minima and reject new staging. Do not cancel healthy calls merely to reclaim memory unless the process is otherwise at risk.
5. **CPU target exceeded or event-loop responsiveness degrades:** reduce PDF permits first. If synchronous base64/JSON work is responsible, also reduce gateway admission until the low-memory data-path ticket removes those copies.
6. **Gateway throttles:** durably requeue the failed attempt, lower the gateway current limit, and pause new calls for that route until `Retry-After` expires.
7. **Disk reserve or configured queued-byte bound reached:** stop accepting new Documents with `503` and `Retry-After`; never acknowledge a Source file that cannot be durably retained.

HTTP defines `Retry-After` as either an HTTP date or a non-negative delay in seconds ([RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)). A `429` response may include it to say how long to wait ([RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)). The gateway client should parse both forms, preserve the response status and header in a typed error, and set `next_retry_at` to at least that time.

Only network errors, timeouts, `408`, `429`, and retryable `5xx` responses should enter automatic retry by default. Authentication, authorization, unsupported-input, and other deterministic `4xx` responses should fail without consuming all attempts. For retryable responses without server direction, use capped exponential backoff with full jitter and persist the sampled due time; this prevents a burst from waking all jobs together. These classification and jitter choices are design recommendations that must be verified against the actual LiteLLM route, not claims about LiteLLM internals.

## Fixed portable baseline and adaptive controls

The fixed limits below are **safe starting hypotheses**, not final acceptance values. Let `P = os.availableParallelism()`. Bun documents `availableParallelism()` as the estimate applications should use for default parallelism, rather than `os.cpus().length` ([Bun `os.availableParallelism`](https://bun.com/reference/node/os/availableParallelism)).

| Control | Portable starting value | Target 12-core value | Configurable ceiling |
| --- | --- | --- | --- |
| Submission staging | `min(4, max(2, floor(P/2)))` and 128 MiB reserved-body budget | 4 | 8 and a byte budget |
| Global active jobs | `min(16, max(4, 2 * P))` | 16 | 32 |
| PDF Worker permits | `min(2, max(1, P - 2))` | 2 | `P - 2`, subject to benchmark |
| Gateway current limit | 4 | 4 | 8 initially; benchmark 2/4/8/16 |
| Predicted processing-memory reservations | `min(512 MiB, 10% of total memory)`, minimum 128 MiB | 512 MiB | Explicit bytes |
| Retry delay | 1 s base, 60 s cap, full jitter | same | base/cap |

Keep count limits even with byte reservations: a thousand tiny jobs still create file descriptors, promises, database operations, and sockets. Calibrate memory weights from observed peak deltas by route: direct inline PDF, uploaded PDF, and PDF-rendered-as-images have materially different allocation shapes.

Use a slow controller above these hard ceilings:

- Sample process CPU, RSS, and main event-loop utilization once per second and calculate a 10-second EWMA.
- Treat 75% of physical memory as the soft dispatch stop, 80% as the hard objective boundary, and resume below 70%.
- Stop concurrency increases above 75% CPU; decrease PDF permits after three samples above 85%; resume increases only below 70% CPU and with a healthy event loop.
- Start gateway concurrency at 4. With a backlog and a healthy 30-second window, add one permit up to the configured ceiling. On `429`, route-level `Retry-After`, or a burst of timeouts/`5xx`, halve the current limit (minimum 1). Increase slowly and decrease quickly.
- Adjust permits, not physical Worker count, during normal operation; keep the reusable pool stable.

`process.cpuUsage()` reports process CPU time and can exceed elapsed wall time when several cores are active; `process.memoryUsage().rss` covers the whole process, including Worker threads, while per-thread heap fields do not ([Node process resource metrics](https://nodejs.org/api/process.html#processcpuusagepreviousvalue), [Node memory metrics](https://nodejs.org/api/process.html#processmemoryusage)). Bun marks `node:os` fully implemented but `node:perf_hooks` and `node:process` only partially implemented ([Bun Node compatibility](https://bun.com/docs/runtime/nodejs-compat)); Bun 1.3.14 on the target host exposed `cpuUsage`, RSS, `availableParallelism`, and `performance.eventLoopUtilization` in a local smoke check. Event-loop utilization is defined as loop active/idle time, not CPU usage ([Bun `eventLoopUtilization`](https://bun.com/reference/node/perf_hooks/eventLoopUtilization)). The prototype must verify metric behavior under Workers on both macOS and Linux before any automatic controller is enabled by default.

The adaptive algorithm and thresholds are inferred controls, not facts established by documentation. Keep an `adaptive=false` fixed-limit mode, log every limit change with its reason, and benchmark fixed versus adaptive behavior. A controller that oscillates or reduces completed jobs per second should not ship merely because it respects the envelope.

## Why this topology beats the alternatives

| Alternative | Assessment |
| --- | --- |
| Current unlimited dispatch | Reject. It maximizes offered concurrency, not stable completions, and has no overload boundary. |
| One end-to-end semaphore | Useful as an immediate safety patch and benchmark baseline, but not the final design. A low limit leaves CPU idle while jobs wait remotely; a high limit permits too many simultaneous render/base64 allocations. It also cannot react to gateway throttling without unnecessarily suppressing PDF work. |
| Stage-specific semaphores only | Reject. Prepared jobs can accumulate between stages and retain unbounded byte buffers. A global active count and weighted memory reservation are still required. |
| Hierarchical global/memory + PDF + gateway permits | Recommend. It bounds aggregate memory, isolates the CPU stage, and lets remote I/O scale independently while preserving a single coordinator. |
| Put the entire runner in Bun Workers | Reject initially. Workers help CPU work, not async I/O; this would multiply SQLite connections/configuration and complicate cancellation, lifecycle broadcasts, and ownership. |
| Process pool | Keep as a fallback only if the Bun Worker/native canvas prototype shows crashes, unreclaimed native memory, or thread-safety problems. Processes improve fault isolation but add startup, IPC, and byte-copy overhead. |
| New central durable queue database | Defer. Existing per-Workspace job rows already provide durable truth. A fair reconciler can query them incrementally. Add a central queue only if measurement shows Workspace discovery itself is the bottleneck. |
| Gateway sequential/unlimited boolean | Replace with integer limits; map the legacy sequential setting to ceiling 1 during migration. |

## Minimum telemetry and configuration

Telemetry needed to tune safely:

- submission attempts, `202`/overload outcomes, staging wait, and Source bytes;
- due queue depth, oldest due age, active Workspaces, and per-Workspace dispatch wait;
- active/global memory reservations, PDF permits, gateway permits, and limit-change reasons;
- completed jobs/second and end-to-end plus per-stage duration histograms;
- PDF page/byte distributions and prepared payload bytes by route;
- gateway status, latency, timeouts, `Retry-After`, retries, and current limit;
- process normalized CPU, RSS/total memory, ArrayBuffer/external memory where reliable, and event-loop utilization/delay;
- recovery counts, claim conflicts, lease expiries, stale completion drops, and duplicate terminal-write attempts.

Minimum operator configuration:

- CPU and memory target fractions (defaults 0.85 and 0.80 from the destination);
- global active-job ceiling and predicted-memory byte budget;
- PDF Worker ceiling;
- gateway start/ceiling plus fixed/adaptive mode;
- submission staging count/byte budget and disk reserve;
- retry attempts/base/cap.

Callers do not need to know these internals. Their only additive behavior is respecting `Retry-After` on overloaded submission/polling responses; the multipart submission and asynchronous job resource remain unchanged.

## Expected code seams

- Replace `localExtractionQueue.ts` with a coordinator whose public submission operation is a non-failing `wake(workspaceId)` and whose reconciliation methods incrementally discover due work.
- Extend `localWorkspaceProductStore.ts` with indexed next-due selection, owner/lease-aware atomic claim and terminal updates, nearest retry/lease time, and paged startup recovery. Coordinate index/connection details with the SQLite research decision.
- Split `localExtractionRunner.ts` into claim/orchestration, PDF preparation, gateway, and terminalization boundaries so permits are acquired and released around the resource they protect.
- Replace `MODEL_GATEWAY_SEQUENTIAL_CALLS` in `modelGateway.ts` with an integer controller, typed status/header errors, retry classification, and `Retry-After` parsing. Preserve the boolean as a compatibility alias for limit 1.
- Add a reusable PDF Worker entry/pool around `pdfPageRenderer.ts`, transferring owned buffers. Keep a same-thread mode for benchmark comparison and fallback.
- Add resource sampling and submission admission at composition root/server level so HTTP, pump, and gateway share one pressure view.
- Add deterministic queue/restart/fairness tests and a load harness; do not couple production scheduling to the benchmark implementation.

## Focused validation plan

1. Generate the agreed workload mix: 90% 1–3 pages/≤2 MB, 8% 3–5 pages/≤5 MB, 2% ≤10 MB. Include text PDFs and image-heavy scans.
2. Use a controllable fake gateway with configurable latency distributions, `429`/`503`, valid/invalid `Retry-After`, timeouts, and connection failures. Run direct-PDF and render-as-images routes separately.
3. Emulate 1,000 independent workers that submit once, poll one job using server backoff, retrieve the result, and terminate.
4. Benchmark current unbounded dispatch, a single semaphore, and hierarchical permits. Sweep active jobs 4/8/16/32, PDF permits 1/2/4/8, and gateway limits 2/4/8/16.
5. For PDF isolation, compare same-thread versus a long-lived Worker pool using identical PDFs. Record jobs/s, p95/p99 submission and poll latency, event-loop delay, CPU, RSS, prepared bytes, Worker crashes, and post-run RSS recovery.
6. Run a steady test long enough to expose memory drift, then a burst larger than capacity. The winner is the highest stable completed-job throughput that remains within 85% CPU and 80% memory without starving HTTP admission/polling.
7. Kill the process with queued, preparing, and gateway-active jobs; restart it; verify every accepted job reaches a terminal state, no backlog is loaded wholesale, and stale attempts cannot overwrite newer results.
8. Inject two busy Workspaces and one low-volume Workspace; verify round-robin dispatch prevents the low-volume Workspace from starving while a single Workspace can still consume idle capacity.
9. Force 429s with `Retry-After`; verify gateway concurrency falls, no retry fires early, due jobs survive restart, and the limit recovers slowly after a healthy window.
10. Repeat the resource-metric and Worker tests on one supported Linux host before enabling adaptive mode by default.

## Resolution

Adopt the hierarchical durable work pump as the implementation direction. A single semaphore is the first benchmark/control case, not the end state. The two decisions that remain explicitly empirical are (a) whether the exact PDF.js/`@napi-rs/canvas` path is better in Bun Workers on representative PDFs and (b) whether the proposed adaptive controller improves throughput over well-tuned fixed limits without oscillation. Both are bounded by the prototype plan above.
