# Individual Extraction job polling contract

Research date: 2026-08-16

## Recommendation

Keep `GET /v1/jobs/{job_id}` as a short, individual, backward-compatible read. Add server-directed delay, a weak entity tag, and conditional retrieval:

- The submission `202` adds `Location: /v1/jobs/{job_id}`, `Retry-After: 2`, and `Cache-Control: no-store` without changing its JSON body.
- Every successful job read returns the existing `200` JSON plus an opaque weak `ETag` and `Cache-Control: private, no-cache`. Queued and processing reads also return `Retry-After: 5`.
- A client that already has the representation sends `If-None-Match`. If the authorized job's visible state is unchanged, return bodyless `304`; otherwise return the new `200` body. Legacy clients that never send a validator continue receiving exactly the current status and body.
- The reference client waits 2 seconds after submission, then uses delays of 5 and 8 seconds, capped at 8 seconds, with 0–20% positive jitter. It has at most one request in flight, resets to 5 seconds when lifecycle state changes, and stops on `completed` or `failed`.
- Do not add long polling in the first implementation. Conditional short polling has nearly the same request count at the recommended cap without holding 1,000 requests and connections open or changing Bun timeout wiring.

This retains one-job-per-worker retrieval. It does not require batch retrieval, WebSockets, or a changed Extraction result shape.

## Current path and cost

The route is matched only for `GET` or `DELETE` at [`backend/src/localApplication.ts:358-377`](../../../backend/src/localApplication.ts#L358). An individual read then:

1. Reauthorizes every request at [`backend/src/localApplication.ts:1072-1096`](../../../backend/src/localApplication.ts#L1072). A bearer API key is SHA-256 hashed and looked up through the unique `workspaces.api_key_hash` value ([`backend/src/localWorkspaceControl.ts:358-365`](../../../backend/src/localWorkspaceControl.ts#L358)); a browser session instead requires the `x-workspace-id` membership lookup.
2. Acquires a Workspace product operation, opens that Workspace's product database, and closes it after the response at [`backend/src/localApplication.ts:697-708`](../../../backend/src/localApplication.ts#L697) and [`backend/src/localApplication.ts:772-796`](../../../backend/src/localApplication.ts#L772).
3. Runs a summary query by `jobs.id`, joining the unique `source_files.job_id`, and then always runs the result query joining `job_results`, `jobs`, and `template_fields` ([`backend/src/localWorkspaceProductStore.ts:854-890`](../../../backend/src/localWorkspaceProductStore.ts#L854)). It parses every `answer_json` value even though queued, processing, and failed jobs have no results.
4. Calls `Response.json(job)` with no validator, cache, or polling headers ([`backend/src/localApplication.ts:772-776`](../../../backend/src/localApplication.ts#L772)). Repeated terminal reads therefore rehydrate and serialize all retained results.

The browser's fallback behavior is a fixed one-second `setInterval` while the selected job is live ([`frontend/src/features/documents/useDocumentController.js:1227-1249`](../../../frontend/src/features/documents/useDocumentController.js#L1227)). Its in-flight map prevents duplicate simultaneous reads, but it still attempts one read per second. The JSON request layer consumes the body, discards response headers, and treats `304` as an error ([`frontend/src/lib/appRuntime.js:33-68`](../../../frontend/src/lib/appRuntime.js#L33)); the adapter cannot yet carry validators ([`frontend/src/features/documents/documentRequestAdapter.js:19-25`](../../../frontend/src/features/documents/documentRequestAdapter.js#L19)). Browser live updates usually suppress this loop, but the production workers in the PRD poll directly.

## Conditional read path

After successful authorization, read one polling snapshot containing all visible summary scalars. Compute an opaque weak tag such as `W/"job-v1-<sha256>"` over a canonical representation version, Workspace ID, and every visible summary value. Do **not** use only `updated_at`: [`recordExtractionJobModel`](../../../backend/src/localWorkspaceProductStore.ts#L687) changes visible model values without changing that timestamp. Including a representation version also invalidates old validators if serialization semantics change after a deployment.

Weak tags are appropriate because the goal is semantic validation rather than proving byte-for-byte identity. [RFC 9110 entity tags](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3) define weak validators, and [`If-None-Match`](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2) requires weak comparison for cache validation and `304` for a false GET condition. The implementation must parse tag lists, weak prefixes, and `*` according to that grammar rather than compare one raw string.

Evaluate authorization, Workspace access, overload admission, and job existence before the conditional request. [RFC 9110's precondition ordering](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.1) requires normal request checks before evaluating preconditions; this also prevents a validator from becoming a cross-Workspace existence oracle.

If the tag matches, close/release the product read and return `304` before querying or parsing results. A `304` cannot contain a body and must carry the relevant validator/cache fields from the equivalent `200` ([RFC 9110 section 15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)). If the tag does not match:

- build queued, processing, and failed responses from the snapshot with `results: []` and no result query;
- query, hydrate, and serialize results only for `completed`;
- return the unchanged public JSON shape.

Completion inserts results and changes the job to `completed` in one transaction ([`backend/src/localWorkspaceProductStore.ts:616-684`](../../../backend/src/localWorkspaceProductStore.ts#L616)); terminal jobs do not transition again. The summary validator can therefore safely indicate whether immutable terminal results could have changed. Deletion removes the job, so a later authenticated read returns `404`, not `304`.

No new index is required for this path. `jobs.id` is the primary key, `source_files.job_id` is unique, and `job_results` has `(job_id, field_id)` as its primary key plus the existing job index ([`backend/src/localWorkspaceProductStore.ts:1068-1108`](../../../backend/src/localWorkspaceProductStore.ts#L1068)). Database connection and transaction policy remains owned by the SQLite research decision.

## Exact response contract

| Condition | Status and body | Additive headers | Client behavior |
| --- | --- | --- | --- |
| Submission accepted | Existing `202` JSON | `Location: /v1/jobs/{encoded id}`; `Retry-After: 2`; `Cache-Control: no-store` | Wait at least 2 seconds before the first GET. |
| Queued or processing, no matching validator | Existing `200` job JSON | `ETag`; `Cache-Control: private, no-cache`; `Retry-After: 5` | Store body/tag; continue the schedule. |
| Queued or processing, matching validator | `304`, no body | Same `ETag` and cache control; `Retry-After: 5` | Reuse cached job; treat as unchanged. |
| Completed or failed, no matching validator | Existing terminal `200` JSON | `ETag`; `Cache-Control: private, no-cache`; no `Retry-After` | Store the terminal body and stop polling. |
| Completed or failed, matching validator | `304`, no body | Same `ETag` and cache control; no `Retry-After` | Reuse cached terminal body and stop. |
| Missing job in an authorized Workspace | Existing `404` error JSON | `Cache-Control: no-store`; no validator or retry hint | Stop; do not retry as polling. |
| Unauthenticated or wrong Workspace | Existing `401`/`403` error JSON | `Cache-Control: no-store`; no validator | Stop and surface authentication/access failure. |
| Caller-specific polling rate exceeded | `429` error JSON | `Retry-After: <seconds until caller permit>`; `Cache-Control: no-store` | Honor the larger of this value and error backoff. |
| Shared read capacity unavailable | `503` error JSON | `Retry-After: <estimated recovery seconds>` (default 5); `Cache-Control: no-store` | Honor the larger of this value and error backoff. |

`Retry-After` accepts either an HTTP date or an integer delay in seconds; integer seconds are simplest here ([RFC 9110 section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)). `private` prevents storage by shared caches while `no-cache` permits private storage only with revalidation ([RFC 9111 `private`](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.7) and [`no-cache`](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.4)). This matters because terminal results are retained indefinitely but access can be revoked and jobs can be deleted; a positive freshness lifetime could serve sensitive stale results without reauthorization.

Use `429` only when this caller or credential exceeds the polling policy; [RFC 6585 section 4](https://www.rfc-editor.org/rfc/rfc6585.html#section-4) defines it for rate limiting and permits `Retry-After`. Use `503` for a shared, temporary server/read-admission ceiling ([RFC 9110 section 15.6.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4)). Do not return either merely because an Extraction job is queued or processing. Thresholds belong to the processing-control and benchmark decisions, but the response semantics do not.

## Reference client algorithm

1. Parse the `202`, job ID, `Location`, and `Retry-After`; wait `2 × U(1.0, 1.2)` seconds when the server returns the recommended value.
2. Issue one GET with a 10-second per-request timeout. After the first `200`, retain its body and `ETag`; send that tag on later requests as `If-None-Match`.
3. On unchanged nonterminal state (`304`, or the same state in a legacy `200`), wait 5 seconds once, then 8 seconds thereafter. On a queued-to-processing or processing-to-queued transition, reset to 5. Apply positive 0–20% jitter after taking the maximum of local delay and `Retry-After`, so jitter never violates the server's minimum.
4. On `completed` or `failed`, return the cached/current representation and stop. Never poll a terminal representation automatically.
5. On a network failure, timeout, `429`, or `503`, use 5, 8, 13, 21, then 30 seconds capped, again honoring a larger `Retry-After` and applying positive jitter. Reset error backoff after a successful response. Other `4xx` responses are terminal client errors.
6. Schedule the next timeout only after the previous request settles; never use an interval that can overlap. Caller cancellation aborts the current GET and clears the timer. Reaching a caller-defined overall deadline stops that worker but does not cancel the durable Extraction job, which remains retrievable by ID.

Bun implements fetch cancellation and `AbortSignal.timeout` ([Bun fetch](https://bun.sh/docs/runtime/networking/fetch)). An injected clock/random source should make the reference algorithm deterministic in tests.

## Request-volume model for 1,000 workers

There is no measured production gateway latency distribution in the repository, so 15, 60, and 300 seconds are explicit short/ordinary/long modeling points, not claimed percentiles. The table assumes 1,000 jobs submitted together, no jitter, no retries, and no extra reset for a queued-to-processing transition.

| Strategy | 15-second jobs | 60-second jobs | 300-second jobs | Steady request rate while all remain active |
| --- | ---: | ---: | ---: | ---: |
| Fixed 1 second (current fallback) | 15,000 | 60,000 | 300,000 | 1,000 req/s |
| Fixed 5 seconds | 3,000 | 12,000 | 60,000 | 200 req/s |
| Recommended 2, 5, 8, 8… | about 3,000 | about 9,000 | about 39,000 | 125 req/s after ramp |
| Event-driven long poll with 8-second maximum | at least 2,000 | at least 8,000 | at least 38,000 | about 125 responses/s plus 1,000 held requests |

Jitter turns synchronized bursts into a spread arrival rate. Conditional requests do not reduce request count, but most unchanged reads become one auth lookup, one indexed snapshot read, and a header-only response; they avoid the result join, JSON parsing, result serialization, and response bytes. The terminal body is transferred once per client validator lineage.

Long polling is not recommended initially. The current `Bun.serve` configuration does not set an idle timeout, and Bun documents a default 10-second idle timeout that also applies while a handler is waiting without sending bytes ([Bun HTTP server](https://bun.sh/docs/runtime/http/server#idletimeout)). A longer wait would need per-request `server.timeout`, but the current runtime does not pass the Bun server into the application route. Correct long polling would also need an event registry, immediate release of SQLite resources while waiting, disconnect/abort cleanup, and a cap on held requests. An 8-second wait fits the default but provides little request-count benefit over the simple capped schedule. Reconsider it only if the target-machine benchmark shows conditional short polling is still a bottleneck.

## Security and overload placement

- Authenticate and authorize every request, including revalidation and terminal reads. Never return `304` from an unauthenticated validator match.
- Keep entity tags opaque and include Workspace identity in their hash input. Do not expose lifecycle timestamps or status in the tag.
- Apply a caller token bucket after authentication but before opening the product database. Key API traffic by a non-reversible credential fingerprint/Workspace rather than raw credential or IP; 1,000 legitimate workers can share an IP and API key.
- Apply the shared read-admission ceiling before product database work. Do not queue unbounded HTTP reads behind a saturated database.
- Preserve the current `404` for a missing ID inside an authorized Workspace and `403` for invalid Workspace access.

## Expected code seams and validation

Expected seams, without implementing them here:

- Split product-store polling snapshot from completed-result hydration in `localWorkspaceProductStore.ts`.
- Centralize job response validators, cache headers, conditional matching, and overload responses in the individual route in `localApplication.ts`.
- Extend the JSON request layer to optionally return status/headers and treat `304` as a successful conditional outcome; carry body plus tag in `documentRequestAdapter.js`.
- Replace the fixed browser fallback interval with the same single-flight scheduler, while keeping WebSocket live updates preferred for the SPA.

Focused verification should cover:

- unchanged legacy `200` bodies for all four lifecycle states;
- weak/list/`*` `If-None-Match` parsing, bodyless `304`, and required headers;
- validator changes across queued, processing, retry/requeue, model recording, completed, and failed mutations, including the model update that does not change `updated_at`;
- proof with an instrumented store that `304` and nonterminal reads never execute result hydration;
- authorization before conditional evaluation, cross-Workspace tags, deletion, and access revocation;
- deterministic jitter/backoff, no overlapping requests, aborts, timeouts, terminal stop, and `429`/`503` handling;
- a 1,000-worker fake-gateway load run at 15/60/300-second distributions, recording request rate, `200`/`304` ratio, bytes, SQLite statements, event-loop lag, CPU, memory, and terminal retrieval latency.

## Primary sources

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [RFC 6585: 429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)
- [Bun: HTTP server and idle timeout](https://bun.sh/docs/runtime/http/server#idletimeout)
- [Bun: fetch cancellation and timeouts](https://bun.sh/docs/runtime/networking/fetch)
