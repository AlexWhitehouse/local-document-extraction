# PRD: Document Extraction Terminology Cleanup

Status: needs-triage

## Problem Statement

The product now treats submitted source formats as **Documents**, but historic application-owned terminology still refers to `image`, `file`, and “Image Extraction” across the backend, frontend, API examples, configuration, storage bindings, schema names, tests, and support docs.

This creates a product and implementation mismatch. Users can submit PDFs as well as PNG, JPEG, and WebP source formats, but product-facing labels and API contracts still imply an image-only system. Maintainers and AFK agents also have to translate between legacy implementation names and the resolved glossary terms **Document**, **Source file**, **Extraction job**, and **Document Extraction**.

The desired outcome is a clean, non-compatibility terminology migration: application-owned names should use **Document** and **Source file** terminology, the submission contract should require the `document` multipart field, and legacy `image` or generic `file` aliases should not be accepted, advertised, or exposed through application-owned APIs.

## Solution

Rename application-owned product, API, persistence, configuration, storage, workflow, UI, test, and support-doc terminology from legacy `image` language to the resolved **Document** and **Source file** language.

The extraction submission API should accept exactly one source field named `document`. It should reject legacy `image` and generic `file` fields rather than preserving compatibility aliases. **Extraction job** responses should expose **Source file** metadata using new response names only, without legacy response aliases.

Persisted D1 column names should be migrated forward to **Source file** terminology. Existing historical migration files should remain immutable; the cleanup should happen through a new forward migration. Worker bindings, environment variables, workspace limit names, and the physical R2 bucket name should also move to non-legacy **Source file** or **Document** terminology.

Generated files, platform API vocabulary, and standards-level MIME strings may retain `image` where that word is required by an external standard or platform contract. For product language, use **Document** synonymously for supported PNG, JPEG, WebP, and PDF source formats unless a MIME type must be named.

## User Stories

1. As a workspace member, I want the product to call my submitted source a **Document**, so that the UI matches what I am actually submitting.
2. As a workspace member, I want PDF and PNG/JPEG/WebP submissions to be described consistently as **Documents**, so that I do not think the product is image-only.
3. As a workspace member, I want upload prompts and validation messages to use **Document** terminology, so that errors are clear and aligned with the product.
4. As a workspace member, I want document previews and fallbacks to avoid legacy “uploaded image” labels, so that the document list uses consistent language.
5. As a workspace member, I want queued **Extraction jobs** to show **Source file** names consistently, so that I can identify submitted Documents without legacy labels.
6. As an API client developer, I want `POST /v1/extract` to require a `document` multipart field, so that the API contract uses the canonical product term.
7. As an API client developer, I want legacy `image` multipart fields to be rejected, so that integrations do not accidentally depend on deprecated vocabulary.
8. As an API client developer, I want generic `file` multipart fields to be rejected, so that integrations use the precise **Document** contract.
9. As an API client developer, I want submission errors to say `document` is required, so that I can correct requests without seeing obsolete alternatives.
10. As an API client developer, I want unsupported source MIME errors to use **Document** or **Source file** language, so that validation feedback matches the API contract.
11. As an API client developer, I want size limit errors to use **Source file** language, so that request constraints are described accurately.
12. As an API client developer, I want **Extraction job** list responses to expose `source_name`, so that response fields match the glossary.
13. As an API client developer, I want **Extraction job** detail responses to expose `source_name`, so that list and detail contracts are consistent.
14. As an API client developer, I want job responses to stop exposing `image_name`, so that new clients cannot depend on legacy aliases.
15. As an API client developer, I want search behaviour to continue finding **Extraction jobs** by **Source file** name, so that terminology cleanup does not remove useful behaviour.
16. As a backend maintainer, I want persisted source metadata columns to use **Source file** terminology, so that schema names match the domain model.
17. As a backend maintainer, I want `image_r2_key` renamed to a **Source file** key, so that storage metadata no longer implies image-only processing.
18. As a backend maintainer, I want `image_mime_type` renamed to a **Source file** MIME type, so that MIME metadata is format-neutral.
19. As a backend maintainer, I want `image_name` renamed to a **Source file** name, so that file identity uses the resolved domain term.
20. As a backend maintainer, I want `max_image_bytes` renamed to a **Source file** byte limit, so that workspace limits describe the real constraint.
21. As a backend maintainer, I want schema cleanup done through a new forward migration, so that deployed migration history is not rewritten.
22. As a backend maintainer, I want historical migration files left unchanged, so that local and remote migration state remain reliable.
23. As a backend maintainer, I want Worker storage bindings to use **Source file** terminology, so that runtime code no longer references legacy image storage.
24. As a backend maintainer, I want environment variable names to use **Source file** terminology, so that deployment configuration matches application language.
25. As a backend maintainer, I want the physical R2 bucket name to avoid legacy image terminology, so that infrastructure naming matches product direction.
26. As a backend maintainer, I want cascade deletion to delete **Source files**, so that cleanup code uses the correct concept.
27. As a backend maintainer, I want **Document** submission code to store a **Source file**, so that the boundary between user action and stored binary is clear.
28. As a backend maintainer, I want **Extraction job lifecycle** persistence to accept **Source file** metadata, so that lifecycle creation stays aligned with the glossary.
29. As a backend maintainer, I want the background workflow named `documentProcessingWorkflow`, so that workflow naming reflects submitted **Documents**.
30. As a backend maintainer, I want AI prompting text to use **Document** terminology, so that model-facing instructions do not reintroduce product drift.
31. As a backend maintainer, I want generated Cloudflare platform type vocabulary left alone where required, so that cleanup does not corrupt platform contracts.
32. As a backend maintainer, I want standards MIME strings like `image/png` preserved, so that supported formats remain technically correct.
33. As a backend maintainer, I want Cloudflare AI option keys that require `images` preserved where they are platform API vocabulary, so that integration behaviour does not break.
34. As a frontend maintainer, I want client form submissions to send the `document` multipart field, so that the frontend follows the canonical API contract.
35. As a frontend maintainer, I want queued local job metadata to use **Source file** response names, so that UI state mirrors the API contract.
36. As a frontend maintainer, I want document previews to avoid application-owned `image` naming, so that UI state uses glossary language.
37. As a frontend maintainer, I want existing document queueing feedback to remain intact, so that terminology cleanup does not regress user feedback.
38. As a frontend maintainer, I want search and filtering to continue using the displayed **Source file** name, so that document navigation remains useful.
39. As a frontend maintainer, I want support for PNG, JPEG, WebP, and PDF to remain intact, so that terminology cleanup does not narrow accepted formats.
40. As a documentation reader, I want README instructions to say **Document** and **Document Extraction**, so that setup and API docs match the product.
41. As a documentation reader, I want Postman collections to be named **Document Extraction**, so that API examples do not advertise obsolete product language.
42. As a documentation reader, I want Postman examples to send `document`, so that copied examples use the correct contract.
43. As an operations maintainer, I want deployment docs to reference the new R2 bucket name, so that infrastructure provisioning follows the resolved terminology.
44. As an operations maintainer, I want environment variables documented with **Source file** names, so that configuration is understandable without translating legacy terms.
45. As an AFK agent, I want application-owned terminology to match `CONTEXT.md`, so that future implementation work does not need to rediscover terminology decisions.
46. As an AFK agent, I want generated and standards vocabulary explicitly excluded, so that cleanup work does not waste time editing platform-owned text.
47. As an AFK agent, I want no legacy compatibility aliases, so that implementation slices are not complicated by dual names.
48. As a product maintainer, I want the product/API label to be **Document Extraction**, so that product naming matches the supported source formats.
49. As a product maintainer, I want legacy “Image Extraction” references removed from authored support material, so that public-facing language is consistent.
50. As a product maintainer, I want the domain docs to preserve these decisions, so that future contributors do not reintroduce legacy image terminology.

## Implementation Decisions

- Product-facing and API-facing naming should use **Document Extraction**, **Document**, and **Source file** terminology.
- The submission API accepts exactly the `document` multipart field for the submitted **Document**.
- The submission API rejects legacy `image` and generic `file` multipart fields; no compatibility aliases should be retained.
- Validation errors should no longer mention `image` or `file` as accepted alternatives.
- Supported MIME types remain unchanged: PNG, JPEG, WebP, and PDF are all supported **Document** source formats.
- Standards-level MIME strings may retain `image` because they are external standards vocabulary.
- Generated files, platform API type names, and required platform option keys may retain `image` where changing them would conflict with external contracts.
- **Extraction job** list and detail responses should expose **Source file** metadata with new names only.
- Legacy response aliases such as `image_name` should not be emitted.
- Search should continue to support matching on the **Source file** name after schema/API renaming.
- D1 schema names for source metadata should be migrated to **Source file** terminology with a new forward migration.
- Historical migration files should remain unchanged even if their contents contain legacy terms.
- Workspace source size limits should be renamed from image byte limits to **Source file** byte limits in application-owned code and configuration.
- Runtime storage bindings should use **Source file** terminology.
- The physical R2 bucket should be renamed to a non-image name for **Source file** storage.
- The background workflow should be named `documentProcessingWorkflow` in application-owned code.
- The **Extraction job lifecycle** module remains the deep module for durable lifecycle transitions and should be updated to consume and persist **Source file** metadata.
- The request validation module is a candidate deep module boundary for the submission contract because it can encapsulate multipart parsing, field-name enforcement, supported MIME validation, byte-limit validation, and options parsing behind a stable interface.
- The workspace policy module and workspace listing interfaces should be updated to return **Source file** byte limits using the new terminology.
- The frontend document queueing path should send `document`, store **Source file** metadata, and render **Document** language.
- Postman collections and authored README/docs should be updated to **Document Extraction** and `document` field examples.
- Built frontend output should not be hand-edited; it should change only through a frontend build if needed.
- Cloudflare-generated type files should not be hand-edited except through the normal generation process after binding changes.

## Testing Decisions

- Good tests should assert externally visible behaviour and stable module interfaces, not private helper names, SQL text, or incidental call ordering.
- Submission validation tests should verify that `document` is accepted and `image` and `file` are rejected.
- Submission validation tests should verify error codes and messages use **Document** or **Source file** terminology.
- Submission validation tests should verify PNG, JPEG, WebP, and PDF remain accepted supported source formats.
- API route tests should verify **Extraction job** creation stores **Source file** metadata and no longer depends on legacy field names.
- **Extraction job** list and detail tests should verify `source_name` is returned and legacy `image_name` is not returned.
- Search tests should verify jobs can still be found by **Source file** name.
- **Extraction job lifecycle** module tests should verify queued job creation persists **Source file** metadata through the lifecycle interface.
- Workflow tests should verify **Source file** storage is read and deleted through the renamed binding while preserving existing completion and cleanup behaviour.
- Cascade deletion tests should verify **Source files** are deleted without depending on legacy storage names.
- Workspace policy/listing tests should verify workspace byte limits use **Source file** terminology in application-owned interfaces.
- Frontend tests should verify document queueing sends the `document` multipart field and renders source metadata using the new response names.
- Existing backend tests around workflow processing, extraction job lifecycle, workspace policy, and jobs API provide prior art for fake D1/R2 behaviour and response-contract assertions.
- Existing frontend component tests around document action feedback and workspace toasts provide prior art for UI assertions without testing implementation details.
- Backend typecheck should be run after implementation.
- Frontend production build should be run after frontend changes.

## Out of Scope

- Changing which source formats are supported.
- Introducing compatibility aliases for legacy `image` or generic `file` request fields.
- Emitting legacy API response aliases during a transition period.
- Rewriting existing migration files.
- Hand-editing generated Cloudflare platform type files or built frontend assets.
- Renaming standards-level MIME values such as `image/png`.
- Changing Cloudflare platform API option keys that require `image` vocabulary.
- Redesigning **Template**, **Template field**, **Template version**, **Template object schema**, or **Extraction result** behaviour.
- Redesigning **Workspace policy** beyond terminology and interface shape required for source byte limits.
- Redesigning the **Extraction job lifecycle** state model.
- Migrating existing R2 object contents beyond the naming/configuration work required to use the new bucket.
- Changing repository folder name or local machine path.
- Creating an ADR unless implementation discovers a hard-to-reverse, surprising trade-off beyond the already resolved terminology decisions.

## Further Notes

- The backend and frontend domain contexts have already been updated with the resolved terminology decisions.
- The product/API label is **Document Extraction**.
- Use **Document** synonymously for supported source formats, including PNG, JPEG, WebP, and PDF, unless a standards-level MIME type must be named.
- Application-owned configuration, storage binding, database, response, workflow, UI, and support-doc names should avoid legacy image terminology.
- The strict no-compatibility decision is intentional: the goal is to remove historic references, not keep dual contracts.
- The main deep modules affected are request validation for the submission contract, **Extraction job lifecycle** for durable source metadata persistence, document processing workflow for orchestration, and workspace policy for workspace source byte limits.
