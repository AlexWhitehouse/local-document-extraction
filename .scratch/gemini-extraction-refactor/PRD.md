# PRD: Gemini Extraction Refactor

Status: needs-triage

## Problem Statement

The backend extraction adapter is harder to reason about than it needs to be. It currently contains code paths for multiple model providers, PDF markdown conversion, provider-specific response parsing, model result normalization, and stale configuration fields even though the running product is configured around a single Gemini-based Extraction model.

This creates ambiguity for backend maintainers and AFK agents. Configuration suggests provider switching is supported, but the runtime hardcodes a Gemini model. PDF handling has two possible source paths even though the active path sends the **Source file** directly to Gemini. Response parsing includes provider shapes that are not part of the intended runtime behaviour. As a result, future changes to **Document** extraction risk preserving unused branches or accidentally changing the durable **Extraction result** shape.

The desired outcome is a smaller, explicit Gemini-only extraction adapter with a clear seam between model invocation and **Extraction result** normalization.

## Solution

Refactor the backend extraction adapter so it intentionally supports Gemini-only **Document** extraction for now. The adapter should read the configured Extraction model from environment configuration with a safe Gemini fallback, send images and PDFs directly to Gemini as inline source content, parse Gemini-compatible response text, and return raw model field results.

Move model result normalization into a separate deep module that owns coercing raw model field results into durable **Extraction result** values. This keeps the model I/O boundary separate from the domain safety boundary that prepares results for persistence by the **Extraction job lifecycle**.

Remove stale provider configuration and inactive provider-specific code paths from application-owned configuration and types. Preserve the existing public result shape, including confidence and evidence fields, and avoid changing extraction options or **Extraction job lifecycle** semantics as part of this refactor.

## User Stories

1. As a backend maintainer, I want the extraction adapter to clearly state that it is Gemini-only, so that I do not waste time auditing inactive provider paths.
2. As a backend maintainer, I want the configured Extraction model to be read from environment configuration, so that model upgrades do not require code changes.
3. As a backend maintainer, I want the Extraction model to fall back to a known Gemini model, so that local and deployed environments have predictable behaviour when configuration is missing.
4. As a backend maintainer, I want unused provider configuration removed, so that configuration does not imply unsupported provider switching.
5. As a backend maintainer, I want PDF **Source files** sent directly to Gemini, so that there is one source-of-truth path for PDF extraction.
6. As a backend maintainer, I want image **Source files** sent directly to Gemini, so that existing image extraction behaviour is preserved.
7. As a backend maintainer, I want markdown conversion removed from the extraction runtime, so that PDF handling does not contain unused fallback complexity.
8. As a backend maintainer, I want response parsing limited to Gemini-compatible shapes and simple normalized text shortcuts, so that parsing behaviour matches the supported runtime.
9. As a backend maintainer, I want OpenAI-style response parsing removed, so that the code does not suggest OpenAI support exists.
10. As a backend maintainer, I want Anthropic-style response parsing removed, so that the code does not suggest Anthropic support exists.
11. As a backend maintainer, I want model invocation separate from result normalization, so that provider I/O and durable result coercion can evolve independently.
12. As a backend maintainer, I want raw model field results returned from the model adapter, so that the workflow can explicitly normalize before persistence.
13. As a backend maintainer, I want a dedicated model result normalizer, so that type coercion rules are testable without invoking Workers AI.
14. As a backend maintainer, I want date normalization preserved, so that date **Extraction results** continue to be persisted consistently.
15. As a backend maintainer, I want number normalization preserved, so that numeric **Extraction results** continue to tolerate formatted model output.
16. As a backend maintainer, I want boolean normalization preserved, so that simple yes/no model answers continue to persist as booleans.
17. As a backend maintainer, I want object and array result validation preserved, so that malformed model output cannot become misleading durable **Extraction results**.
18. As a backend maintainer, I want missing model fields to normalize to not-found results, so that every requested **Template field** has a durable result row.
19. As a backend maintainer, I want invalid model field types to normalize to invalid-type results, so that callers can distinguish extraction misses from type mismatches.
20. As a backend maintainer, I want confidence and evidence preserved in the requested model response shape, so that existing completed **Extraction job** responses do not lose data.
21. As a backend maintainer, I want extraction options left unchanged, so that this refactor does not silently redefine the API contract.
22. As a backend maintainer, I want AI gateway metadata to persist the actual gateway identifier, so that stored processing metadata reflects the execution configuration.
23. As a backend maintainer, I want redundant AI gateway route configuration removed, so that there is only one gateway metadata source.
24. As a backend maintainer, I want the Cloudflare Workflow processing flow unchanged, so that **Extraction job lifecycle** behaviour remains stable.
25. As a backend maintainer, I want tests for model configuration selection, so that environment-driven model changes are protected.
26. As a backend maintainer, I want tests for the Gemini inline input shape, so that images and PDFs continue to be submitted to the model correctly.
27. As a backend maintainer, I want tests for Gemini response parsing, so that response shape simplification does not break successful extraction.
28. As a backend maintainer, I want tests for result normalization to continue passing after module extraction, so that durable **Extraction result** behaviour is unchanged.
29. As an AFK agent, I want a small extraction adapter interface, so that future changes can be made without rediscovering inactive provider assumptions.
30. As an AFK agent, I want a deep result normalizer module, so that most result coercion behaviour can be understood and tested through one stable interface.
31. As a workspace member, I want submitted PDF **Documents** to continue producing **Extraction results**, so that refactoring does not reduce supported source formats.
32. As a workspace member, I want submitted image **Documents** to continue producing **Extraction results**, so that refactoring does not regress existing extraction support.
33. As a workspace member, I want completed **Extraction jobs** to keep the same result fields, so that the frontend does not need to change for this refactor.
34. As a maintainer deploying the Worker, I want environment variables to match real runtime behaviour, so that deploy configuration is easier to audit.
35. As a maintainer reviewing errors, I want transient model failures to remain retryable through the existing workflow path, so that failure semantics stay consistent with the **Extraction job lifecycle**.
36. As a maintainer reviewing the backend glossary, I want no domain documentation churn for provider implementation details, so that domain docs stay focused on product language.

## Implementation Decisions

- The extraction adapter will be intentionally Gemini-only for this iteration.
- The Extraction model will be read from environment configuration with a Gemini fallback.
- The Gemini fallback model is `google/gemini-3-flash`.
- Provider switching is out of scope for this refactor.
- Inactive non-Google request-building branches will be removed.
- PDF **Source files** will be sent directly to Gemini rather than converted to markdown first.
- Markdown conversion code used only by inactive non-Google paths will be removed from the extraction runtime.
- Response parsing will retain Gemini-compatible candidate text parsing and simple direct text shortcuts where Workers AI may normalize text output.
- OpenAI-specific and Anthropic-specific response parsing will be removed.
- Application-owned environment types and configuration will remove unused provider/API-key fields that are not used by the Gemini-only path.
- The application will keep `AI_MODEL` for model selection.
- The application will keep `AI_GATEWAY_ID` for gateway execution.
- Redundant gateway route configuration will be removed.
- Persisted gateway route metadata will use the actual gateway identifier.
- Model invocation will remain separate from model result normalization.
- The extraction adapter will return raw model field results.
- A dedicated model result normalizer module will own conversion from raw model field results to durable **Extraction result** values.
- The model result normalizer will preserve existing coercion rules for strings, numbers, booleans, dates, objects, arrays, and arrays of objects.
- The model result normalizer will preserve current status handling for ok, not-found, invalid-type, unreadable, and error outcomes.
- Existing **Extraction job lifecycle** orchestration will remain unchanged except for imports and gateway metadata wiring.
- Existing completed **Extraction job** API response shape will remain unchanged.
- Confidence and evidence will continue to be requested, normalized, persisted, and returned as they are today.
- Extraction options are not part of this refactor and will not be wired or removed here.
- No database schema change is planned.
- No backend domain documentation update is planned because provider choice is implementation-level rather than domain language.
- No ADR is required at this stage because the decision is easy to reverse and unsurprising for the current product shape.

## Testing Decisions

- Tests should verify external behaviour at module boundaries rather than private helper implementation details.
- Existing model result normalization tests should move with the normalizer module and continue to assert durable **Extraction result** behaviour.
- New extraction adapter tests should mock Workers AI and assert behaviour through the public extraction interface.
- Tests should verify that environment model configuration is used when present.
- Tests should verify that the Gemini fallback model is used when model configuration is absent.
- Tests should verify that PDF **Source files** are submitted through Gemini inline source content.
- Tests should verify that image **Source files** are submitted through Gemini inline source content.
- Tests should verify that Gemini candidate text containing valid JSON is parsed into raw model field results.
- Tests should verify that invalid JSON model content remains retryable through the existing error path.
- Tests should verify that missing model result arrays remain retryable through the existing error path.
- Tests should preserve existing workflow tests by updating imports and metadata expectations only where needed.
- Prior art exists in the backend Vitest tests for model result normalization and Cloudflare Workflow processing behaviour.
- Verification should include the backend test suite.
- Verification should include the backend typecheck.

## Out of Scope

- Supporting OpenAI, Anthropic, or any other non-Gemini provider.
- Designing a provider plugin system.
- Reintroducing PDF markdown conversion as a fallback path.
- Changing the **Document** submission API.
- Changing the completed **Extraction job** response shape.
- Wiring or removing extraction options for confidence and evidence.
- Changing **Extraction job lifecycle** states or retry semantics.
- Changing database schema or migrations.
- Renaming legacy persisted columns that are unrelated to the Gemini-only extraction adapter.
- Updating frontend behaviour.
- Updating backend domain documentation for implementation-level provider details.

## Further Notes

This PRD follows the shared design decisions from the backend refactoring review. The aim is not to redesign extraction as a multi-provider platform. The aim is to remove misleading complexity, make the supported runtime explicit, and extract a deep model result normalizer that can be tested independently of Workers AI and Cloudflare Workflow orchestration.
