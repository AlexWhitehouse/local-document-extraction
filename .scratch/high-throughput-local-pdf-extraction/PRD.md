# Wayfinder Map: High-Throughput Local PDF Extraction

Status: completed
Labels: wayfinder:map, completed

## Destination

Implement and benchmark a portable, single-machine Bun runtime that accepts the existing multipart PDF **Document** submission for a **Template**, returns an asynchronous `202` response promptly, and lets each caller poll its individual **Extraction job** until the **Extraction result** is available.

The runtime should maximize stable completed-job throughput on the target 12-core, 18 GiB Apple Silicon machine while remaining below 85% CPU and 80% physical memory, remaining responsive to 1,000 concurrent submit-and-poll workers, and retaining at least one million jobs and results per **Workspace** indefinitely.

## Notes

- This map explicitly carries through research, prototype, implementation, and benchmark verification. That overrides Wayfinder's usual planning-only stopping point because the user requested a benchmarked working implementation.
- Initial tuning and acceptance benchmarks target the current 12-core, approximately 18 GiB Apple Silicon macOS machine. Runtime controls and safe defaults should remain portable across Bun-supported macOS and Linux machines.
- The dominant workload is PDF Documents: 90% are 1-3 pages and at most 2 MB, 8% are 3-5 pages and at most 5 MB, and 2% are at most 10 MB.
- The **Model gateway** is remote. The local machine owns HTTP admission, Source file persistence, PDF preparation, extraction scheduling, lifecycle persistence, and individual result retrieval.
- Maximum stable completed-job throughput is more important than strict per-job completion latency. Burst queueing is acceptable, provided admission stays responsive and the backlog is bounded by durable local capacity.
- The external production pattern is one short-lived worker per job: submit one Document, poll only that Extraction job, retrieve its result, then terminate. Clients can obey server-directed polling and backoff.
- Completed Source file binaries are deleted after successful extraction. Failed Source file binaries are retained for a seven-day diagnostic window and then deleted. Extraction job metadata, terminal failure details, and Extraction results are retained indefinitely.
- Research must use current primary sources and inspect the actual Bun/LiteLLM/SQLite/PDF code paths. Earlier performance recommendations are hypotheses, not decisions.
- Changes should preserve the existing multipart `document` request contract and asynchronous job contract. Any additive polling headers must remain compatible with existing clients.
- The implementation phase should use representative, generated PDFs and a controllable fake Model gateway for repeatable local load testing; real-gateway testing may supplement but must not be required for deterministic verification.

## Decisions so far

- Use multipart Document submission; do not introduce base64-in-JSON submission.
- Keep submission asynchronous: persist the Source file and queued Extraction job, return `202`, then retrieve the result separately.
- Optimize for sustained completed Extraction job throughput while keeping HTTP admission and polling responsive.
- Permit the processing runtime to consume up to 85% CPU and 80% physical memory.
- Accept 1,000 simultaneous external submit-and-poll workers as the concurrency target; internal extraction concurrency remains independently controlled.
- Retain Extraction jobs and results indefinitely, with an acceptance scale of one million retained jobs per Workspace.
- Delete successful Source file binaries after extraction; retain failed binaries for seven days by default.
- Keep the solution local to one machine and portable across Bun-supported macOS/Linux environments, with initial tuning against the current Apple Silicon host.
- Carry the map through implementation and benchmarked verification after the decision frontier is resolved.
- Adopt a [durable, database-reconciled work pump](research/bounded-processing-and-backpressure.md) with global job-count and predicted-memory permits, a separately bounded PDF stage, adaptive bounded Model gateway concurrency, round-robin Workspace fairness, owner-aware claims, and durable jittered retries. The prototype must still compare Bun Workers with same-thread PDF work and adaptive limits with tuned fixed limits.
- Use [one long-lived, lease-aware SQLite owner per active Workspace](research/sqlite-access-and-retention.md), not a generic pool. Run versioned migrations once, keep write transactions short and immediate, remove the two proven redundant indexes, and replace the full terminal-history status index with a partial active-work index. Enable WAL with `synchronous=FULL` only after the bundled SQLite passes a runtime safety gate; Bun 1.3.14 currently embeds affected SQLite 3.51.0.
- Prefer the [low-memory PDF data path](research/low-memory-pdf-data-path.md): incrementally stream multipart input to a temporary file, perform the required page-count read after upload, atomically promote it, and submit a lazy local file through a LiteLLM managed file ID. Gate the managed-file route on authenticated capability verification for the configured model; retain inline PDF base64 as a bounded fallback and page rendering as a last resort.
- Keep [individual short polling](research/individual-polling-contract.md), adding `Location`/`Retry-After` guidance, opaque weak `ETag` validators, `If-None-Match`/`304`, and a capped jittered client schedule. Authorize before validator evaluation, skip result hydration on unchanged/nonterminal reads, use `429` only for caller-specific limits and `503` for shared overload, and defer long polling unless the benchmark proves short polling is still material.
- The [bounded prototype and acceptance run](prototype/RESULTS.md) preserved 100-worker throughput while halving RSS growth, then completed 1,000/1,000 submit-and-poll workers after shared SQLite ownership, streaming admission, bounded scheduling, and conditional polling were implemented. The final deterministic profile sustained 48.28 end-to-end worker completions/s and peaked at 787.47 MiB RSS.

## Delivered

- [Own Workspace SQLite connections for the process lifetime](issues/06-own-workspace-sqlite-connections.md)
- [Add efficient conditional individual job polling](issues/07-add-efficient-conditional-job-polling.md)
- [Build the durable bounded Extraction work pump](issues/08-build-durable-bounded-work-pump.md)
- [Stream and bound multipart Source file admission](issues/09-stream-and-bound-multipart-source-admission.md)
- [Use bounded PDF file-ID transfer to the Model gateway](issues/10-use-bounded-file-id-model-transfer.md)
- [Enforce failed Source retention and local disk reserve](issues/11-enforce-source-retention-and-disk-reserve.md)
- [Add resource control and throughput telemetry](issues/12-add-resource-controller-and-throughput-telemetry.md)
- [Verify high-throughput local Extraction end to end](issues/13-verify-high-throughput-local-extraction.md)
- Defaults use eight admission and extraction permits, 10,000 buffered metadata items, a 128 MiB admission reservation pool, a 1 GiB disk reserve, and adaptive extraction permits bounded by configurable 85% CPU and 80% memory limits.
- LiteLLM managed-file transfer is implemented but stays disabled for an opaque model alias until the gateway operator verifies that alias supports managed files.

## Out of scope

- Horizontal scaling, multi-machine coordination, or migrating to a hosted queue/database.
- Replacing individual job polling with batch retrieval, webhooks, or mandatory WebSockets.
- Changing the multipart Document submission into base64 JSON.
- Retaining completed Source file binaries indefinitely.
- A strict per-job completion-time SLA.
- Frontend redesign, browser rendering performance, exports, and unrelated application architecture refactors.
- Changing model extraction quality, Template semantics, or the durable Extraction result shape.
- Optimizing image submissions beyond avoiding regressions to their existing behavior.
