# Go document processing service

Status: implemented as an opt-in processing engine; Bun remains the reference.

The rollout/experiment status above is superseded by [ADR-0022](0022-go-as-the-standard-document-processor.md): Go is mandatory and the intake/result prototypes are removed. The following records the original decision.

This revises the single-runtime processing decision in ADR-0005 and the execution
boundary in ADR-0006. The requested objective is higher completed Documents/second
on one host while preserving extraction quality, public API behavior and durable
accepted work. A full authentication rewrite does not serve that objective.

Go executes classification, splitting, materialization and extraction stages. Bun
owns authoritative Workspace data and exposes a private, authenticated adapter to
its existing claims, validators, result normalization and accounting. The Go engine
cannot independently invent Template bindings or bypass split-plan validation.
The frontend, public API, schema and existing recovery path remain compatible.

The architectural changes are separate preparation and network concurrency,
streaming model bodies with exact Content-Length, reuse of artifacts across stages
within one Document, isolated warm rendering processes, and batched durable
processing commits. PDF rendering uses the existing implementation and settings;
there is no text-only substitution, lowered resolution or lossy compression.

The memory queue remains a bounded Workspace-fair accelerator. A processing run
holds the existing Workspace/job lease and deletion cancellation signal. Persisted
rounds and extraction attempts remain authoritative. Accounting begins before each
transport attempt. Failed or interrupted accounting remains unknown rather than
being inferred as zero cost. Results and completion commit before notification.
Source cleanup remains retryable through the existing retention sweep.

The private adapter does not use a second SQLite owner. It can batch concurrent
upload acceptance and processing mutations for one Workspace into a FULL-synchronous transaction; nested savepoints
isolate rejected mutations. Callers receive results only after commit. This avoids
weakening durability for throughput and preserves deletion/migration behavior.

Go does not yet replace admission/PDF inspection or the public product APIs. Those
remain candidates for later measurement. An optional engine allows comparisons
without duplicating authentication and storage rules. See
[the processor documentation](../../../backend-go/README.md) and [benchmark report](../../../backend-go/BENCHMARKS.md).

The follow-up separates local permits from parked runs. Provider, PDF-pool,
artifact-budget and retry waits release local capacity without releasing durable
ownership. Responses resume ahead of new work; shutdown and recovery account for
parked runs. Provider requests, upload encoding, PDF processes and artifact bytes
have distinct allowances. Defaults derive local work from CPU/RAM and prepared
artifacts from available disk. Control HTTP connections do not share Bun fetch's
request cap. The PDF.js rasterizer is unchanged; faster lossless PNG encoding is
verified by decoded pixels, with native encoding as a payload-limit fallback.
See [stage benchmarks](../../../backend-go/STAGE-BENCHMARKS.md).

PDF admission now gives continuation/child work two turns for each new-parent turn,
with FIFO inside each class. Output reservations start at PDF admission, so queued
work does not consume worst-case artifact space. Model response bodies retain byte
credits through validation and durable commit; HTTP/2 receive windows are also
bounded. These limits protect useful throughput during response bursts rather
than treating every in-flight Document as an equally expensive active worker.
