# Which polling contract efficiently serves 1,000 independent workers?

Category: research
Status: completed
Labels: wayfinder:research, completed
Assignee: research_individual_polling

## Parent

../PRD.md

## Decision question

Which backward-compatible HTTP polling semantics and server read path let 1,000 independent, short-lived workers retrieve their own Extraction results with low database, serialization, and network overhead?

## Why this is unresolved

The production caller pattern is explicitly one worker per Extraction job, so batch retrieval is not useful. Clients can obey server-directed backoff, but the current API does not yet have an agreed cadence, `Retry-After` policy, conditional response contract, or long-poll behavior. Poll frequency can otherwise dominate local request and SQLite load while remote extraction is still in progress.

## Research brief

- Trace the current individual Extraction job route, authentication, query shape, result hydration, JSON serialization, and response headers.
- Compare server-directed interval polling, exponential client backoff, `Retry-After`, entity tags with `If-None-Match`/`304`, and bounded long polling for this local Bun server.
- Preserve one-job-per-worker retrieval and compatibility for clients that ignore new headers.
- Use current HTTP specifications and Bun documentation for cache validators, `Retry-After`, connection behavior, aborts, and timeouts.
- Quantify request rates for 1,000 workers under candidate schedules and realistic remote Model gateway latency distributions.
- Define terminal-result caching/validation behavior and how indefinitely retained results affect repeated future retrieval.
- Specify overload responses when the server is at its admission or resource ceiling, including which requests may receive `429` or `503` and what retry guidance accompanies them.
- Identify any SQLite/index dependency, but leave the database operating policy to the SQLite research ticket.

## Resolution criteria

- A recommended client/server polling algorithm includes initial delay, subsequent cadence/backoff, jitter, terminal behavior, and timeout/abort handling.
- Exact additive response headers/status behavior is specified for queued, processing, completed, failed, not-modified, overloaded, and missing jobs.
- Estimated request volume and server cost at 1,000 concurrent workers are compared with credible alternatives.
- Backward compatibility and security implications are addressed.
- Expected code seams and a focused validation plan are identified without yet implementing the design.
- Findings are captured in `../research/individual-polling-contract.md` with direct links to primary sources.

## Blocked by

None - can start immediately.

## Comments

Resolved in [`../research/individual-polling-contract.md`](../research/individual-polling-contract.md). Keep individual short polling, add `Retry-After` plus a capped jittered client schedule, and use an opaque `ETag` with `If-None-Match`/`304` so unchanged polls avoid result hydration and JSON serialization; defer long polling until benchmarks justify its held-connection cost.
