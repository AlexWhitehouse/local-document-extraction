# Prototype results — bounded local extraction

Date: 2026-08-16  
Target: 12-core Apple Silicon, approximately 18 GiB RAM  
Harness: [`throughput.ts`](throughput.ts)

## Question

Does bounding multipart admission and active Extraction jobs preserve useful throughput while preventing a remote-gateway backlog from retaining an unbounded number of PDF buffers in the local runtime?

## Setup

- Real Bun HTTP, multipart validation, PDF page count, local Source file writes/reads/deletes, per-Workspace SQLite lifecycle, Local extraction runner, and individual job retrieval.
- Client runs in a separate process so client-side PDF and request buffers do not count toward server RSS.
- Generated workload is deterministic by position: 90% two-page 1.80 MiB PDFs, 8% four-page 4.80 MiB PDFs, and 2% eight-page 9.51 MiB PDFs.
- Fake remote Model gateway admits eight calls and takes 100 ms per call.
- Baseline uses the current unbounded queue. Candidate uses four admission permits and eight active-runner permits for the 100-worker comparison.
- Prototype overload responses stream-discard rejected request bodies before returning `503`; cancelling/closing an unread body produced native empty `400` responses on a reused connection in Bun 1.3.14.

## 100-worker comparison

Command: `bun run prototype:throughput`

| Metric | Current baseline | Bounded candidate |
| --- | ---: | ---: |
| Completed / failed | 100 / 0 | 100 / 0 |
| Completed jobs/s | 64.56 | 67.03 |
| Submission p95 | 436.36 ms | 884.26 ms |
| Poll p95 | 59.21 ms | 9.54 ms |
| Poll requests | 1,099 | 731 |
| Admission retries | 0 | 338 |
| Server peak RSS | 853.22 MiB | 529.55 MiB |
| Server RSS growth | 636.45 MiB | 316.88 MiB |
| Maximum event-loop lag | 135.39 ms | 13.75 ms |
| Peak active runners | 84 | 8 |
| Peak queued metadata | 0 | 40 |
| Peak fake-gateway calls | 8 | 8 |

The bounded candidate delivered 1.04 times baseline throughput, used 50% of the baseline RSS growth, and reduced measured maximum event-loop lag by about 90%. The increased submission p95 is the intentional cost of bounded admission and retry; the production contract needs a better server-directed retry cadence than the compressed prototype delay.

## Pre-implementation 1,000-worker bounded run

Command:

```sh
PROTOTYPE_PROFILE=bounded \
PROTOTYPE_WORKERS=1000 \
PROTOTYPE_ADMISSION_CONCURRENCY=32 \
PROTOTYPE_GATEWAY_CONCURRENCY=8 \
PROTOTYPE_RUNNER_CONCURRENCY=8 \
PROTOTYPE_GATEWAY_LATENCY_MS=100 \
PROTOTYPE_POLL_INTERVAL_MS=500 \
bun run prototype:throughput
```

| Metric | Result |
| --- | ---: |
| Completed / failed | 992 / 8 |
| Completed jobs/s | 63.06 |
| Submission p95 | 6,889.8 ms |
| Poll p95 | 338.24 ms |
| Poll requests | 8,172 |
| Admission retries | 4,772 |
| Server peak RSS | 911 MiB (4.94% physical RAM) |
| Server RSS growth | 695.52 MiB |
| Maximum event-loop lag | 388.14 ms |
| Peak active runners / gateway calls | 8 / 8 |
| Peak queued metadata | 585 |

All eight failures were `500 document_submission_failed` responses during concurrent submission. This matches the researched current behavior: every request opens and migrates/closes another Workspace SQLite connection, without a shared owner or busy policy. The run therefore fails the reliability acceptance target even though memory remains far below 80%.

The prototype CPU fraction rounded to zero on these short, I/O-dominated samples and is not decision-quality evidence for the 85% ceiling. The production benchmark must use a longer sampling window and report raw process CPU time plus normalized/system utilization.

## Prototype verdict

1. Implement bounded admission and runner/gateway concurrency. The 100-worker comparison shows materially lower RSS and event-loop interference without a throughput penalty.
2. Implement the long-lived per-Workspace SQLite owner before claiming 1,000-worker support. It is the observed reliability gate.
3. Implement conditional individual polling and the researched backoff schedule. Aggressive prototype polling amplified the per-request connection problem and reached 338 ms p95 at 1,000 workers.
4. A durable reconciled work pump is still required: the bounded prototype queue holds only metadata but is not restart-safe or Workspace-fair.
5. A production admission module must explicitly own unread multipart behavior. Streaming discard was reliable in this Bun build; cancel/close was not.
6. The low-memory LiteLLM file-ID path remains gated on gateway capability verification and needs a separate adapter benchmark.

## Post-implementation 1,000-worker acceptance run

The final profile uses the production streaming multipart path, shared Workspace SQLite owner, production bounded/fair queue, conditional job reads, eight admission permits, eight active runners, and clients that honor submission and polling `Retry-After` with positive jitter.

Command:

```sh
PROTOTYPE_PROFILE=bounded PROTOTYPE_WORKERS=1000 bun run prototype:throughput
```

| Metric | Result |
| --- | ---: |
| Completed / failed | 1,000 / 0 |
| End-to-end worker completions/s | 48.28 |
| Submission p95 | 7,750.56 ms |
| Poll request p95 | 17.66 ms |
| Total poll requests / `304` | 2,173 / 212 |
| Admission retries | 3,577 |
| Server peak RSS | 787.47 MiB (4.27% physical RAM) |
| Server RSS growth | 573.55 MiB |
| Maximum event-loop lag | 268.23 ms |
| Peak active runners / gateway calls | 8 / 8 |
| Peak queued metadata | 496 |

All workers retrieved terminal results with no unexplained HTTP errors, lost work, or stuck jobs. The observed memory high-water mark is far below the agreed 80% ceiling. The one event-loop outlier occurred during the initial 1,000-client admission wave; production resource control pauses new dispatch at 250 ms and resumes after pressure clears. Submission backpressure remained explicit and retryable.

The harness's normalized `process.cpuUsage()` result still rounded below 0.01 of machine capacity and is not used as proof of CPU headroom. Production now samples and exposes raw process-derived CPU ratio continuously and reduces permits at the configured 85% ceiling; an operator should corroborate that metric with host telemetry when tuning against a real gateway.

Separate retention and scale probes found that one million jobs with five million results occupy about 3.04 GiB, warm point-read p99 was 545 microseconds, and the removed redundant indexes accounted for about 297 MiB. Restart recovery, durable retry timing, Workspace fairness, seven-day cleanup, disk rejection, conditional polling, and connection-owner invalidation are covered by deterministic tests.

## Final verdict

The implementation reaches the local acceptance destination for the deterministic gateway profile: 1,000/1,000 workers complete, internal work and admission remain bounded, retained reads stay sub-millisecond at the one-million-job scale probe, and peak RSS remains under 5% of the target machine. Real throughput will be bounded primarily by the configured remote Model gateway.

The preferred managed-file PDF transfer is implemented but intentionally remains behind `MODEL_GATEWAY_USE_MANAGED_FILES` for the active opaque model alias. It should be enabled only after the gateway operator confirms managed-file support; inline PDF remains the compatibility path until then.
