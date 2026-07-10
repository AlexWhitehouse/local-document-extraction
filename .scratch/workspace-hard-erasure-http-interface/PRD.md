# PRD: Workspace Hard-Erasure and Executable Domain HTTP Interface

Status: completed

## Problem Statement

Deleting a **Workspace** currently removes its **Workspace control data** record but does not erase its authoritative **Workspace product data** or residual **Source files**. From the user's perspective, the action reports that the Workspace was deleted even though customer data remains on disk. Queued or in-flight **Extraction processing** can subsequently reopen the deleted Workspace's product store and recreate its SQLite database, contradicting the rule that Workspace deletion wins over late processing.

The frontend and backend also do not share an executable HTTP **Interface**. Frontend Modules construct route paths, methods, response assumptions, and error handling independently from backend route implementations. Several user-visible frontend flows therefore target behavior that the backend does not implement: profile reads and updates, Workspace member listing and actions, sent Workspace invitation listing, **Leave Workspace**, and Document deletion. Extraction job list search, cursor pagination, and total-count expectations also exceed the backend's current behavior.

The existing automated suite does not reveal this drift because frontend tests mock the expected routes while backend tests exercise a different set of routes. A green suite therefore does not prove that a user-visible frontend workflow can cross the real HTTP Seam successfully.

Maintainers need Workspace deletion to provide real hard-erasure, and they need the HTTP Interface itself to become the test surface so frontend and backend behavior cannot silently diverge again.

## Solution

Create a deep Workspace deletion Module that owns the complete action of deleting a Workspace. The Module will preserve existing owner-only and last-accepted-Workspace rules, block new Workspace product operations, revoke Workspace access, abort or drain in-flight work, erase authoritative Workspace product SQLite files and residual Source-file directories, notify session browsers that Workspace access changed, and complete only after hard-erasure succeeds.

Workspace deletion will be synchronous from the caller's perspective. A successful response means the Workspace is no longer accessible and its authoritative Workspace product database and Source-file directory no longer exist. The implementation will use durable deletion intent and startup reconciliation so a process crash or filesystem failure cannot allow orphan product data to be recovered by the **Local extraction runner** before cleanup resumes.

All Workspace product operations that can race with deletion, including Document submission, Template mutations, job reads, job mutations, runner recovery, retry scheduling, and in-flight Model gateway processing, will participate in Workspace-scoped operation coordination. Opening an existing Workspace product store must not implicitly create a replacement database for a deleted Workspace.

Create plain frontend domain request Modules that hide route construction, transport response interpretation, and domain error normalization from React controllers. Keep the existing generic request runtime as the transport Module. Backend route handling will remain a thin Adapter over deep backend domain Modules that own durable behavior.

Make the real HTTP Seam executable in tests. Contract-oriented tests will run the actual frontend domain request Adapter against the backend Fetch application or local Bun runtime. React tests will mock user intents and domain outcomes rather than inventing HTTP responses that the backend may not support.

Complete or deliberately remove every currently user-visible unsupported flow. Profile reads will use the authenticated Better Auth session, and profile-name updates will use Better Auth's existing update-user Interface rather than adding a shallow `/v1/profile` pass-through. Workspace membership, Workspace invitation management, and Leave Workspace behavior will be implemented through Workspace control data. Document deletion and Extraction job collection behavior will be completed through authoritative Workspace product data.

Workspace deletion will be the first vertical slice used to establish this deeper HTTP Interface and its tests. The same pattern will then be applied to the remaining Workspace, profile, and Document flows.

## User Stories

1. As a Workspace owner, I want deleting a Workspace to erase its authoritative Workspace product data, so that deleted customer data does not remain on disk.
2. As a Workspace owner, I want deleting a Workspace to erase every residual Source file for that Workspace, so that original Documents do not survive deletion.
3. As a Workspace owner, I want a successful deletion response only after hard-erasure completes, so that success has a clear and trustworthy meaning.
4. As a Workspace owner, I want deletion to revoke the Workspace API key immediately, so that external clients cannot access a deleted Workspace.
5. As a Workspace owner, I want deletion to remove Workspace memberships and Workspace invitations, so that no accepted or pending access survives.
6. As a Workspace owner, I want deletion to remain owner-only, so that admins and members cannot destroy the Workspace.
7. As a Workspace owner, I want to be prevented from deleting my only accepted Workspace, so that the accepted-Workspace invariant remains intact.
8. As a Workspace owner, I want concurrent Template or Document actions blocked once deletion begins, so that late requests cannot recreate erased product data.
9. As a Workspace owner, I want queued Extraction jobs prevented from starting after deletion begins, so that queued work cannot resurrect the Workspace database.
10. As a Workspace owner, I want in-flight Extraction processing aborted or drained before physical erasure completes, so that late lifecycle writes cannot recreate deleted data.
11. As a Workspace owner, I want retries for deleted Workspace jobs suppressed, so that a transient Model gateway failure cannot schedule work after deletion.
12. As a Workspace owner, I want Document submission racing with deletion to fail safely, so that a new Source file or Extraction job is not accepted into a deleted Workspace.
13. As a Workspace owner, I want deletion failure reported clearly, so that I do not mistake partial cleanup for successful hard-erasure.
14. As a signed-in Workspace member, I want a Workspace context invalidation when the Workspace is deleted, so that my browser stops presenting stale access.
15. As a signed-in user, I want the frontend to select another accepted Workspace after deletion, so that I remain in a valid Accepted workspace context.
16. As a signed-in user, I want visible Workspace-scoped Template and Document state cleared when deletion succeeds, so that data from the deleted Workspace does not remain on screen.
17. As an external client, I want requests using a deleted Workspace API key rejected, so that deleted credentials cannot retain access.
18. As an application operator, I want deletion intent recoverable after a backend crash, so that hard-erasure resumes automatically.
19. As an application operator, I want orphan Workspace product data reconciled before Extraction job recovery starts, so that startup does not process deleted work.
20. As an application operator, I want reconciliation to be idempotent, so that repeated startups or retries remain safe.
21. As an application operator, I want local analytics logs to retain their documented non-authoritative status, so that Workspace hard-erasure does not silently redefine analytics retention.
22. As a backend maintainer, I want one deep Workspace deletion Module, so that authorization, coordination, erasure, invalidation, and recovery ordering have strong Locality.
23. As a backend maintainer, I want Workspace deletion dependencies behind explicit Seams, so that filesystem, control-data, runner, and live-update behavior can be verified without duplicating deletion choreography.
24. As a backend maintainer, I want existing Workspace product stores opened without implicit creation, so that reads or late jobs cannot create deleted stores.
25. As a backend maintainer, I want Workspace product store initialization to remain explicit for newly created Workspaces, so that creation and reopening have different invariants.
26. As a backend maintainer, I want Source-file storage to support Workspace-scoped erasure, so that callers do not enumerate private path details.
27. As a backend maintainer, I want active Workspace operations coordinated during deletion, so that deletion does not race independently with every caller.
28. As a backend maintainer, I want Model gateway cancellation propagated through Extraction processing where possible, so that deletion does not wait for an avoidable timeout.
29. As a backend maintainer, I want late lifecycle results ignored for a Workspace being deleted, so that aborted processing does not persist failure or completion after revocation.
30. As a backend maintainer, I want Workspace deletion to preserve the separation between Model gateway invocation and persisted Extraction job lifecycle changes, so that ADR-0004 remains intact.
31. As a frontend user, I want profile details to load from my authenticated session, so that the profile UI does not call a missing route.
32. As a frontend user, I want profile-name changes to use the existing authentication Interface, so that updating my profile works in the local runtime.
33. As a Workspace member, I want to list the members of my accepted Workspace where Workspace policy permits it, so that I can understand who has access.
34. As a Workspace owner, I want to remove an eligible Workspace member, so that former collaborators lose access.
35. As a Workspace owner, I want to promote an eligible member to admin, so that trusted members can manage the Workspace.
36. As a Workspace owner, I want to transfer ownership where Workspace policy permits it, so that Workspace ownership can change safely.
37. As a Workspace admin, I want Workspace member actions limited by Workspace policy, so that I cannot perform owner-only actions.
38. As a Workspace member, I want unauthorized member actions rejected by the backend, so that frontend visibility is not the authority for access.
39. As a Workspace owner or admin, I want to list actionable pending Workspace invitations sent from the Workspace, so that I can manage outstanding access offers.
40. As a Workspace owner or admin, I want accepted, cancelled, and expired invitations excluded from Workspace invitation management, so that the list remains actionable.
41. As a non-owner Workspace member, I want Leave Workspace to remove only my Workspace membership, so that the Workspace and other members remain intact.
42. As a non-owner Workspace member, I want leaving my last accepted Workspace to create a Replacement personal Workspace, so that I retain at least one accepted Workspace.
43. As a Workspace owner, I want Leave Workspace rejected, so that owners use Workspace deletion instead of abandoning ownership.
44. As a signed-in user, I want a successful Leave Workspace action to move me to a valid Accepted workspace context, so that the frontend and backend remain aligned.
45. As a Workspace user, I want Document deletion to remove authoritative Extraction job data and any remaining Source file, so that deleted Documents are actually removed.
46. As a Workspace user, I want deleting a queued or processing Document to prevent later lifecycle writes, so that the deleted Document does not reappear.
47. As a Workspace user, I want deleting an already-missing Document handled predictably, so that the UI can report that it was already removed.
48. As a Workspace user, I want Document deletion authorization enforced by the backend, so that frontend controls are not the security authority.
49. As a Workspace user, I want job search to be interpreted consistently by frontend and backend, so that displayed Documents match my query.
50. As a Workspace user, I want cursor pagination to return stable pages without duplicate or missing Extraction jobs, so that Load More behaves predictably.
51. As a Workspace user, I want the Documents count to represent all durable Extraction jobs in the Workspace, so that filtering or pagination does not undercount work.
52. As a frontend maintainer, I want React controllers to call domain request Modules by intent, so that route paths and response details do not leak through UI state management.
53. As a frontend maintainer, I want domain request Modules to normalize HTTP errors, so that controllers do not repeat status and payload interpretation.
54. As a frontend maintainer, I want unsupported routes removed rather than preserved as mocks, so that the frontend advertises only executable behavior.
55. As a backend maintainer, I want route handlers to delegate durable rules to domain Modules, so that route matching does not become the rule owner.
56. As a backend maintainer, I want the HTTP Interface exercised through the real Fetch application, so that missing routes and incompatible response shapes fail tests.
57. As a test maintainer, I want frontend domain request Adapters usable without rendering React, so that HTTP behavior can be tested cheaply and deterministically.
58. As a test maintainer, I want React tests to mock domain outcomes rather than raw route responses, so that presentation tests are not a second backend implementation.
59. As a test maintainer, I want contract-oriented tests to cover both success and domain errors, so that status mappings and error codes cannot drift.
60. As an AFK agent, I want the implementation sequence and invariants captured in one PRD, so that I can implement the work without rediscovering the deletion race or HTTP mismatches.
61. As an AI coding agent, I want each domain Interface to have strong Locality and Leverage, so that future changes require less cross-module tracing.
62. As a maintainer, I want the complete root command surface to remain green, so that the architectural deepening does not regress the local product.

## Implementation Decisions

- Treat this PRD as a focused local-runtime follow-on to the completed Workspace policy and earlier Workspace product data work. Existing owner-only and last-accepted-Workspace eligibility decisions remain authoritative and are not reopened.
- Add `Workspace deletion` to the backend domain glossary as the complete action that revokes access, wins over in-flight Workspace product operations, and hard-erases authoritative Workspace product data and Source files.
- Build a deep Workspace deletion Module. Its Interface should express the deletion intent and outcome while hiding authorization revalidation, operation gating, runner coordination, durable deletion intent, filesystem erasure, Workspace context invalidation, and retry/recovery ordering.
- A successful Workspace deletion response remains synchronous and compatible with the current success shape. Success is returned only after the Workspace product database and Workspace Source-file directory have been erased.
- Preserve existing error semantics for non-members, non-owners, and owners attempting to delete their only accepted Workspace.
- Revoke Workspace access and the Workspace API key before physical product cleanup. This makes a crash leave inaccessible orphan data rather than a visible Workspace with silently missing product data.
- Persist enough deletion intent to resume cleanup after a process crash or filesystem failure. Successful cleanup should remove transient deletion metadata so completed deletion does not retain unnecessary Workspace control data.
- Run startup deletion reconciliation and orphan cleanup before the Local extraction runner scans Workspace product stores for resumable jobs.
- Add Workspace-scoped operation coordination covering product HTTP operations, Document submission, runner work, retry scheduling, and deletion. New operations must be rejected once deletion begins, and deletion must wait for or cancel active operations before erasure.
- Propagate cancellation into Model gateway work where the existing request implementation can support it. Model invocation remains outside authoritative Extraction job lifecycle persistence, preserving ADR-0004.
- Do not persist terminal lifecycle changes after an operation learns that its Workspace is being deleted. Deleted Workspace product data remains absent rather than recording a final failure.
- Separate explicit product-store initialization from opening an existing product store. Runner recovery, job execution, and normal reads must not initialize a missing store for a deleted Workspace.
- Extend the local Source file store with Workspace-scoped erasure behind its Interface. Callers must not learn or reproduce the private filesystem layout.
- Erase the Workspace SQLite database together with any SQLite sidecar files and the complete Workspace Source-file directory. Cleanup must be idempotent when paths are already absent.
- Keep Local product analytics logs outside Workspace hard-erasure, matching the documented rule that they are privacy-filtered operational logs rather than authoritative Workspace product data.
- Emit a Workspace context invalidation for access change as part of successful control-data revocation so connected session browsers revalidate over HTTP.
- Keep the existing generic frontend request runtime as the deep transport Module for credentials, JSON parsing, common errors, and forbidden Workspace recovery.
- Build plain frontend domain request Modules for Workspace control actions and Workspace product actions. React controllers should consume domain outcomes and must not construct route paths or interpret backend response shapes directly.
- Keep frontend domain request Modules independent of React so they can run in Bun contract-oriented tests and focused frontend tests.
- Do not introduce a shared route-constant registry as the primary solution. Shared constants could let both implementations agree on an incorrect declaration without exercising the real HTTP Seam.
- Backend route handlers remain thin Adapters over backend domain Modules. Durable Workspace access and membership rules remain in Workspace control data; Template, Document, and Extraction job rules remain in authoritative Workspace product data.
- Replace frontend profile reads with authenticated session data. Replace profile-name updates with Better Auth's existing update-user Interface. Do not add a custom profile pass-through route.
- Complete Workspace member listing and Workspace member actions through Workspace control data, using backend Workspace policy as the durable authority for permitted actions.
- Complete Workspace invitation management listing through Workspace control data. Return actionable pending invitations only, consistent with the domain glossary.
- Complete Leave Workspace through Workspace control data, including owner rejection, membership-only removal, Replacement personal Workspace creation, and the next Accepted workspace context.
- Complete Document deletion through authoritative Workspace product data and local Source-file storage. Deletion must coordinate with queued and processing work so a deleted Document cannot receive later lifecycle writes.
- Preserve a not-found HTTP response for a missing Document; the frontend may translate that response into its existing already-removed feedback.
- Complete Extraction job list search and cursor pagination or remove the corresponding frontend behavior in the same implementation slice. The selected decision for this PRD is to implement them because the current frontend exposes both behaviors.
- Extraction job collection responses will continue to include jobs, next cursor, and has-more state, and will add an authoritative total count for the accepted Workspace independent of filtering and pagination.
- Use a stable descending order based on durable creation time with a deterministic ID tie-breaker for cursor pagination.
- Search will cover stable user-visible job metadata already available in Workspace product data, including Source-file name, Extraction job ID, Template ID, and lifecycle status. It must not search extracted answers or evidence.
- Establish an executable HTTP Interface test harness that runs actual frontend domain request Adapters against the backend Fetch application or the local Bun runtime.
- Contract-oriented tests must independently state expected user intent and outcomes rather than importing backend route declarations into assertions.
- React presentation tests should mock domain request Modules or their outcomes, not raw HTTP route strings and backend-shaped fixtures.
- Implement Workspace deletion first as the tracer bullet for the new seam, then apply the pattern to Workspace access management, Leave Workspace, Document deletion, job collection behavior, and profile cleanup.
- Do not add a web framework, generic repository abstraction, generic command bus, or speculative Adapter Seam as part of this work.

## Testing Decisions

- Good tests exercise observable behavior through a Module's Interface or the real HTTP Seam. They should not assert private helper names, filesystem path-construction helpers, SQL statements, internal callback order, or exact React state updates.
- Preserve existing Workspace control tests for owner-only deletion and last-accepted-Workspace rejection, but route complete deletion behavior through the new Workspace deletion Interface.
- Test Workspace deletion with real temporary local state so successful deletion proves that control access, the Workspace product SQLite database, SQLite sidecars, and the Workspace Source-file directory are absent.
- Test that the deleted Workspace API key no longer authorizes product requests.
- Test that Workspace memberships and Workspace invitations disappear through control-data deletion.
- Test that a queued runner job delivered after deletion cannot recreate the Workspace product database.
- Test deletion racing with a queued Extraction job before claim.
- Test deletion racing with in-flight Model gateway work using a controllable extraction Adapter.
- Test deletion racing with Document submission after authorization but before Source-file/job persistence.
- Test that deletion blocks retry scheduling and ignores late completion or failure results.
- Test cancellation and drain timeout/error behavior through the Workspace deletion Interface rather than through private coordination state.
- Test idempotent erasure when product or Source-file paths are already missing.
- Test filesystem failure behavior and durable cleanup resumption.
- Test simulated restart after control-data revocation but before physical erasure. Reconciliation must complete before runner recovery and must not process orphan jobs.
- Test Workspace context invalidation after deletion through observable live-update behavior and subsequent forbidden HTTP revalidation.
- Test the local Source file store's Workspace-scoped erasure through its public Interface.
- Test explicit product-store initialization separately from opening an existing store. Opening a missing existing store must not create it.
- Test frontend Workspace deletion through the real domain request Adapter against the backend Fetch application, including success and policy errors.
- Test Workspace member listing and actions through the real frontend domain request Adapter and backend domain behavior.
- Test owner, admin, member, and non-member authorization outcomes for Workspace member actions.
- Test Workspace invitation management listing includes actionable pending invitations and excludes accepted, cancelled, and expired invitations.
- Test Leave Workspace end to end for ordinary departure, owner rejection, last-accepted-Workspace replacement, and next-context selection.
- Test Document deletion through the real HTTP Seam for completed, failed, queued, processing, and missing jobs.
- Test Document deletion removes remaining Source files and prevents late lifecycle writes.
- Test Extraction job search, cursor pagination, deterministic ordering, has-more behavior, and authoritative total count.
- Test that filtered and paginated results do not change the authoritative Documents count.
- Test that job search does not inspect Extraction results or evidence.
- Test profile display from the authenticated session and profile-name mutation through Better Auth's update-user Interface.
- Add negative contract-oriented tests for every formerly imaginary route so reintroducing an unsupported call fails quickly.
- Keep focused React tests for visible confirmations, Action toasts, selected Workspace context, and rendering, but stop using those tests as proof that backend behavior exists.
- Prior art includes the local runtime smoke test for a full Bun Request/Response path, local Workspace control tests for accepted-context and deletion eligibility, local Workspace product store tests for authoritative persistence, Local extraction runner tests for recovery and retries, Local live update tests for Workspace isolation, and frontend runtime tests for common request handling.
- Run focused tests during each slice, then finish with `bun run typecheck`, `bun run test`, and `bun run build` from the repository root.

## Out of Scope

- Changing Workspace deletion eligibility, owner-only policy, or the last-accepted-Workspace rule.
- Making Workspace deletion asynchronous or returning success before hard-erasure completes.
- Supporting multiple Bun backend processes or distributed deletion coordination.
- Replacing the Local extraction runner, Model gateway, LiteLLM request contract, or bounded retry policy.
- Changing the durable Extraction job lifecycle states beyond coordination required to prevent writes after deletion.
- Erasing Local product analytics logs as part of Workspace deletion.
- Adding a user-facing deletion progress page, restore function, soft-delete grace period, recycle bin, or undelete capability.
- Adding a generic router framework, generated HTTP client, OpenAPI pipeline, or shared route-constant registry.
- Redesigning the visual frontend, navigation, or Action toast language beyond changes required to make existing flows executable.
- Deepening the broader Workspace context transition Module or extracting Workspace live update transport beyond the deletion invalidation needed here.
- Deepening Template object schema, Account password policy, or other architecture candidates from the preceding review.
- Reintroducing billing, commercial quota enforcement, Stripe behavior, or Cloudflare runtime dependencies.
- Migrating or cleaning historical Cloudflare production data.
- Adding an audit log or treating analytics as product authority.
- Creating implementation issues; this publication contains the PRD only.

## Further Notes

- This PRD synthesizes the recommended architecture assumptions from the preceding investigation without an additional interview: deletion is synchronous and strong, and HTTP work includes completing or deliberately removing all currently user-visible unsupported behavior.
- Workspace deletion is intentionally the first vertical slice because it exercises authorization, durable state, Source-file storage, concurrent processing, live invalidation, frontend state, and the HTTP Seam in one coherent user action.
- A diagnostic reproduction confirmed that invoking a late queued runner job recreates a missing Workspace SQLite database with the current product-store factory. Preventing that recreation is an acceptance requirement, not a theoretical hardening task.
- The existing completed Workspace policy work remains useful prior art for eligibility, but its earlier assumption that cascade deletion removed all product data is not true in the local per-Workspace SQLite runtime.
- The earlier Workspace product scale-out cleanup work describes Cloudflare Durable Object and R2 behavior and should be treated as historical design context, not as evidence that the local filesystem implementation is complete.
- This work fulfils ADR-0005's local durable-state model and preserves ADR-0004's separation between Model gateway invocation and persisted Extraction job lifecycle changes.
- Domain documentation should be updated alongside implementation when `Workspace deletion` is established as the name of the complete hard-erasure action.

## Comments

> *This was generated by AI from the architecture investigation and published with `ready-for-agent` status.*
