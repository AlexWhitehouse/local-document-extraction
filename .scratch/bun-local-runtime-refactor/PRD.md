# PRD: Bun Local Runtime Refactor

Status: ready-for-agent

## Problem Statement

This copy of the Document Extraction application is currently shaped around Cloudflare Worker runtime services: Wrangler, D1, R2, Queues, Workflows, Durable Objects, Workers Analytics Engine, Worker asset serving, and Cloudflare Email. The user needs this copy to run locally on Bun instead of Wrangler and Cloudflare, while keeping the actual product experience: authentication, **Workspace** access, **Workspace invitations**, **Application admin** capability, **Workspace API keys**, **Templates**, **Documents**, **Extraction jobs**, live updates, and LiteLLM-backed extraction.

The previous commercial billing system is no longer needed. From the user's perspective, billing code, Stripe flows, Credits, plan entitlements, billing-ledger rules, and billing UI add setup burden and implementation complexity to a local product that should simply let authenticated Workspace users extract Documents. At the same time, local-only must not mean single-user or no-auth: the access model still matters.

The desired outcome is a single local Bun server that serves the API, WebSockets, and built frontend assets; persists local state under one resettable local state directory; processes Extraction jobs without Cloudflare Queue or Workflow; preserves the useful **Workspace control data** and **Workspace product data** authority split; and removes all active billing behavior.

## Solution

Refactor the app into a local-only Bun runtime. Bun becomes the package manager, runtime entrypoint, and server process. The normal local command starts one Bun server that handles `/api/auth/*`, `/v1/*`, Workspace live update WebSockets, and SPA asset fallback from the built frontend. Vite remains available only for frontend development convenience.

Keep the existing Fetch-style Request/Response routing shape and use `Bun.serve` directly rather than introducing a web framework. Replace Cloudflare runtime bindings with local modules and adapters: local SQLite via `bun:sqlite`, local filesystem **Source file** storage, a **Local extraction runner**, a **Local live update hub**, a **Local mail sink**, and daily JSONL **Workspace product analytics** logs.

Preserve authentication and access concepts. Better Auth remains the auth layer. Email/password is the reliable local sign-in path. Google OAuth remains available only when local OAuth configuration is present. **Account email verification** and **Account password reset** keep their product flows, but transactional emails are captured by the **Local mail sink** instead of sent through Cloudflare Email by default.

Preserve the authority split from the existing architecture. Local **Workspace control data** lives in one SQLite database. Local **Workspace product data** lives in one SQLite database per Workspace. The local runtime does not create any billing ledger database. Use fresh local migrations for the desired local schema instead of replaying historical Cloudflare/D1 migrations.

Remove active billing behavior everywhere. Retire billing routes, Stripe webhook handling, scheduled billing reconciliation, Credit reservation, plan entitlement enforcement, billing UI, billing operational status, and payment setup. Keep only **Product safety limits** and Template shape constraints: maximum **Source file** size, supported MIME types, PDF **Source file page count** validation, table-shaped **Template field** rules, and **Template object column limit**.

Keep the configured LiteLLM endpoint as the **Model gateway**. The **Local extraction runner** replaces Cloudflare Queue and Workflow orchestration, but it still sends the original **Source file** to the OpenAI-compatible LiteLLM endpoint and records the configured model and route label on completed **Extraction jobs**.

## User Stories

1. As a local operator, I want to run the whole app with Bun, so that I do not need Wrangler or Cloudflare services for this copy.
2. As a local operator, I want one local URL for normal use, so that the API, WebSockets, and frontend work together without coordinating multiple production-like servers.
3. As a local operator, I want local state grouped under one resettable directory, so that I can back up or wipe the app state predictably.
4. As a local operator, I want `bun install` to be the setup path, so that package management matches the runtime.
5. As a local operator, I want package scripts to advertise Bun commands, so that I do not accidentally use npm or Wrangler workflows.
6. As a local operator, I want Cloudflare deploy commands removed from the active command surface, so that this copy is clearly local-only.
7. As a local operator, I want a fresh local database schema, so that I do not replay old D1 migrations that create legacy or billing tables.
8. As a local operator, I want billing removed, so that local setup does not require Stripe keys, products, prices, webhooks, or payment state.
9. As a local operator, I want LiteLLM to remain the **Model gateway**, so that the project continues using the working extraction endpoint.
10. As a local operator, I want analytics in daily JSONL logs, so that I can inspect local operational events without setting up an analytics service.
11. As a local operator, I want verification and reset emails captured locally, so that I can use auth flows without outbound email infrastructure.
12. As a local operator, I want local mail links easy to find, so that account setup and password reset flows remain usable.
13. As a local operator, I want **Source files** stored on disk locally, so that uploads no longer depend on R2.
14. As a local operator, I want deleting local state to reset databases, Source files, mail logs, and analytics logs, so that recovery and testing are simple.
15. As a new user, I want to create an email/password account locally, so that I can use the app without OAuth setup.
16. As a new user, I want to verify my email through a local captured link, so that the existing **Account email verification** rule still works.
17. As a returning user, I want password reset to work through a local captured link, so that I can recover access without real email delivery.
18. As a user with Google OAuth configured, I want social sign-in to keep working locally, so that feature parity is available when credentials exist.
19. As a user without Google OAuth configured, I want email/password to remain fully usable, so that OAuth setup is not a blocker.
20. As a Workspace owner, I want to create and manage Workspaces locally, so that the multi-Workspace product model is preserved.
21. As a Workspace owner, I want **Workspace memberships** to remain enforced, so that access is not flattened by the local runtime.
22. As a Workspace owner, I want **Workspace invitations** to remain in-app, so that invited users can join through the existing invitation lifecycle.
23. As a Workspace owner, I want invitations not to send outbound email, so that local mail only covers auth flows.
24. As a Workspace owner, I want to generate and rotate **Workspace API keys**, so that external local clients can use product routes.
25. As a Workspace owner, I want **Workspace API keys** to work without paid entitlement, so that local integrations are not blocked by removed billing state.
26. As a Workspace owner, I want **Workspace API keys** to remain one-time visible and hash-at-rest, so that credential handling stays safe.
27. As a Workspace admin, I want to manage Workspace users and invitations locally, so that Workspace access workflows remain intact.
28. As a Workspace member, I want to submit Documents without buying Credits, so that extraction is not gated by retired commercial rules.
29. As a Workspace member, I want oversized or unsupported Documents rejected, so that local processing remains protected by **Product safety limits**.
30. As a Workspace member, I want PDF **Source file page count** validation to remain, so that invalid PDFs fail before processing side effects.
31. As a Workspace member, I want my submitted Document to create a queued **Extraction job**, so that I can see that the upload was accepted.
32. As a Workspace member, I want **Extraction jobs** to progress through `queued`, `processing`, `completed`, or `failed`, so that job state remains understandable.
33. As a Workspace member, I want completed **Extraction jobs** to include durable **Extraction results**, so that I can trust completed output.
34. As a Workspace member, I want failed **Extraction jobs** to show durable error information, so that I understand terminal failures.
35. As a Workspace member, I want live updates to keep job status current, so that I do not have to refresh the page during processing.
36. As a Workspace member, I want live updates to reconnect and revalidate over HTTP, so that a server restart or dropped socket does not leave stale UI.
37. As a Workspace member, I want completed job details fetched over HTTP, so that extracted answers and evidence do not travel through live update payloads.
38. As a Workspace member, I want Source file binaries deleted after successful cleanup, so that local disk does not retain Documents unnecessarily.
39. As a Workspace member, I want Workspace deletion to erase that Workspace's product data and Source files, so that deletion remains a hard-erasure action.
40. As an Application admin, I want the **Application admin** page to remain available, so that account management survives the runtime move.
41. As an Application admin, I want user listing, role changes, bans, unbans, and impersonation to continue locally, so that existing admin capability remains useful.
42. As an Application admin, I want admin capability to remain application-wide, so that it is not confused with Workspace owner/admin membership.
43. As an external API client, I want bearer-token **Workspace API key** access to product routes, so that scripts can submit Documents and read jobs locally.
44. As an external API client, I want API keys rejected from session-only routes, so that API and browser session responsibilities remain separate.
45. As an external API client, I want API keys not to open Workspace live update sockets, so that realtime browser behavior remains session-only for now.
46. As a frontend maintainer, I want billing UI removed, so that users do not see plans, Credits, invoices, or payment controls.
47. As a frontend maintainer, I want upload blocking to reflect **Product safety limits** only, so that frontend behavior matches the no-billing backend.
48. As a frontend maintainer, I want the SPA to keep using the accepted **Workspace context**, so that Workspace switching behavior remains familiar.
49. As a frontend maintainer, I want the existing live update route shape preserved, so that frontend changes can focus on local hub compatibility.
50. As a frontend maintainer, I want Vite available for hot reload, so that frontend development remains ergonomic.
51. As a backend maintainer, I want the existing Fetch-style handler preserved, so that routing churn is not mixed into the runtime refactor.
52. As a backend maintainer, I want local control persistence behind a deep module, so that auth and Workspace policy code do not depend on Cloudflare D1.
53. As a backend maintainer, I want local product persistence behind a deep module, so that Template and Extraction job behavior is testable without Cloudflare Durable Objects.
54. As a backend maintainer, I want one SQLite database per Workspace for **Workspace product data**, so that Workspace deletion and isolation stay simple.
55. As a backend maintainer, I want one SQLite database for **Workspace control data**, so that users, sessions, Workspaces, memberships, invitations, and API key hashes stay queryable together.
56. As a backend maintainer, I want no billing ledger database, so that removed commercial concerns do not re-enter the local schema.
57. As a backend maintainer, I want fresh local migrations, so that schema state describes the desired local product rather than historical Cloudflare evolution.
58. As a backend maintainer, I want local migrations to be idempotent, so that repeated startup or setup commands are safe.
59. As a backend maintainer, I want `bun:sqlite`, so that local storage uses Bun's built-in SQLite support without native npm dependency friction.
60. As a backend maintainer, I want a local filesystem Source file store, so that R2-specific behavior is encapsulated and removable.
61. As a backend maintainer, I want a **Local extraction runner**, so that Cloudflare Queue and Workflow are replaced by recoverable local processing.
62. As a backend maintainer, I want the runner to scan for `queued` jobs on startup, so that accepted jobs are not stranded after a crash.
63. As a backend maintainer, I want the runner to recover stale `processing` jobs, so that server interruption does not permanently block work.
64. As a backend maintainer, I want bounded retry attempts to be processor metadata, so that durable **Extraction job lifecycle** states stay simple.
65. As a backend maintainer, I want model invocation separate from lifecycle persistence, so that LiteLLM failures do not corrupt product data.
66. As a backend maintainer, I want **Extraction results** persisted before completion is visible, so that completed jobs are coherent.
67. As a backend maintainer, I want analytics writes best-effort, so that failed log writes never fail user actions.
68. As a backend maintainer, I want daily JSONL analytics privacy boundaries enforced, so that logs do not contain customer content.
69. As a backend maintainer, I want a **Local mail sink** module, so that Better Auth email callbacks do not depend on provider-specific delivery.
70. As a backend maintainer, I want local mail sink writes best-effort but visible, so that auth links are recoverable during development.
71. As a backend maintainer, I want billing routes and services removed rather than stubbed as active behavior, so that dead commercial paths cannot influence product actions.
72. As a backend maintainer, I want old Cloudflare migration files treated as historical material, so that they do not define the local schema.
73. As a backend maintainer, I want platform-configuration tests removed or replaced, so that the suite no longer asserts Wrangler-specific details.
74. As a backend maintainer, I want behavioral tests preserved, so that auth, Workspace policy, product data, extraction, and frontend workflows remain protected.
75. As an AFK agent, I want the local runtime architecture captured in one PRD and ADR, so that implementation can proceed without re-interviewing the user.
76. As an AFK agent, I want deep modules with stable interfaces, so that the refactor can be split into independent implementation issues.
77. As an AFK agent, I want billing explicitly out of scope, so that old billing tests and UI do not accidentally drive the new implementation.
78. As an AFK agent, I want **Workspace control data** and **Workspace product data** terms used consistently, so that storage changes match the domain docs.
79. As an AFK agent, I want the local state directory to be the reset and backup boundary, so that setup and recovery instructions are easy to write.
80. As an AFK agent, I want the first implementation to favor behavior-preserving adapters where useful, so that the runtime move does not become an unnecessary product rewrite.

## Implementation Decisions

- Build a local Bun runtime module that owns `Bun.serve`, request dispatch, WebSocket upgrades, static asset serving, SPA fallback, startup, shutdown, and local service initialization.
- Keep the backend's Fetch-style Request/Response routing model. Do not add Express, Hono, or another web framework as part of this refactor.
- Serve API routes, Better Auth routes, Workspace live update WebSockets, and built frontend assets from one Bun server for normal local use.
- Keep Vite as a frontend development tool only. Vite may proxy to the Bun API during UI development.
- Use Bun as package manager and runtime entrypoint. Retire npm lockfiles after dependency migration and produce a Bun lockfile.
- Replace active package scripts and documentation with local Bun commands. Remove active Cloudflare deploy and Wrangler preflight commands from the command surface.
- Keep **Authentication**, **Workspace membership**, **Workspace invitations**, **Application admin** capability, and **Workspace API keys** in scope.
- Keep Better Auth as the auth product layer, but configure it against local persistence and local runtime services.
- Make email/password the reliable local sign-in path. Keep Google OAuth only when local OAuth configuration is present.
- Build a **Local mail sink** deep module that accepts transactional email messages, captures verification/reset links, prints useful server-log output, and writes daily JSONL mail records under local state.
- Keep **Account email verification** and **Account password reset** flows. Do not bypass verification or reset just because email is local.
- Keep **Workspace invitations** in-app only. Do not generate local mail sink records for invitations.
- Build a local configuration module that loads local environment variables, defaults, local state paths, LiteLLM settings, auth secrets, OAuth settings, and **Product safety limits**.
- Group all local runtime state under the repo-root local state directory. This state includes control SQLite, per-Workspace product SQLite databases, Source files, mail logs, and analytics logs.
- Use `bun:sqlite` for local SQLite access.
- Build a local control database module for **Workspace control data**: account/session records, Workspace records, Workspace memberships, Workspace invitations, and Workspace API key hashes.
- The local control database module may expose compatibility behavior needed by Better Auth and existing policy code during migration, but the durable boundary is **Workspace control data**, not Cloudflare D1.
- Build fresh local control migrations for the current desired no-billing schema.
- Build a local Workspace product store deep module backed by one SQLite database per Workspace.
- Preserve the current Workspace product store domain interface where useful: Template operations, Template versioning, job creation, lifecycle claiming, completion, failure, result reads, cleanup metadata, deletion cleanup, and plan-independent Template shape validation.
- Build fresh local product migrations based on the current desired **Workspace product data** schema, not historical D1 product tables.
- Do not create or migrate a billing ledger database.
- Remove active billing control data, Stripe identifiers, processed Stripe event records, Credits, billing reconciliation state, and entitlement state from the local schema.
- Remove or disable billing API routes, Stripe webhook routes, scheduled billing jobs, billing ledger operations, Credit reservation, and billing mutation code.
- Remove frontend billing UI, plan comparison, Credit pack purchase UI, invoice UI, billing operational status, and entitlement-based upload blocking.
- Preserve **Product safety limits**: maximum **Source file** size, supported MIME types, PDF **Source file page count** validation, and Template shape constraints.
- Remove commercial quota enforcement: Credits, monthly page limits, plan member limits, paid API entitlement, and plan overage blocking.
- Keep **Workspace API key** generation owner/admin-only, one-time visible, hash-at-rest, and bearer-token based.
- Remove paid entitlement requirements from **Workspace API key** authentication and generation.
- Keep **Workspace API keys** limited to product routes. They must not authenticate profile, membership, invitation, Workspace deletion, API key generation, auth, or admin routes.
- Build a local Source file store module that writes, reads, deletes, and sweeps **Source file** binaries on disk under local state.
- Store **Source file** metadata in **Workspace product data** and binary contents in local Source file storage.
- A completed **Extraction job** should not retain its **Source file** binary after cleanup succeeds.
- Build a **Local extraction runner** deep module that claims persisted work, invokes the **Model gateway**, persists **Extraction results**, marks jobs completed or failed, retries transient failures within bounds, and performs Source file cleanup.
- The **Local extraction runner** must scan authoritative **Workspace product data** on startup for `queued` and stale `processing` **Extraction jobs**.
- Server restart must not permanently strand an accepted **Extraction job** that has not reached `completed` or `failed`.
- Keep durable **Extraction job lifecycle** states limited to `queued`, `processing`, `completed`, and `failed`.
- Treat retry attempts and local runner instance details as processor metadata, not user-visible lifecycle states.
- Keep the configured LiteLLM endpoint as the **Model gateway**. Do not replace the model layer with a fully local model in this PRD.
- Keep the current OpenAI-compatible LiteLLM request contract and local `.env` style secrets for `MODEL_GATEWAY_URL`, `LITELLM_KEY`, model name, route label, and timeout.
- Build a **Local live update hub** deep module that manages WebSocket subscriptions keyed by Workspace ID.
- Keep the existing Workspace live update route contract for the SPA.
- Validate session-based Workspace access before opening a live update socket.
- Keep Workspace live updates session-only. **Workspace API keys** do not open live update sockets in this PRD.
- Live update events are not durable history. Clients revalidate authoritative **Workspace product data** and accepted **Workspace context** over HTTP after reconnect.
- Live update payloads may include job summary fields but must not include extracted answers, evidence text, Source file binary contents, account emails, API keys, or Document contents.
- Build a local analytics module that writes best-effort daily JSONL files under local state by default.
- Analytics events may include stable product IDs and operational metadata, but must not include extracted answers, evidence text, Source file names, account emails, API keys, Source file binary contents, or Document contents.
- Analytics write failures should log a warning and never fail the product action that produced the event.
- Keep frontend **Workspace selection view**, **Stored workspace preference**, **Completed document cache**, **Action toasts**, and live update behavior, adapting only where billing or Cloudflare assumptions leak through.
- Update frontend runtime configuration so normal use targets the Bun server and frontend development can still proxy to the Bun API.
- Remove Worker asset-serving assumptions from documentation and replace them with Bun server asset serving.
- Update README and local setup documentation around Bun install, local environment, local state reset, local migrations, local mail sink usage, LiteLLM configuration, and local analytics logs.
- Existing Cloudflare-specific implementation files, generated Worker types, Wrangler config, and production preflight code may remain temporarily during migration only when needed to keep incremental work understandable, but the final active app should not depend on them.

## Testing Decisions

- Good tests should verify external behavior and domain contracts, not private helper functions, SQL strings, exact local file layout internals, implementation call order, or framework scaffolding.
- Preserve and adapt behavioral tests for authentication, **Account email verification**, **Account password reset**, Workspace policy, Workspace invitations, Application admin, **Workspace API keys**, Template behavior, Document submission, Extraction job lifecycle, model result normalization, live updates, and frontend workflows.
- Delete or replace tests whose only purpose is proving Wrangler configuration, Cloudflare bindings, Durable Object migrations, Queue/Workflow wiring, Workers Analytics Engine binding configuration, Cloudflare Email binding configuration, production preflight, billing ledger behavior, Stripe billing, or billing UI.
- Test the local Bun runtime through Request/Response behavior: health, auth delegation, product API routing, SPA fallback, static asset response, and WebSocket upgrade routing.
- Test the local control database module through auth and Workspace policy behavior rather than through raw SQL assertions.
- Test the local Workspace product store as a deep module. Cover Template create/list/detail/update/delete, Template versioning, Template object schema constraints, job creation, job listing/detail, lifecycle transitions, Extraction result persistence, stale attempt handling, deletion cleanup, and Source file metadata.
- Test local migrations by applying them to empty databases and by reapplying them idempotently.
- Test that local control migrations do not create billing tables or require Stripe/billing configuration.
- Test that local product migrations create only current **Workspace product data** tables and do not replay legacy global product table history.
- Test Document submission behavior through the public API: validation, Template selection, Source file storage, queued Extraction job creation, local runner scheduling, and queued response.
- Test Document submission failure cleanup: invalid Source file, uncountable PDF, product store failure after Source file write, and local runner scheduling failure.
- Test **Product safety limits** and ensure removed billing limits do not block submissions.
- Test that Workspaces with many members or many Templates are not blocked by plan/member/page limits after billing removal.
- Test **Workspace API key** behavior: owner/admin generation, one-time display, hash-at-rest behavior, rotation invalidation, product route authentication, and rejection from session-only routes.
- Test that **Workspace API keys** do not require paid entitlement.
- Test the **Local mail sink** directly. Cover verification email capture, password reset email capture, link extraction, daily JSONL write shape, and non-blocking write failure behavior.
- Test Better Auth email/password flows with the local mail sink: signup, verification, sign-in block before verification, sign-in after verification, password reset request, and password reset completion.
- Test Google OAuth configuration behavior only at the config/visibility boundary unless credentials are available; email/password must remain usable without OAuth credentials.
- Test **Workspace invitations** remain in-app and do not generate local mail sink records.
- Test the **Local extraction runner** as a deep module. Cover startup recovery of `queued` jobs, stale `processing` recovery, successful completion, transient retry, terminal failure, missing Source file failure, and cleanup after completion.
- Test that server restart simulation does not permanently strand accepted **Extraction jobs**.
- Test that completed **Extraction jobs** persist **Extraction results** before visible completion.
- Test that local Source file cleanup failures do not corrupt completed **Extraction results**.
- Test the local Source file store for write/read/delete/sweep behavior through its public interface, not by coupling tests to every path segment.
- Test the **Local live update hub** through WebSocket-visible behavior: subscribe, broadcast by Workspace ID, unsubscribe on close, no cross-Workspace leakage, session-only access, reconnect revalidation behavior, and exclusion of sensitive payload fields.
- Test frontend live update integration: one connection per accepted Workspace context, replacement on Workspace switch, closure on sign-out, job list updates from lifecycle messages, and HTTP revalidation after reconnect.
- Test frontend billing removal: no billing section, no plan comparison, no Credit controls, no billing operational status, and no entitlement-based upload blocking.
- Test frontend **Product safety limit** messaging where applicable.
- Test local analytics JSONL logging directly. Cover daily file grouping, event serialization, privacy exclusions, and non-blocking failure behavior.
- Keep model gateway tests focused on request construction, timeout/error handling, retry classification, and result normalization. Do not require the real LiteLLM endpoint for normal automated tests.
- Use focused backend typecheck and behavioral test commands after backend changes.
- Use frontend build and targeted frontend tests after frontend changes.
- Use end-to-end local smoke verification once the Bun server can run: create account, capture verification link, sign in, create Workspace, create Template, upload Document, run extraction through LiteLLM or a configured mock, observe live update, open results, generate API key, submit through API key.
- Existing prior art includes Workspace policy tests for access behavior, Workspace product store tests for SQLite-like product behavior, document processing workflow tests for extraction lifecycle behavior, Better Auth tests for auth integration, and frontend App tests for workspace, document, and toast flows.

## Out of Scope

- Reintroducing billing, Stripe payment flows, Credits, Credit packs, subscriptions, plan entitlements, no-billing mode, billing reconciliation, Enterprise invoices, or the Workspace billing ledger.
- Preserving Cloudflare production deployment compatibility.
- Supporting Wrangler as an active local runtime.
- Keeping npm as package manager after the Bun migration.
- Adding a web framework such as Express or Hono.
- Replacing LiteLLM with a fully local model.
- Requiring the real LiteLLM endpoint in automated tests.
- Sending real outbound email by default.
- Adding SMTP support unless a later decision explicitly requires it.
- Sending invitation emails.
- Collapsing authentication, Workspaces, memberships, invitations, Application admin, or **Workspace API keys** into a single-user local mode.
- Allowing **Workspace API keys** to open live update WebSockets.
- Building offline durable replay for live updates.
- Building a production analytics pipeline, BI dashboard, warehouse export, or analytics query UI.
- Treating daily JSONL analytics logs as authoritative **Workspace product data**.
- Automatically migrating existing remote Cloudflare data or Wrangler persisted local state into the new local schema.
- Replaying old D1 migrations as the local schema source of truth.
- Keeping old platform-configuration tests that only assert Cloudflare config.
- Changing the core product language: **Workspace**, **Workspace control data**, **Workspace product data**, **Document**, **Source file**, **Template**, **Template field**, **Template version**, **Extraction job**, **Extraction job lifecycle**, **Extraction result**, **Model gateway**, or **Product safety limit**.
- Redesigning the visual frontend beyond removing billing surfaces and adapting local runtime integration.
- Adding browser upload byte progress.
- Adding multi-process distributed job coordination. The first local runtime assumes one Bun backend process.

## Further Notes

- This PRD follows the accepted local-only runtime ADR created during the design grilling session.
- The key distinction is local runtime without product simplification: Cloudflare and billing go away, but authentication and Workspace access stay.
- The useful part of the previous Durable Object design survives as a local storage boundary: **Workspace control data** remains separate from **Workspace product data**.
- The local runtime should bias toward deep modules: local runtime shell, local control database, Workspace product store, Source file store, Local extraction runner, Local live update hub, Local mail sink, and local analytics logger.
- Billing removal is broad and should be implemented deliberately. Search for both backend and frontend billing assumptions, not just Stripe imports.
- The old billing PRDs and issues in the local tracker are historical context only for this copy. They should not drive the new local runtime implementation.
- The final operator story should be boring in the best way: install with Bun, configure local `.env`, run local migrations, start one Bun server, use the app, inspect `.local/` when needed.
