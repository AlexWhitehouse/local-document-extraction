# Which bounded processing and backpressure model should govern local extraction?

Category: research
Status: completed
Labels: wayfinder:research, completed
Assignee: research_processing_control

## Parent

../PRD.md

## Decision question

Which portable single-machine scheduling design will maximize stable completed **Extraction job** throughput while keeping HTTP submission/polling responsive and holding the target host below 85% CPU and 80% memory?

## Why this is unresolved

The current local queue dispatches subscribed handlers immediately and has no bounded concurrency or backpressure. The Model gateway can be globally sequential or effectively unbounded, with no useful middle setting. Source file processing, remote gateway I/O, lifecycle persistence, retries, and recovery therefore compete without stage-specific capacity control.

The earlier recommendation was a durable work pump with separate bounded PDF and Model gateway stages, but that has not been validated against Bun's runtime behavior, the current extraction path, or the target workload. It may also need adaptive rather than fixed gateway concurrency because remote latency and throttling can vary.

## Research brief

- Trace the current submission-to-completion path and identify event-loop work, CPU-heavy work, memory-heavy work, remote I/O, and SQLite writes.
- Compare a single semaphore, stage-specific bounded concurrency, worker-thread/process isolation for CPU work, and a durable database-backed work pump.
- Determine whether PDF work actually benefits from Bun workers/threads and how ownership/copying of byte buffers affects that choice.
- Define how queued durable jobs are discovered, fairly scheduled across Workspaces, retried, recovered after restart, and prevented from being dispatched twice.
- Define fixed safe defaults plus any adaptive controls for CPU, memory, Model gateway latency, `429`/`Retry-After`, and transient failure rates.
- Distinguish an in-memory execution permit from durable queued-job state; a restart must not lose accepted work.
- Identify the minimum telemetry and configuration surface needed to tune the system without exposing implementation complexity to callers.
- Use current, primary documentation and implementation sources for Bun/Node concurrency and operating-system resource APIs. Clearly label any inference that requires a prototype.

## Resolution criteria

- A recommended processing topology names each stage, its resource class, and how its concurrency is controlled.
- The recommendation explains why it is better for this workload than the credible alternatives.
- Restart recovery, duplicate-dispatch protection, retry/backoff, Workspace fairness, and overload behavior are specified.
- A portable baseline and target-machine tuning approach are provided.
- Expected code seams and a focused validation plan are identified without yet implementing the design.
- Findings are captured in `../research/bounded-processing-and-backpressure.md` with direct links to primary sources.

## Blocked by

None - can start immediately.

## Comments

Resolved by [bounded processing and backpressure research](../research/bounded-processing-and-backpressure.md). Recommend a durable database-reconciled work pump with global count/byte permits, a small reusable PDF Worker pool, a separately bounded adaptive Model gateway stage, round-robin Workspace fairness, owner-aware atomic claims, and durable jittered retry timing. Worker/native-canvas behavior and adaptive versus fixed limit stability remain explicit benchmark questions.
