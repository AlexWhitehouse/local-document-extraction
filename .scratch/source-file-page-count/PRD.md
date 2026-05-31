# PRD: Source File Page Count

Status: completed

## Problem Statement

When a user submits a PDF **Document**, the backend currently stores **Source file** metadata such as key, MIME type, name, creation time, and cleanup state, but it does not store how many pages the PDF contains.

From the user's perspective, this leaves the product without durable knowledge of a basic property of the submitted **Document**. Future page-based limits, pricing, processing controls, diagnostics, and user-facing summaries would need to re-read the original **Source file** binary from R2. That is unreliable because completed **Extraction jobs** may delete their **Source file** binary after processing cleanup succeeds.

The backend needs to compute **Source file page count** at the correct point in the Document submission flow and persist it as authoritative internal **Workspace product data** without moving PDF parsing or expensive work into the Workspace Durable Object.

## Solution

Compute **Source file page count** for PDF **Source files** during Document submission, after the request has been validated and the submitted **Source file** bytes have been read, but before the queued **Extraction job** is created in authoritative **Workspace product data**.

Store the count as nullable internal metadata on the Durable Object `source_files` table. New PDF **Source files** require a count. If the backend cannot determine the page count for a PDF, reject the Document submission. Non-PDF **Source files** have no page count and should persist `NULL`. Existing historical rows are not backfilled because their original binaries may already have been cleaned up from R2.

Use a small PDF page-counting module backed by `pdf-lib`. This module should expose a narrow, testable interface that accepts bytes and returns a positive integer page count or a clear invalid-PDF failure. The Document submission route should translate that failure into the agreed rejected-submission behavior.

Do not expose **Source file page count** through public API responses, live update messages, analytics events, queue messages, or Workflow params in this slice. It remains internal metadata until a product feature requires exposing or enforcing it.

## User Stories

1. As a Workspace member, I want PDF Document submissions to record how many pages they contain, so that the product has durable knowledge of submitted PDF size.
2. As a Workspace member, I want invalid PDFs to be rejected during submission, so that I do not create an Extraction job from a PDF the backend cannot inspect.
3. As a Workspace member, I want PNG, JPEG, and WebP Document submissions to continue working, so that adding PDF page metadata does not narrow supported formats.
4. As a Workspace member, I want non-PDF Documents to avoid fake page counts, so that the product does not imply image Source files are page-based.
5. As a Workspace member, I want existing upload and queueing behavior to remain the same for valid PDFs, so that this metadata addition does not change my normal workflow.
6. As a Workspace member, I want the backend to reject malformed PDFs before queueing extraction work, so that failures appear promptly.
7. As a Workspace member, I want completed Extraction jobs to keep their durable metadata after Source file cleanup, so that important information is not lost when R2 binaries are deleted.
8. As an API client developer, I want valid PDF submissions to keep the existing accepted response shape, so that my integration does not need to change for internal metadata.
9. As an API client developer, I want invalid PDF submissions to fail with a clear request error, so that my integration can distinguish bad input from later processing failure.
10. As an API client developer, I want non-PDF submissions to remain accepted when they satisfy existing MIME and byte-size rules, so that current supported formats stay stable.
11. As an API client developer, I want no new required request field for page count, so that page counting remains backend-owned rather than client-supplied.
12. As an API client developer, I want the backend to ignore client guesses about page count, so that authoritative Source file metadata is not spoofable.
13. As a backend maintainer, I want PDF page counting to happen outside the Workspace Durable Object, so that per-Workspace product storage is not blocked by parsing work.
14. As a backend maintainer, I want page count persisted with Source file metadata, so that the metadata lives with the authoritative Source file record.
15. As a backend maintainer, I want queued Extraction job creation to receive Source file page count as explicit metadata, so that the Durable Object does not need to read R2 or parse bytes.
16. As a backend maintainer, I want the Source file metadata column to be nullable, so that non-PDF Source files and historical rows are represented honestly.
17. As a backend maintainer, I want new PDF Source files to require a positive page count, so that new PDF metadata is complete from the moment an Extraction job is queued.
18. As a backend maintainer, I want historical Source files left unbackfilled, so that migration does not depend on R2 objects that may have been cleaned up.
19. As a backend maintainer, I want a small PDF page-counting module, so that PDF parsing behavior can be tested without invoking R2, queues, Workflows, or Durable Objects.
20. As a backend maintainer, I want to use a maintained PDF library instead of hand-rolling PDF structure parsing, so that object streams, xrefs, malformed PDFs, and edge cases are delegated to a library.
21. As a backend maintainer, I want the PDF dependency to be Worker-compatible, so that the upload route can run in the deployed Worker runtime.
22. As a backend maintainer, I want PDF parse failures normalized into a stable application failure, so that the submission route does not leak library-specific errors.
23. As a backend maintainer, I want Source file page count to stay out of live update envelopes for now, so that realtime payloads do not grow without a consumer.
24. As a backend maintainer, I want Source file page count to stay out of analytics for now, so that analytics remains limited to fields already needed by product operations.
25. As a backend maintainer, I want Source file page count to stay out of queue messages and Workflow params, so that background processing contracts do not change unnecessarily.
26. As a backend maintainer, I want the public Extraction job list and detail contracts to remain unchanged, so that this internal metadata addition does not accidentally become public API.
27. As a backend maintainer, I want Source file cleanup behavior unchanged, so that completed Extraction jobs still delete Source file binaries after processing cleanup succeeds.
28. As a backend maintainer, I want queue-send failure cleanup to remain intact, so that adding page count does not create orphaned R2 objects.
29. As a backend maintainer, I want queued job creation failure cleanup to remain intact, so that adding page count does not weaken failure handling.
30. As a backend maintainer, I want Durable Object schema migration to be lazy and idempotent, so that existing Workspace product stores upgrade safely when they wake.
31. As a backend maintainer, I want existing Workspace product data to remain readable after the schema change, so that historical Extraction jobs are not broken by null page counts.
32. As a backend maintainer, I want the domain glossary to define Source file page count, so that future contributors use consistent product language.
33. As a backend maintainer, I want Source file page count treated as internal metadata until a feature needs it, so that public contracts are not created prematurely.
34. As an application operator, I want invalid PDF submissions rejected before model work starts, so that processing capacity is not spent on Source files the backend cannot inspect.
35. As an application operator, I want the system prepared for future page-based limits, so that later enforcement can use already persisted metadata.
36. As an application operator, I want the system prepared for future page-based pricing or reporting, so that later features do not need unreliable R2 backfills.
37. As an AFK agent, I want the PRD to name the affected modules and tests clearly, so that implementation can proceed without rediscovering the design discussion.
38. As an AFK agent, I want implementation to respect the Workspace product data Durable Object ADR, so that expensive parsing stays outside the Durable Object.
39. As an AFK agent, I want tests focused on behavior and contracts, so that the implementation can change without brittle test rewrites.
40. As an AFK agent, I want a concise verification path, so that backend typecheck and focused tests can confirm the feature is complete.

## Implementation Decisions

- The canonical domain term is **Source file page count**.
- A **Source file page count** is the detected number of pages in a PDF **Source file**.
- **Source file page count** applies only to PDF **Source files**.
- Non-PDF **Source files** persist no page count.
- New PDF **Source files** require a page count at Document submission time.
- If the backend cannot determine the page count for a PDF, the Document submission is rejected.
- Existing historical **Source files** are not backfilled because their original **Source file** binary may already have been cleaned up.
- **Source file page count** is internal Source file metadata until a product feature requires exposing or enforcing it.
- Compute page count during Document submission after the submitted Source file bytes have been read.
- Do not compute page count inside the Workspace Durable Object.
- Do not compute page count in the Cloudflare Workflow after the queued Extraction job has been created.
- The Workspace Durable Object receives page count as explicit metadata when creating the queued Extraction job.
- Store page count on the Durable Object `source_files` table as a nullable integer column.
- Keep the column nullable to support non-PDF Source files and historical Source file records.
- Bump the Workspace product store schema version and add a lazy, idempotent migration that adds the page-count column for existing Workspace stores.
- The Durable Object schema migration should not attempt to backfill page counts.
- The queued Extraction job creation RPC input should include Source file page count as nullable metadata.
- The Durable Object should persist Source file page count with Source file metadata in the same transaction that creates the queued Extraction job.
- Use `pdf-lib` as the PDF parsing dependency for this slice.
- Encapsulate `pdf-lib` behind a small backend page-counting module.
- The page-counting module should expose a narrow interface that accepts PDF bytes and returns a positive integer page count.
- The page-counting module should convert parse/load/library failures into a stable application-level invalid-PDF failure.
- The Document submission route should translate invalid-PDF page count failures into a rejected request response.
- The backend should not trust a client-supplied page count.
- The public queued response should remain unchanged.
- Extraction job list and detail responses should remain unchanged.
- Workspace live update payloads should remain unchanged.
- Workspace product analytics events should remain unchanged.
- Queue messages and Workflow params should remain unchanged.
- Workflow extraction behavior should remain unchanged.
- R2 Source file storage behavior should remain unchanged.
- R2 cleanup behavior on queued job creation failure and queue send failure should remain unchanged.
- No ADR is required because the decision follows the existing Workspace product data Durable Object ADR.
- No frontend changes are required in this slice.

## Testing Decisions

- Good tests should assert externally visible behavior and stable module interfaces, not private helper names, exact SQL text, incidental call ordering, or `pdf-lib` internals.
- The PDF page-counting module is the main deep module for this feature and should be tested in isolation.
- Page-counting module tests should verify a valid one-page PDF returns `1`.
- Page-counting module tests should verify a valid multi-page PDF returns the correct count.
- Page-counting module tests should verify malformed PDF bytes produce the stable invalid-PDF failure.
- Page-counting module tests should avoid depending on brittle PDF fixture internals; generate simple valid PDFs through the same library or use compact fixtures.
- Document submission route tests should verify a valid PDF submission passes a positive Source file page count to queued Extraction job creation.
- Document submission route tests should verify invalid PDF bytes are rejected before R2 upload, queued job creation, queue send, or analytics emission.
- Document submission route tests should verify non-PDF supported Source files pass `null` page count to queued Extraction job creation.
- Document submission route tests should verify existing failure handling remains intact when queued job creation fails after R2 upload.
- Document submission route tests should verify existing failure handling remains intact when queue send fails after queued job creation.
- Workspace product store tests should verify queued Extraction job creation persists Source file page count in Source file metadata.
- Workspace product store tests should verify non-PDF/null page count Source file metadata is accepted.
- Workspace product store tests should verify existing stores can lazily migrate to the new nullable Source file page-count column.
- Workspace product store tests should verify listed and detailed Extraction job response shapes do not expose page count.
- Workspace live update tests should verify lifecycle payloads do not expose page count.
- Analytics tests should verify Document submitted analytics behavior remains non-sensitive and does not include Source file page count in this slice.
- Prior art exists in backend extraction API tests for Document submission, R2 cleanup, queue-send failure, and analytics behavior.
- Prior art exists in backend Workspace product store tests for Durable Object schema, Source file metadata, queued Extraction job creation, and live update payloads.
- Backend typecheck should pass after implementation.
- Focused backend tests for the page-counting helper, Document submission route, and Workspace product store should pass after implementation.

## Out of Scope

- Exposing Source file page count in public API responses.
- Exposing Source file page count in Workspace live update messages.
- Emitting Source file page count to Workspace product analytics.
- Sending Source file page count in queue messages or Workflow params.
- Using Source file page count in model prompts or extraction processing.
- Displaying Source file page count in the frontend.
- Enforcing page-based Workspace limits.
- Adding page-based pricing, billing, quota, or reporting.
- Backfilling historical Source files.
- Reading completed historical Source file binaries from R2 to reconstruct metadata.
- Supporting page counts for PNG, JPEG, WebP, or other non-PDF Source files.
- Replacing R2 as the authoritative binary store for Source files.
- Moving PDF parsing into the Workspace Durable Object.
- Adding a generic SQL/query interface to Workspace product stores.
- Creating a new ADR for this decision.

## Further Notes

- This PRD follows the existing Workspace product data Durable Object ADR: expensive processing stays outside the Durable Object, while authoritative **Workspace product data** is persisted inside the Workspace product store.
- The backend glossary has been updated with **Source file page count** and the rules that it is PDF-only, required for new PDF submissions, internal until needed, and not backfilled.
- `pdf-lib` was selected over `pdfjs-dist` and `pdf-parse` because it is a maintained, Worker-compatible dependency with a narrow page-counting API and avoids adding heavier browser/canvas-oriented dependencies to the upload path.
- The implementation should keep this change deliberately small: compute page count, persist it, reject invalid PDFs, and avoid public contract changes until a product feature needs the metadata.
