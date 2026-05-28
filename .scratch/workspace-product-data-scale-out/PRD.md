# PRD: Workspace Product Data Scale-Out

Status: ready-for-agent

## Problem Statement

The application currently stores **Workspace control data** and **Workspace product data** in one global D1 database. That means every **Workspace**, **Template**, **Extraction job**, and **Extraction result** shares one database storage ceiling. From the user's perspective, this creates a hard application-scale limit: the product cannot grow beyond the row-data capacity of a single D1 database, even when each individual **Workspace** would fit comfortably within platform limits.

The current architecture also requires the SPA to poll while an **Extraction job** is queued or processing. From the user's perspective, that makes upload progress feel less immediate and creates unnecessary repeated reads while background processing is running.

The desired outcome is to let the whole application scale across many Workspaces without turning global D1 into the authority for all product rows, while preserving simple Workspace-scoped APIs, durable **Extraction job lifecycle** rules, and clear realtime feedback for the SPA.

## Solution

Keep global D1 as the authority for **Workspace control data**: account/session records, Workspace records, Workspace memberships, Workspace invitations, and Workspace API key lookup. Move authoritative **Workspace product data** into one SQLite-backed Durable Object per **Workspace**, addressed deterministically by Workspace ID.

The Workspace Durable Object owns **Template**, **Template version**, **Template field**, **Extraction job**, **Extraction result**, and **Source file** metadata. It exposes domain-specific RPC methods rather than raw SQL. Customer-facing workspace product APIs read and write through the Workspace Durable Object, not a global D1 product projection.

R2 remains the authoritative binary store for **Source files**. The Durable Object stores Source file metadata only. Completed **Extraction jobs** should delete Source file binaries after processing cleanup succeeds, and Workspace deletion cleanup only sweeps residual Source files that normal lifecycle cleanup did not delete.

Cloudflare Workflow remains the **Extraction processor**. The Workflow performs long-running model and R2 work outside the Durable Object, then calls the Workspace Durable Object to claim, complete, fail, and clean up authoritative job state. The Durable Object owns durable **Extraction job lifecycle** state; the Workflow owns processing execution and retry steps.

Use Workers Analytics Engine for **Workspace product analytics**. Do not add a global D1 projection of Workspace product data in the first migration. Analytics events may include stable product identifiers such as Workspace ID, Template ID, and Extraction job ID, but must not include extracted answers, evidence text, Source file names, account emails, API keys, or Document contents.

Add Workspace-scoped live updates for the SPA using Durable Object WebSocket Hibernation. The SPA opens a session-only WebSocket for the accepted **Workspace context**. The Worker validates session Workspace access before proxying the WebSocket upgrade to the Workspace Durable Object. Live update messages use a versioned batch envelope and notify clients about all **Extraction job lifecycle** changes for the Workspace after authoritative state has been persisted.

The initial cutover does not require automated migration of existing Workspace product data because production usage is limited to the operator. Legacy global D1 product tables remain during initial rollout for rollback/archive, but product code stops writing authoritative product data to them.

## User Stories

1. As an application operator, I want the app to scale across many Workspaces, so that total product row data is not capped by one global D1 database.
2. As an application operator, I want each Workspace's product data isolated from other Workspaces, so that one Workspace's data growth does not consume the entire application's database capacity.
3. As an application operator, I want global D1 reserved for control data, so that authentication and Workspace routing stay small and durable.
4. As an application operator, I want Workspace product rows moved out of global D1, so that Templates, Extraction jobs, and Extraction results can grow horizontally by Workspace.
5. As an application operator, I want to avoid a global D1 product-data projection in the first migration, so that we do not create another D1 growth point.
6. As an application operator, I want Workers Analytics Engine for global analytics, so that aggregate reporting does not require duplicating product rows into D1.
7. As an application operator, I want analytics events to exclude customer content and identity data, so that aggregate reporting does not become a sensitive data store.
8. As an application operator, I want stable product IDs available in analytics events, so that usage and failure spikes can be investigated.
9. As an application operator, I want legacy global D1 product tables retained during the initial cutover, so that rollback remains possible.
10. As an application operator, I want no automated migration of existing operator-only product data, so that the first implementation avoids unnecessary migration machinery.
11. As a backend maintainer, I want a clear boundary between Workspace control data and Workspace product data, so that routing and authorization stay understandable.
12. As a backend maintainer, I want Workspace membership authorization checked before product data routing, so that the Durable Object can trust the Worker authorization boundary.
13. As a backend maintainer, I want Workspace API key lookup to stay in global D1, so that external clients do not need to provide Workspace context before authentication.
14. As a backend maintainer, I want Workspace API keys to remain external-client credentials, so that SPA sessions and API keys keep separate responsibilities.
15. As a backend maintainer, I want the Workspace Durable Object addressed by Workspace ID, so that no separate Durable Object ID mapping table is needed.
16. As a backend maintainer, I want Workspace product operations exposed as domain-specific RPC methods, so that storage details do not leak into API handlers or Workflows.
17. As a backend maintainer, I want no generic SQL interface on the Durable Object, so that schema changes remain local to the product store.
18. As a backend maintainer, I want the Durable Object to own Template existence and status checks, so that extraction submission never reads stale Template state from another store.
19. As a backend maintainer, I want the Durable Object to own Template version creation, so that Template changes are authoritative inside the Workspace product store.
20. As a backend maintainer, I want the Durable Object to enforce Template field count limits, so that limits depending on product rows use authoritative counts.
21. As a backend maintainer, I want configured Workspace limits to remain control data, so that plan/configuration remains easy to read and update.
22. As a backend maintainer, I want Source file byte-size validation to happen before R2 upload, so that oversized Documents are rejected before storage work.
23. As a backend maintainer, I want Source file metadata stored in the Workspace Durable Object, so that product APIs can read it from authoritative product data.
24. As a backend maintainer, I want Source file binaries to remain in R2, so that Durable Object storage is not used for uploaded file contents.
25. As a backend maintainer, I want completed Extraction jobs to delete Source file binaries after processing, so that R2 does not retain Documents unnecessarily.
26. As a backend maintainer, I want Source file cleanup failures to be recoverable, so that a successful Extraction job is not corrupted by cleanup trouble.
27. As a backend maintainer, I want Workspace deletion cleanup to sweep only residual Source files, so that normal Extraction job cleanup remains the primary retention mechanism.
28. As a backend maintainer, I want Workspace deletion cleanup to be idempotent, so that retries can safely delete leftover R2 objects.
29. As a backend maintainer, I want the Durable Object to own durable Extraction job lifecycle state, so that queued, processing, completed, and failed states are consistent.
30. As a backend maintainer, I want Cloudflare Workflow to remain the Extraction processor, so that long-running model and R2 work stays outside the Durable Object.
31. As a backend maintainer, I want expensive processing to stay outside the Durable Object, so that per-Workspace single-threading does not become a processing bottleneck.
32. As a backend maintainer, I want Workflow attempts to claim jobs through the Durable Object, so that stale attempts cannot overwrite newer state.
33. As a backend maintainer, I want Workflow completion to persist Extraction results and mark the job completed through one domain operation, so that completed jobs always have durable results.
34. As a backend maintainer, I want Workflow failure to mark jobs failed through the Durable Object, so that terminal errors are represented in authoritative product data.
35. As a backend maintainer, I want queue-send failure during submission to mark the job failed and delete the uploaded Source file, so that partially queued submissions do not leave confusing live work.
36. As a backend maintainer, I want the queue and Workflow message to carry Workspace ID, Extraction job ID, and attempt, so that background processing can route to the correct Workspace product store.
37. As a backend maintainer, I want Durable Object schema migrations to be lazy and versioned, so that old Workspace stores can upgrade safely when they wake.
38. As a backend maintainer, I want Durable Object schema migrations to be idempotent, so that retries and deploy restarts do not corrupt Workspace product stores.
39. As a backend maintainer, I want Durable Object constructors kept lightweight, so that WebSocket hibernation wakeups do not perform expensive work.
40. As a backend maintainer, I want WebSocket connection state restored from serialized attachments, so that hibernated objects can rebuild connection maps after waking.
41. As a backend maintainer, I want no application-level heartbeat timers in the Durable Object, so that idle objects can hibernate and avoid duration costs.
42. As a backend maintainer, I want protocol ping/pong or hibernation auto-responses used where needed, so that connection health does not wake the Durable Object unnecessarily.
43. As a backend maintainer, I want WebSocket messages batched in a versioned envelope, so that later coalescing does not break the client contract.
44. As a backend maintainer, I want WebSocket notifications sent only after product state is persisted, so that clients never see a lifecycle event that authoritative data does not confirm.
45. As a backend maintainer, I want clients to revalidate over HTTP after reconnecting, so that WebSockets do not become a durable event log.
46. As a frontend maintainer, I want the SPA to subscribe to Workspace live updates, so that selected live jobs do not require one-second polling.
47. As a frontend maintainer, I want live updates to cover all jobs in the accepted Workspace context, so that multi-file uploads and other tabs keep the document list fresh.
48. As a frontend maintainer, I want live update messages to include job summary fields, so that the document list can update without fetching every status change.
49. As a frontend maintainer, I want completed job details still fetched over HTTP when needed, so that extraction answers and evidence do not travel over live update messages.
50. As a frontend maintainer, I want the SPA to re-fetch jobs after reconnecting, so that missed live updates do not leave the UI stale.
51. As a frontend maintainer, I want the WebSocket route to be session-only in the first implementation, so that it solves SPA polling without new API-key realtime auth.
52. As a frontend maintainer, I want non-WebSocket requests to the live route rejected clearly, so that integration mistakes are easy to diagnose.
53. As a Workspace member, I want submitted Documents to appear queued promptly, so that I know the upload was accepted.
54. As a Workspace member, I want Extraction job status to update without manual refresh, so that I can watch processing progress naturally.
55. As a Workspace member, I want multiple uploads to update together, so that batch processing feels coherent.
56. As a Workspace member, I want completed jobs to show as completed quickly, so that I can open results as soon as processing finishes.
57. As a Workspace member, I want failed jobs to show an error state quickly, so that I do not wait on a job that has already failed.
58. As a Workspace member, I want live updates to avoid exposing extracted answers until I open the job, so that sensitive extraction output stays behind normal HTTP reads.
59. As a Workspace member, I want the UI to recover after connectivity drops, so that reconnecting does not require refreshing the whole app.
60. As a Workspace member, I want Workspace switching to connect to the new Workspace's live updates, so that I only see events for my current accepted Workspace context.
61. As an external API client, I want existing Workspace API key product-route access to continue, so that external integrations are not broken by the storage move.
62. As an external API client, I do not need WebSocket live updates in the first implementation, so that realtime auth can be designed later if needed.
63. As an Application admin, I want future analytics to answer aggregate usage questions, so that app-level operations are possible without querying every Workspace store.
64. As an Application admin, I do not need full cross-Workspace SQL over product rows in the first implementation, so that the scale-out can avoid a global projection.
65. As an AFK agent, I want the architecture captured in domain docs and an ADR, so that implementation follows the agreed boundaries.
66. As an AFK agent, I want deep modules with stable interfaces, so that backend storage changes can be tested without rendering the whole app or invoking every platform service.
67. As an AFK agent, I want the old product-table cleanup deferred, so that initial implementation can focus on the new authoritative path and rollback safety.

## Implementation Decisions

- Build a deep Workspace product store Module backed by a SQLite Durable Object. Its public interface should be domain-specific: Template operations, Extraction job lifecycle operations, Source file metadata operations, cleanup helpers, live update connection handling, and product analytics facts returned to callers where useful.
- Keep Workspace control data in global D1: account/session records, Workspace records, Workspace memberships, Workspace invitations, Workspace API key hashes, and Workspace limit configuration.
- Stop using global D1 product tables as the authoritative store for Templates, Template fields, Template versions, Extraction jobs, Extraction results, and Source file metadata.
- Retain legacy global D1 product tables during the initial cutover for rollback/archive, but do not write new authoritative product data to them.
- Do not build automated product-data migration for the first cutover. Existing production usage is operator-only, so existing product data may be manually recreated or handled by a one-off script if needed.
- Address Workspace Durable Objects deterministically by Workspace ID.
- Add Durable Object binding and migration configuration for a SQLite-backed Workspace product store.
- Implement lazy, versioned, idempotent SQLite schema migrations inside the Workspace product store initialization path.
- Keep the Durable Object constructor lightweight. It may restore hibernated WebSocket connection state and ensure schema readiness, but it must not perform expensive import, cleanup, analytics, or processing work.
- Expose product operations through domain-specific RPC methods, not a generic SQL/query interface.
- Product API handlers authenticate and authorize through Workspace control data before routing to the Workspace product store.
- Workspace API key authentication remains a global D1 control-data lookup so bearer-token clients do not need to provide Workspace context before authentication.
- Session-based product API requests continue to use the accepted Workspace context selected by the SPA.
- Workspace limits remain configured in control data. Product-row-dependent limits are enforced by the Workspace product store against authoritative counts.
- R2 remains the authoritative binary store for Source files. The Workspace product store stores only Source file metadata, cleanup markers, and related job metadata.
- Document submission validates request shape and Source file byte size before R2 upload, validates Template existence/status/current version through the Workspace product store, uploads to R2, creates a queued Extraction job in the Workspace product store, then sends the queue/Workflow message.
- If queued job creation fails after R2 upload, delete the R2 object immediately.
- If queue send fails synchronously after queued job creation, mark the Extraction job failed and delete the uploaded Source file.
- Cloudflare Workflow remains the Extraction processor. It calls the Workspace product store to load, claim, complete, fail, and mark cleanup for Extraction jobs.
- Expensive model invocation, R2 object reads, and R2 object deletes stay outside the Durable Object.
- A completed Extraction job should not retain its Source file binary after processing cleanup succeeds.
- Workspace deletion cleanup is a background residual sweep for Source files that normal lifecycle cleanup did not delete. It should be idempotent and batch-oriented.
- Do not add a global D1 product-data projection in the first migration.
- Emit Workspace product analytics to Workers Analytics Engine from Worker/Workflow callers after successful Workspace product store operations. Analytics emission is not part of authoritative state mutation.
- Day-one analytics events include Document submitted, Extraction completed, Extraction failed, Template created, and Template updated.
- Analytics events may include Workspace ID, Template ID, Extraction job ID, event type, status or error code, attempt count, source MIME type, source byte size, model name, field count, and duration.
- Analytics events must not include extracted answers, evidence text, Source file names, account emails, API keys, Source file binary contents, or Document contents.
- Add a session-only Workspace live update route for the SPA at `GET /v1/workspaces/:workspaceId/live`.
- The Worker validates request method, WebSocket upgrade header, session, and Workspace membership before proxying the live connection to the Workspace product store.
- Workspace API keys do not open live update WebSocket connections in the first implementation.
- The Workspace product store terminates live update WebSockets using the Durable Object WebSocket Hibernation API.
- Live update sockets use serialized attachments for minimal connection state so hibernated objects can rebuild in-memory connection maps after waking.
- Live update notifications cover all Extraction job lifecycle changes for the accepted Workspace context.
- Live update notifications are sent only after authoritative product state has been persisted.
- Live update messages use a versioned batch envelope.
- Live update job events include job summary fields such as job ID, status, Template ID, Template version, Source file name, timestamps, attempt information, and error code. They do not include Extraction results, answers, or evidence.
- The SPA replaces selected live-job polling with the Workspace live update subscription, while keeping HTTP reads for initial job lists, reconnect revalidation, completed job details, search, pagination, and fallback.
- The frontend reconnect path revalidates authoritative Workspace product data over HTTP because WebSockets are not durable history.
- Browser upload byte progress is out of scope for the WebSocket feature. The WebSocket reports server-side job lifecycle updates after upload acceptance.
- Follow Cloudflare Durable Object WebSocket best practices: use hibernation, avoid standard `ws.accept()`, avoid application heartbeat timers, rely on protocol ping/pong or hibernation auto-response when needed, batch logical messages, and validate bad upgrade requests before invoking the Durable Object.

## Testing Decisions

- Good tests should verify external behaviour and domain contracts rather than private helpers, SQL strings, internal storage layout, or Cloudflare runtime implementation details.
- The Workspace product store should be tested as the primary deep module. Tests should cover Template operations, Template versioning, Template field limits, Extraction job lifecycle transitions, Source file metadata, idempotency, stale attempt handling, completion, failure, and cleanup markers.
- Product API tests should verify that session and API-key authorization happen through Workspace control data before product store routing.
- Product API tests should verify that product route responses come from authoritative Workspace product data, not legacy global D1 product tables.
- Document submission tests should verify successful submission stores Source file bytes in R2, creates a queued Extraction job through the Workspace product store, sends the background processing message, and returns the expected queued response.
- Document submission tests should verify R2 cleanup when job creation fails after upload.
- Document submission tests should verify queued job failure and R2 cleanup when queue send fails synchronously after job creation.
- Workflow tests should verify that the Extraction processor claims, completes, fails, and marks cleanup through the Workspace product store rather than direct global D1 product writes.
- Workflow tests should verify stale or duplicate attempts cannot overwrite terminal lifecycle state.
- Workflow tests should verify completed Extraction jobs have durable Extraction results before live update completion events are emitted.
- R2 cleanup tests should verify completed jobs delete Source file binaries without corrupting completed product data if cleanup fails.
- Workspace deletion cleanup tests should verify residual Source files are batched, deleted idempotently, and marked cleaned.
- WebSocket route tests should verify non-GET or missing-upgrade requests are rejected without invoking the Durable Object.
- WebSocket route tests should verify non-members and unauthenticated users cannot open live update sockets.
- WebSocket route tests should verify Workspace API keys cannot open live update sockets in the first implementation.
- Workspace live update tests should verify job lifecycle events are broadcast only after authoritative state changes.
- Workspace live update tests should verify message envelopes are versioned and batched.
- Workspace live update tests should verify live update payloads exclude Extraction results, answers, evidence, API keys, account emails, Source file binary contents, and Document contents.
- Frontend tests should verify the SPA opens one live update connection for the accepted Workspace context and closes/replaces it on Workspace switch, sign-out, or loss of access.
- Frontend tests should verify live job polling is not used while the live update connection is active.
- Frontend tests should verify HTTP revalidation happens after live update reconnect.
- Frontend tests should verify job list and selected job state update from live job lifecycle messages.
- Frontend tests should verify completed job details are still fetched over HTTP when opened.
- Analytics tests should verify Workers Analytics Engine receives non-sensitive event fields after successful product operations.
- Analytics tests should verify analytics failures do not fail product operations.
- Prior art exists in backend Workspace policy tests for authorization and role behavior.
- Prior art exists in backend document processing workflow tests that fake platform bindings and assert lifecycle outcomes.
- Prior art exists in backend extraction API tests for Document submission behaviour.
- Prior art exists in frontend document controller/App tests for polling, upload queueing, job list updates, and selected document state.
- Backend typecheck should be used as the focused verification command after backend implementation.
- Frontend production build should be used after frontend live update changes.

## Out of Scope

- Supporting a single Workspace with more than the per-object SQLite storage limit.
- Sharding one Workspace's product data by time period, job bucket, or another sub-Workspace boundary.
- Automated migration of existing global D1 product rows into Workspace Durable Objects for the initial cutover.
- Removing legacy global D1 product tables in the initial migration.
- Adding a global D1 projection of Workspace product data.
- Building rich Application admin analytics dashboards.
- Exporting analytics to a warehouse or long-term BI system.
- Treating Workers Analytics Engine as an authoritative data store.
- Sending extracted answers, evidence text, Source file binary contents, or Document contents through analytics or live update messages.
- Allowing Workspace API keys to open WebSocket live update connections.
- Building browser upload-byte progress.
- Replacing Cloudflare Workflow as the Extraction processor.
- Moving Source file binaries out of R2.
- Changing the public product terms **Workspace**, **Document**, **Source file**, **Template**, **Template version**, **Extraction job**, **Extraction job lifecycle**, or **Extraction result**.
- Redesigning Better Auth, account verification, password reset, Application admin, Workspace invitation, or Leave Workspace flows beyond the control-data/product-data boundary needed for this feature.
- Introducing a generic SQL API or admin query surface over Workspace product stores.
- Building support for offline live update replay. Clients recover by HTTP revalidation after reconnect.

## Further Notes

- This PRD follows the accepted ADR for Workspace product data in Durable Objects.
- The scale target is whole-application scale across many Workspaces, not unbounded product data inside one Workspace.
- The Durable Object per Workspace is both the product-data authority and the live update coordination point. That makes the architecture cohesive, but it also means expensive processing must stay outside the Durable Object.
- WebSocket live updates solve server-side Extraction job lifecycle visibility. They do not show browser upload byte progress before the HTTP upload is accepted.
- The first implementation should prefer a conservative cutover: route all new authoritative product writes to the Workspace product store, keep legacy global product tables for rollback/archive, and defer destructive cleanup until the new path has proven stable.
