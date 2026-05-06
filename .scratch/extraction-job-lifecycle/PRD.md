# PRD: Extraction Job Lifecycle Module

Status: needs-triage

## Problem Statement

The **Extraction job lifecycle** is currently difficult to reason about because durable state transitions, Cloudflare Workflow orchestration, **Source file** access, AI gateway processing, **Extraction result** persistence, failure handling, and retry semantics are spread across multiple backend modules.

This makes it hard for maintainers and AFK agents to understand which **Extraction job** states are product-relevant and which states are implementation metadata. It also makes future changes risky because retryability is currently modelled through durable status values even though transient processing retries should be owned by Cloudflare Workflow retry steps.

The desired durable lifecycle is simpler: an **Extraction job** should move through `queued`, `processing`, `completed`, or `failed`. Cloudflare Workflow instance details and retry mechanics should sit behind the **Seam**, not leak into caller-visible **Extraction job lifecycle** state.

## Solution

Create a deep **Extraction job lifecycle** Module that owns durable lifecycle transitions and persistence decisions for **Extraction jobs**. The Module should concentrate the rules for starting processing, completing with **Extraction results**, failing permanently, and coordinating **Source file** cleanup timing while leaving Cloudflare Workflow mechanics behind an adapter.

Cloudflare Workflow should remain the orchestration adapter. AI gateway prompting should remain a separate adapter. D1 and R2 should be implementation details behind lifecycle operations rather than status rules being duplicated across callers.

The user-visible durable lifecycle should be `queued` to `processing` to either `completed` or `failed`. `retryable_failed` should be removed. `workflow_started` should be removed from the durable **Extraction job lifecycle** and treated as implementation metadata if still needed internally.

## User Stories

1. As a backend maintainer, I want the **Extraction job lifecycle** rules in one Module, so that I can understand durable processing behaviour without tracing queue, workflow, and route handlers.
2. As a backend maintainer, I want **Extraction job** durable states limited to `queued`, `processing`, `completed`, and `failed`, so that status values represent product-relevant lifecycle state.
3. As a backend maintainer, I want Cloudflare Workflow retry steps to own transient retryability, so that retry behaviour is not duplicated in durable status values.
4. As a backend maintainer, I want `retryable_failed` removed from the durable lifecycle, so that failed jobs do not imply separate retry semantics in product state.
5. As a backend maintainer, I want `workflow_started` removed from the durable lifecycle, so that Cloudflare Workflow instance details do not leak through the **Interface**.
6. As a backend maintainer, I want Cloudflare Workflow instance identifiers kept as implementation metadata when needed, so that operations can still be traced without creating caller-visible lifecycle states.
7. As a backend maintainer, I want **Extraction job** creation to produce a `queued` state, so that submitted **Documents** have a clear durable starting point.
8. As a backend maintainer, I want processing start to produce a `processing` state, so that the durable lifecycle reflects active extraction work.
9. As a backend maintainer, I want completion to persist **Extraction results** and mark the **Extraction job** `completed`, so that callers never see a completed job without durable results.
10. As a backend maintainer, I want failure to mark the **Extraction job** `failed` with durable error information, so that callers can understand terminal processing failures.
11. As a backend maintainer, I want **Template version** selection to remain fixed at submission time, so that **Extraction results** are interpreted against the correct **Template fields**.
12. As a backend maintainer, I want **Source file** access to happen through the lifecycle flow, so that processing consistently reads the submitted **Document** content.
13. As a backend maintainer, I want **Source file** cleanup timing to remain part of the Cloudflare Workflow processing flow, so that cleanup still happens after successful processing.
14. As a backend maintainer, I want cleanup failures not to corrupt completed **Extraction results**, so that successful extraction remains durable even if storage cleanup needs retry or follow-up.
15. As a backend maintainer, I want AI gateway retryable errors handled by Cloudflare Workflow step retries, so that transient model or gateway failures do not create intermediate durable statuses.
16. As a backend maintainer, I want permanent processing errors to become `failed`, so that terminal failures are represented simply.
17. As a backend maintainer, I want missing **Source file** errors to become `failed`, so that unavailable submitted content has clear durable failure semantics.
18. As a backend maintainer, I want missing **Extraction job** records to stop processing safely, so that stale workflow attempts do not create inconsistent data.
19. As a backend maintainer, I want duplicate workflow attempts to be safely ignored or rejected by lifecycle transitions, so that at-most-one durable completion wins.
20. As a backend maintainer, I want stale attempts to be prevented from overwriting newer lifecycle state, so that Cloudflare retry behaviour does not corrupt durable state.
21. As a backend maintainer, I want **Extraction result** writes and completion marking treated as one lifecycle operation, so that result persistence and status cannot drift.
22. As a backend maintainer, I want lifecycle operations to be testable without invoking the full Cloudflare Workflow runtime, so that tests are fast and focused.
23. As a backend maintainer, I want Cloudflare Workflow to call lifecycle operations by intent, so that workflow code reads as orchestration rather than status management.
24. As a backend maintainer, I want route handlers to stop reimplementing lifecycle status rules, so that caller code stays thin.
25. As a backend maintainer, I want manual retry routes removed or reworked, so that retryability does not contradict Cloudflare Workflow-owned retry steps.
26. As a backend maintainer, I want listing and detail responses to expose only durable lifecycle states, so that callers do not depend on implementation metadata.
27. As a frontend maintainer, I want **Extraction job** status values to be simpler, so that the UI does not need to distinguish transient workflow internals.
28. As a workspace member, I want submitted **Documents** to show a clear queued and processing progression, so that I understand extraction progress.
29. As a workspace member, I want completed **Extraction jobs** to reliably include **Extraction results**, so that I can trust completed output.
30. As a workspace member, I want failed **Extraction jobs** to show an understandable error, so that I know the Document did not complete.
31. As an AFK agent, I want the **Extraction job lifecycle** concentrated behind a stable **Interface**, so that future extraction changes do not require rediscovering scattered invariants.
32. As an AFK agent, I want implementation metadata separated from durable lifecycle state, so that future routing or workflow changes do not accidentally change product semantics.
33. As a backend maintainer, I want lifecycle errors mapped to existing HTTP error shapes where routes still expose them, so that callers receive consistent failures.
34. As a backend maintainer, I want lifecycle refactoring to preserve existing **Document** submission and **Extraction result** behaviour, so that architecture improves without unnecessary product churn.
35. As a backend maintainer, I want the domain glossary to describe **Extraction job lifecycle**, so that future architecture reviews use consistent language.

## Implementation Decisions

- Build or modify a deep **Extraction job lifecycle** Module that owns durable lifecycle decisions and persistence for **Extraction jobs**.
- The **Extraction job lifecycle** Module should have a small intent-shaped **Interface** for lifecycle operations rather than exposing raw status mutation helpers.
- Durable **Extraction job lifecycle** states are `queued`, `processing`, `completed`, and `failed`.
- `retryable_failed` should be removed from durable lifecycle state.
- `workflow_started` should be removed from durable lifecycle state.
- Cloudflare Workflow retry steps own retryability for transient processing failures.
- Cloudflare Workflow remains the orchestration adapter and should call lifecycle operations rather than embedding durable status rules.
- AI gateway prompting and result normalization remain separate from durable lifecycle decisions.
- D1 writes for lifecycle transitions and **Extraction result** persistence should be concentrated behind the lifecycle Module.
- R2 access for the **Source file** may remain behind a storage adapter, but cleanup timing remains coordinated by the Cloudflare Workflow processing flow.
- Once Cloudflare Workflow receives an AI gateway response, **Extraction results** should be persisted and the **Extraction job** should be marked `completed`.
- Completion should not be represented before **Extraction results** are durable.
- Permanent processing failures should mark the **Extraction job** `failed` with durable error information.
- Cloudflare Workflow implementation metadata may be stored for observability or idempotency, but it should not appear as durable lifecycle state.
- Manual retry behaviour should be removed or redesigned so it does not conflict with Cloudflare Workflow-owned retryability.
- **Template version** selection at submission time should remain unchanged.
- Existing public response shapes should remain compatible except for removal of obsolete lifecycle status values.
- Existing domain documentation has been updated with **Extraction job lifecycle** language and durable lifecycle rules.

## Testing Decisions

- Good tests should exercise external behaviour through the **Extraction job lifecycle** **Interface**, not private helper functions, SQL strings, Cloudflare Workflow step names, or internal call ordering.
- The **Extraction job lifecycle** Module should be tested directly because it is the deep Module that owns durable transitions.
- Tests should verify successful submission creates a `queued` **Extraction job** with the selected **Template version**.
- Tests should verify processing start moves an eligible **Extraction job** to `processing`.
- Tests should verify stale or duplicate processing attempts cannot overwrite terminal lifecycle state.
- Tests should verify AI gateway results are persisted before or with completion, so completed **Extraction jobs** have durable **Extraction results**.
- Tests should verify permanent processing failures mark the **Extraction job** `failed` with error information.
- Tests should verify transient retry behaviour is not represented by `retryable_failed` status.
- Tests should verify `workflow_started` is not exposed as a durable lifecycle state.
- Tests should verify **Source file** cleanup is attempted after successful processing without invalidating completed **Extraction results**.
- Tests should verify missing **Source file** behaviour becomes a clear failed lifecycle outcome.
- Tests should verify list and detail responses expose only supported durable lifecycle states.
- Tests should verify removed or redesigned manual retry behaviour does not allow status-based retryability to re-enter the lifecycle.
- Prior art exists in backend workflow tests that fake D1/R2 behaviour and assert durable lifecycle outcomes.
- Prior art exists in AI gateway tests for result normalization; lifecycle tests should avoid duplicating AI gateway normalization coverage.
- Backend typecheck should be used as the focused verification command after implementation.

## Out of Scope

- Redesigning AI gateway prompt construction or model result normalization.
- Redesigning **Template object schema** handling.
- Redesigning **Workspace policy** or **Workspace context**.
- Redesigning frontend presentation beyond adapting to simplified durable lifecycle statuses.
- Introducing a generic persistence layer for all backend data access.
- Replacing Cloudflare Workflow with another orchestration mechanism.
- Changing the product meaning of **Document**, **Source file**, **Template**, **Template field**, **Template version**, or **Extraction result**.
- Adding user-facing manual retry semantics unless a later triage decision explicitly reintroduces them with a new product rule.
- Adding outbound notifications, audit logs, or background cleanup dashboards.
- Renaming legacy storage bindings or database columns unless required by an implementation issue.

## Further Notes

- This PRD follows the architecture discussion that selected the **Extraction job lifecycle** deepening opportunity.
- The agreed direction is to place the **Seam** around lifecycle decisions plus persistence, with Cloudflare Workflow as the caller and D1/R2 as adapters behind the Module.
- The deletion test supports this extraction: removing the lifecycle Module would spread status rules, attempt rules, completion writes, failure writes, and cleanup meaning back across queue, workflow, and route callers.
- The work is primarily architectural deepening: the goal is improved **Locality**, **Leverage**, testability, and AI-navigability while preserving existing extraction behaviour where it still matches the clarified domain rules.
