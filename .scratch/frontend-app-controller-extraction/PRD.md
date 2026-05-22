# Frontend App Controller Extraction PRD

Status: needs-triage

## Problem Statement

The frontend root App component still owns too much stateful behavior after phase-one presentation modularisation. From a user's perspective, the browser experience works, but maintainers must still read a large orchestration component to change **Documents**, **Extraction jobs**, **Templates**, **Workspace context**, **Workspace selection view**, auth, profile, **Action toast** feedback, upload state, polling, and Template JSON modal behavior.

This makes behavior-preserving changes risky because unrelated concerns share the same state/action/effect surface. It also limits the impact of further LOC reduction: extracting presentation reduced some size, but the largest remaining chunks are controller-like state, API orchestration, effects, and cross-feature handlers.

## Solution

Reduce App LOC by extracting stateful controllers and a small shared runtime layer without changing user-visible behavior. App remains the public root component and top-level composer, but delegates cohesive state/actions/effects to feature controllers that return grouped view models by UI surface.

The extraction should happen in vertical, independently verifiable slices. Start with a small app runtime/core layer, then extract Documents, Templates, Workspace, and auth/profile controllers. Keep the existing **Active page**, **Workspace selection view**, **Action toast**, **Template**, **Document**, **Extraction job**, **Selected upload Template**, and **Completed document cache** behavior unchanged.

## User Stories

1. As a signed-in user, I want the Workspace page to behave exactly as it does today, so that controller extraction does not disrupt Workspace management.
2. As a signed-in user, I want accepted Workspace selection to behave exactly as it does today, so that I keep working in the intended **Accepted workspace entry**.
3. As an invitee, I want selecting an **Invited workspace entry** to keep showing **Locked invitation state**, so that I do not mistake a pending invitation for Workspace access.
4. As an invitee, I want accepting a **Workspace invitation** to behave exactly as it does today, so that accepting still moves me into accepted **Workspace context**.
5. As an invitee, I want declining a **Workspace invitation** to behave exactly as it does today, so that the invited entry is removed predictably.
6. As a Workspace owner, I want **Workspace API key display** behavior to remain unchanged, so that external-client credential workflows are not affected by refactoring.
7. As a Workspace owner, I want rotating an existing Workspace API key to keep requiring confirmation, so that external clients are not invalidated accidentally.
8. As a Workspace owner or admin, I want invitation creation and cancellation to remain unchanged, so that pending access offers can still be managed safely.
9. As a Workspace owner or admin, I want Workspace user actions to remain unchanged, so that member access management still follows current Workspace behavior.
10. As a Workspace member, I want unauthorized Workspace management actions to remain unavailable, so that the UI still reflects my role.
11. As a signed-in user, I want **Stored workspace preference** behavior to remain unchanged, so that only accepted Workspace ID and display name persist.
12. As a signed-in user, I want **Loading workspace context** to remain unchanged, so that startup does not show stale stored Workspace details.
13. As a signed-in user, I want **Workspace resolution error** to remain retryable and unchanged, so that failed startup resolution does not fall back to unsafe local state.
14. As a signed-in user, I want selected accepted Workspace access loss to keep refreshing Workspaces and showing an **Action toast**, so that access changes remain clear.
15. As a signed-in user, I want visible workspace-scoped data to clear immediately when accepted **Workspace context** changes, so that data from different Workspaces is not mixed.
16. As a signed-in user, I want Templates to load, search, select, create, update, delete, and save exactly as they do today, so that Template authoring is unchanged.
17. As a Template editor, I want **Template field** editing to behave exactly as it does today, so that existing Template authoring workflows are preserved.
18. As a Template editor, I want Template JSON export/import to behave exactly as it does today, so that raw Template payload editing remains safe.
19. As a Template editor, I want Template JSON validation feedback to remain unchanged, so that invalid payloads are still caught before saving.
20. As a Template editor, I want Template JSON copy-to-clipboard feedback to remain unchanged, so that clipboard outcomes remain visible.
21. As a signed-in user, I want **Document** search and selection to remain unchanged, so that I can find and inspect existing Documents.
22. As a signed-in user, I want **Document** upload modal state to behave exactly as it does today, so that selecting, dragging, dropping, and removing Source files remains predictable.
23. As a signed-in user, I want **Selected upload Template** behavior to remain unchanged, so that new Documents are submitted with the intended Template.
24. As a signed-in user, I want Document submission to keep using the `document` multipart field, so that the backend contract remains unchanged.
25. As a signed-in user, I want **Document upload toast** behavior to remain unchanged, so that queueing outcomes stay clear.
26. As a signed-in user, I want queued **Extraction jobs** to appear exactly as they do today, so that upload progress remains visible.
27. As a signed-in user, I want live **Extraction job** polling to remain unchanged, so that queued and processing Documents update automatically.
28. As a signed-in user, I want opening a completed Document to keep loading and caching details, so that **Extraction results** render quickly when available.
29. As a signed-in user, I want **Completed document cache** behavior to remain unchanged, so that completed **Extraction jobs** can still render quickly after Workspace resolution.
30. As a signed-in user, I want deleting a Document to behave exactly as it does today, so that removed Documents leave the UI and cache consistently.
31. As a signed-in user, I want 404s for removed Documents to keep clearing stale UI state, so that unavailable Documents are not shown as selectable.
32. As a signed-in user, I want profile loading, editing, menu dismissal, and sign-out to remain unchanged, so that profile behavior remains predictable.
33. As an unauthenticated user, I want sign-in and sign-up to behave exactly as they do today, so that authentication feedback remains unchanged.
34. As an unauthenticated user, I want password policy and mismatch feedback to remain unchanged, so that account creation requirements stay clear.
35. As an unauthenticated user, I want Google sign-in feedback to remain unchanged, so that provider-start failures remain understandable.
36. As a maintainer, I want App to stay as the public root component, so that application bootstrap and integration tests do not need unnecessary churn.
37. As a maintainer, I want App to become a thin composer of controllers and feature components, so that feature-specific behavior is easier to find.
38. As a maintainer, I want a small runtime/core layer, so that fetch, logging, and **Action toast** behavior are not duplicated across controllers.
39. As a maintainer, I want forbidden Workspace access recovery to remain owned by the Workspace controller, so that Workspace recovery rules stay in one place.
40. As a maintainer, I want hook-order dependencies to stay legal and obvious, so that controllers do not create circular runtime dependencies.
41. As a maintainer, I want controller return values grouped by UI surface, so that App does not keep assembling dozens of individual props.
42. As a maintainer, I want Documents extracted before Workspace, so that the first large controller slice is high-impact but comparatively contained.
43. As a maintainer, I want Templates extracted before Workspace, so that Template editor and Template JSON modal behavior can move behind a focused interface.
44. As a maintainer, I want Workspace extracted after Documents and Templates, so that the riskiest controller is attempted after the runtime pattern is proven.
45. As a maintainer, I want auth/profile extracted after Workspace, so that session-adjacent behavior is separated only after Workspace dependencies are clearer.
46. As a maintainer, I want existing App integration tests to remain the primary regression safety net, so that user-visible behavior is protected during internal moves.
47. As a maintainer, I want frontend production builds after each slice, so that split modules and imports remain valid.
48. As an AI coding agent, I want implementation issues split by controller boundary, so that each slice can be completed independently without re-opening settled design choices.

## Implementation Decisions

- Preserve current user-visible behavior exactly during controller extraction.
- Keep App as the public root and top-level composer.
- Optimize for meaningful LOC reduction by extracting state/actions/effects, not only presentation.
- Proceed in multiple vertical slices rather than one large application-state PR.
- Extract a small app runtime/core layer before feature controllers.
- Split runtime into a core layer and a workspace-aware final layer to avoid hook-order cycles.
- The core runtime owns endpoint construction, logging, toast helpers, and generic request primitives that do not depend on Workspace recovery.
- The final workspace-aware runtime owns authenticated/workspace-scoped request behavior and accepts a forbidden Workspace access callback.
- Forbidden Workspace access recovery remains owned by the Workspace controller.
- Workspace operations use Workspace-owned API helpers built from the core runtime rather than depending on the final workspace-aware runtime.
- Documents and Templates use the final workspace-aware runtime for workspace-scoped requests.
- Controllers return grouped view models by UI surface rather than long flat lists of individual fields and callbacks.
- The Document controller owns document list state, upload modal state, upload queueing, polling, deletion, selected Document behavior, and **Completed document cache** integration.
- The Template controller owns Template list state, Template editor state, Template create/update/delete behavior, and Template JSON modal logic.
- The Workspace controller owns **Workspace context**, **Workspace selection view**, Workspace resolution status, accepted Workspace switching, invitations, users, API key display state, and forbidden access recovery.
- The auth/profile controller owns auth form state, password feedback state, Better Auth sign-in/sign-up/provider/sign-out handlers, profile loading/saving, and profile menu behavior.
- Preserve legacy internal variable names during the first extraction unless they leak into a new controller public API.
- Use glossary-aligned names for controller public props and actions, including **Document**, **Extraction job**, **Source file**, **Template**, **Workspace context**, and **Action toast** language.
- Do not introduce React Context as part of this work.
- Do not introduce URL routing for **Active page**.
- Do not change backend API contracts, storage keys, or persisted data shapes.
- Do not change CSS architecture or visual design.
- Do not update frontend domain context for this internal architecture refactor.
- Do not create an ADR unless a later implementation decision becomes hard to reverse, surprising without context, and the result of a real trade-off.

## Testing Decisions

- Tests should verify external behavior and user-visible outcomes, not controller implementation details.
- Existing App integration tests remain the primary regression safety net during the first controller extraction pass.
- Existing pure library tests for Workspace selection, completed document cache, toast notifications, and Template field behavior should remain in place.
- Do not add controller-specific tests during the initial behavior-preserving extraction unless a controller exposes independently meaningful pure behavior or a bug is found.
- Each implementation slice should run the frontend test suite.
- Each implementation slice should run the frontend production build.
- Good tests for this work should continue to query by accessible roles, labels, and user-visible text rather than controller names.
- Manual verification should focus on behavior that crosses controller boundaries: Workspace switching clears workspace-scoped data, forbidden access recovery still refreshes Workspaces, Template edits still affect upload Template choices, and Document upload still queues **Extraction jobs** with the selected Template.

## Out of Scope

- Changing user-visible behavior.
- Redesigning the UI.
- Introducing URL routing for **Active page**.
- Introducing React Context.
- Introducing a global state library.
- Modularising CSS.
- Changing backend routes or API contracts.
- Changing storage keys, **Stored workspace preference**, or **Completed document cache** persistence behavior.
- Changing Better Auth configuration.
- Changing Workspace access rules, Workspace invitation rules, or **Workspace API key display** behavior.
- Changing Template validation semantics or Template JSON payload shape.
- Changing **Document** upload formats, multipart field names, or **Extraction job** lifecycle behavior.
- Renaming all internal legacy variables as part of the first extraction pass.
- Creating controller-level tests solely to assert internal hook structure.

## Further Notes

- This PRD is phase two of frontend modularisation. The completed phase-one PRD extracted presentation components while intentionally leaving stateful hooks and API client extraction for later.
- The repository uses multiple domain contexts. This PRD concerns the frontend context and should preserve the frontend glossary language around **Workspace selection view**, **Active page**, **Action toast**, **Document**, **Source file**, **Extraction job**, **Extraction result**, **Template**, **Template field**, **Selected upload Template**, **Stored workspace preference**, **Loading workspace context**, **Workspace resolution error**, **Workspace API key display**, and **Completed document cache**.
- The target sequence is runtime/core first, then Document controller, Template controller, Workspace controller, auth/profile controller, and optional residual page JSX extraction if it still provides useful LOC reduction.
