# Define the implementation sequence and handoff slices

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 08

## Question

How should the resolved Workspace-owned Model gateway specification be divided and ordered into bounded implementation slices for a later agent handoff?

Define slice boundaries, dependencies, and completion evidence using the resolved verification contract. Account for encrypted Workspace storage, session-only configuration management and connection testing, Document admission and attempt-time configuration, the approved Workspace-page experience, legacy-setting retirement, and documentation. Decide the integration/release boundary that prevents a partially shipped combination from retaining global authority or removing setup before the Workspace replacement is usable.

Use [Set the implementation-ready verification contract](08-set-implementation-verification-contract.md) as the acceptance boundary for the handoff. Keep the user's manual real-gateway confirmation distinct from agent-verified completion evidence; do not reintroduce the declined gateway/concurrency integration requirement.

Keep detailed product decisions in their resolved tickets and give each proposed implementation slice clear context pointers and acceptance responsibilities. Check that the handoff uses settled domain language; propose additional glossary terms only if a real ambiguity remains. This ticket plans the implementation handoff only: it does not implement changes, promote prototype code, deploy, or add rollback support.

## Comments

### Initial integration-boundary inspection

The local runtime already assembles the API, extraction runner, and built SPA in one Bun server (`backend/src/server.ts`; ADR 0005). Its current app-wide Model settings object is passed to both the global settings API and the runner. The new Workspace resource, attempt-time configuration, and replacement UI must agree about which configuration is authoritative.

### Agreed: coordinated release boundary

The user agreed: implement the work in bounded internal steps, but merge/release the backend, Workspace UI, and legacy retirement as one complete coordinated change. Do not ship an intermediate state in which Workspace setup exists but extraction still uses global configuration, or global setup has been removed before the Workspace replacement is usable. This needs no gradual rollout, dual-write compatibility, or fallback feature flag. Internal development and verification use disposable local state until the complete cutover is ready.

### Agreed: implementation order

The user agreed to these five internal slices:

1. **Workspace storage and credential encryption** — add lazy, versioned product-store configuration storage, machine-secret encryption, and atomic configuration lifecycle operations. Use the existing leased Workspace product-store authority.
2. **Workspace configuration API and connection test** — add session-only, role-redacted configuration management, conditional mutations, secret-free invalidation, and the optional single-request draft connection test.
3. **Document admission and extraction processing** — enforce pre-side-effect configuration checks and resolve configuration per Workspace at each attempt; remove processing fallbacks and managed-file behavior while preserving operational controls and existing job semantics.
4. **Workspace setup UI** — implement approved B against the real Workspace API, including write-only key handling and member visibility; remove the old profile-menu setup.
5. **Cutover cleanup and final verification** — remove remaining global API/settings plumbing, perform the agreed legacy-file cleanup, update documentation/ADR references, and run the agreed project checks and implemented-UI walkthrough.

Each slice includes its relevant focused local checks and updates affected existing fixtures as the corresponding interfaces change. Testing is not deferred wholesale to the last slice. All five remain one coordinated release; the user's real-gateway confirmation stays separate from local implementation evidence.

## Answer

Implement the five slices below in order and deliver them as **one coordinated change**. Intermediate steps are development checkpoints, not separately released product states. Do not add a rollout flag, global fallback, dual-write mode, or rollback path. Use disposable local state during development; production cutover belongs to the completed change, not this planning effort.

This ticket is the implementation handoff index. The linked resolved tickets remain authoritative for detailed product behavior; do not create a competing copy of the specification. Include focused local checks with each slice and update existing fixtures when their interfaces change, then run the full agreed gate at the end.

### Workspace storage and credential encryption

**Dependency:** first slice.

**Contracts:** [authority boundary](01-choose-workspace-model-configuration-authority.md), [configuration and credential lifecycle](02-define-configuration-and-credential-lifecycle.md), and [lazy cutover migration](07-define-blank-state-global-configuration-cutover.md).

Start from the existing Workspace product store and registry in `backend/src/localWorkspaceProductStore.ts` and `backend/src/localWorkspaceProductStoreRegistry.ts`. Add optional configuration storage, versioned lazy migration, and atomic lifecycle operations behind the existing lease boundary. Implement dedicated machine-secret encryption and the agreed unavailable-credential behavior without introducing an application-wide configuration authority or eager Workspace database creation.

**Completion evidence:** focused local persistence/lifecycle and encryption/redaction checks from the verification contract. Saving, reopening, replacing, and clearing configuration must preserve the distinction between absent configuration and an unreadable credential. Existing backup and hard-erasure boundaries continue to include the Workspace-owned data.

### Workspace configuration API and connection test

**Dependency:** Workspace storage and credential encryption.

**Contracts:** [HTTP contract](04-define-workspace-model-configuration-http-contract.md) and [connection-test contract](05-decide-gateway-compatibility-validation.md).

Wire the Workspace resource through the existing application routing and policy boundary in `backend/src/localApplication.ts`. Add session-only, role-redacted reads; complete conditional mutations; write-only credential handling; and secret-free Workspace invalidation. Implement the optional draft connection test as the single outbound POST already specified, not a prerequisite for saving or a capability-certification mechanism.

**Completion evidence:** focused local configuration and access-rule checks, with mocked model requests as needed. Exact representations, preconditions, statuses, and redaction come from the HTTP contract. In particular, ordinary members see configured presence, not credential usability or owner/admin configuration details.

### Document admission and extraction processing

**Dependency:** the first two slices.

**Contracts:** [Extraction-job configuration semantics](03-decide-extraction-job-configuration-semantics.md), [gateway compatibility rules](05-decide-gateway-compatibility-validation.md), and [cutover](07-define-blank-state-global-configuration-cutover.md).

Update admission in `backend/src/localApplication.ts`, processing in `backend/src/localExtractionRunner.ts` and `backend/src/consumer/modelGateway.ts`, and their assembly in `backend/src/server.ts`. Resolve configuration from the job's Workspace product-store lease at the agreed attempt boundary. Remove the processing dependency on app-wide settings, environment/default gateway fallbacks, and managed-file behavior; preserve operational controls and the resolved in-flight/retry semantics.

**Completion evidence:** local `409`/`503` checks proving no Source-file/job admission side effects, plus relevant existing runner regressions updated for Workspace configuration. Adapt smoke/browser setup through the new authenticated resource as those fixtures become affected. Do not introduce the declined concurrent gateway integration suite.

### Workspace setup UI

**Dependency:** the backend slices above.

**Contracts:** [approved prototype](06-prototype-workspace-page-model-setup.md), [HTTP contract](04-define-workspace-model-configuration-http-contract.md), and [connection-test contract](05-decide-gateway-compatibility-validation.md).

Implement B on the existing Workspace page using the established frontend feature/controller structure. Relevant entry points are `frontend/src/features/workspaces/WorkspacePages.jsx`, `frontend/src/features/workspaces/useWorkspaceController.js`, `frontend/src/App.jsx`, and the existing profile-menu setup. Keep status inside the expandable header, with no separate readiness banner. Bind the editor, write-only key replacement, member presentation, and transient test feedback to the real Workspace API, and remove the profile-menu Model setup.

The prototype's captured branch/commit, linked from its decision ticket, is a visual and interaction source only. Do not promote its mock actions, scenario fixtures, variant switcher, or development-only wiring into production.

**Completion evidence:** relevant local frontend regressions and the brief implemented-UI walkthrough specified by the verification contract. Keep the outbound Model gateway credential distinct from the inbound Workspace API key.

### Cutover cleanup and final verification

**Dependency:** all four preceding slices.

**Contracts:** [blank-state cutover](07-define-blank-state-global-configuration-cutover.md) and [verification contract](08-set-implementation-verification-contract.md).

Remove remaining global settings plumbing, including the retired route/controller and unused `localModelSettings` integration. Apply the agreed legacy-file cleanup and non-blocking warning behavior; leave operator-owned environment files untouched. Update tracked setup documentation and the relevant ADR 0004 sections. Review the complete change for residual active global defaults and managed-file paths, while retaining machine-wide operational settings.

**Completion evidence:** pass `bun run ci:quality` and `bun run test:e2e`, record the focused local safety results and implemented-UI walkthrough, and make the combined backend/UI cutover ready as one change. Preserve existing stub-based project checks without adding a new gateway-backed suite. Report real-gateway processing as awaiting the user's separate confirmation until they supply it.

### Handoff boundary and terminology

All implementation behavior is specified by the linked decisions, and no further planning ticket is needed at this point. Use the established terms **Workspace model configuration**, **Model gateway credential**, **Workspace API key**, and **Model gateway connection test**; implementation sequencing introduces no additional domain concept requiring a glossary entry.

The later implementation handoff should report completion of these five slices, check outcomes, any actual limitations, and the user-owned gateway confirmation separately. This planning resolution does not start implementation, create a Codex task, merge a branch, deploy, or modify runtime state.
