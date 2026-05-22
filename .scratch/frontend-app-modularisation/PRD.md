# Frontend App Modularisation PRD

Status: needs-triage

## Problem Statement

The frontend currently concentrates too much browser experience inside the root App component. From a user's perspective, the product behavior may still work, but changes to Workspaces, Templates, Documents, authentication, upload, or Extraction results are risky because maintainers must reason through one very large component before making safe changes.

The current shape also differs from the backend structure. The backend entrypoint mostly delegates durable product rules and API behavior to focused modules, while the frontend root component still owns page rendering, modal rendering, API request orchestration, Workspace context transitions, auth/profile handling, upload queueing, document result display, and Template field editing.

This makes the frontend harder to review, harder to test selectively, and harder for future agents or maintainers to change without accidentally affecting unrelated product areas such as **Workspace selection view**, **Workspace API key display**, **Template field** editing, **Document** upload, **Extraction job** review, or **Extraction result** rendering.

## Solution

Modularise the frontend App without changing user-visible behavior. The root App remains the public orchestration component, but it becomes thinner by delegating presentation and owning pure helpers to feature-oriented modules.

The first phase extracts presentation components and tightly owned pure helper functions. State, side effects, API request helpers, cross-feature orchestration, React Context, and CSS modularisation remain for later phases. This keeps the first implementation pass safe and reviewable while making the UI boundaries visible.

The target structure is feature-oriented rather than a generic component bucket. Features should follow the product language already used by the frontend context: auth, profile, layout, Workspaces, Templates, and Documents. Deep modules should be preferred where they encapsulate meaningful behavior behind a stable interface, especially for **Extraction result** display and **Template field** editing.

## User Stories

1. As a signed-in user, I want the Workspace page to behave exactly as it does today, so that modularisation does not disrupt Workspace management.
2. As a signed-in user, I want accepted Workspace selection to behave exactly as it does today, so that I keep working in the intended **Accepted workspace entry**.
3. As an invitee, I want **Invited workspace entry** selection to keep showing **Locked invitation state**, so that I do not mistake a pending invitation for Workspace access.
4. As an invitee, I want accepting a **Workspace invitation** to behave exactly as it does today, so that accepting still moves me into accepted Workspace context.
5. As an invitee, I want declining a **Workspace invitation** to behave exactly as it does today, so that the invited entry is removed predictably.
6. As a Workspace owner, I want **Workspace API key display** behavior to remain unchanged, so that external-client credential workflows are not affected by refactoring.
7. As a Workspace owner or admin, I want Workspace invitation management to remain unchanged, so that pending access offers can still be managed safely.
8. As a Workspace owner or admin, I want Workspace user actions to remain unchanged, so that member access management still follows current Workspace behavior.
9. As a Workspace member, I want unauthorized Workspace management actions to remain unavailable, so that the UI still reflects my role.
10. As a signed-in user, I want the profile menu to behave exactly as it does today, so that profile editing and sign-out remain predictable.
11. As an unauthenticated user, I want sign-in and sign-up to behave exactly as they do today, so that authentication feedback remains unchanged.
12. As an unauthenticated user, I want password policy feedback to remain unchanged, so that account creation requirements stay clear.
13. As an unauthenticated user, I want Google sign-in feedback to remain unchanged, so that provider-start failures remain understandable.
14. As a signed-in user, I want the sidebar navigation to behave exactly as it does today, so that the **Active page** remains an in-memory SPA section.
15. As a signed-in user, I want the context sidebar to show the same page-specific lists, so that Workspaces, Templates, and Documents remain easy to find.
16. As a signed-in user, I want context sidebar counts and status chips to remain unchanged, so that operational feedback remains familiar.
17. As a signed-in user, I want the Workspace toolbar to show the same Workspace context and access state, so that I know whether API access is ready.
18. As a signed-in user, I want operational metrics to render unchanged, so that Templates, Documents, completion, and failure counts remain visible.
19. As a Template editor, I want **Template field** editing to behave exactly as it does today, so that existing Template authoring workflows are preserved.
20. As a Template editor, I want object-like **Template field** schemas to behave exactly as they do today, so that table-shaped Template guidance remains intact.
21. As a Template editor, I want Template JSON export/import to behave exactly as it does today, so that I can continue editing raw Template payloads safely.
22. As a Template editor, I want Template validation feedback to remain unchanged, so that invalid Template payloads are still caught before saving.
23. As a Template editor, I want Template copy-to-clipboard feedback to remain unchanged, so that I know when the Template JSON was copied.
24. As a signed-in user, I want the Documents page to behave exactly as it does today, so that **Extraction job** review is not disrupted.
25. As a signed-in user, I want Document search and selection to remain unchanged, so that I can find and inspect existing Documents.
26. As a signed-in user, I want **Document** upload to behave exactly as it does today, so that source files can still be queued with the selected Template.
27. As a signed-in user, I want the upload modal to preserve drag-and-drop behavior, so that existing upload interactions remain available.
28. As a signed-in user, I want the upload modal to continue accepting supported Source file formats, so that supported Documents can still be submitted.
29. As a signed-in user, I want **Document upload toast** behavior to remain unchanged, so that queueing outcomes stay clear.
30. As a signed-in user, I want **Extraction job** status display to remain unchanged, so that queued, processing, completed, and failed Documents are still understandable.
31. As a signed-in user, I want **Extraction result** rendering to remain unchanged, so that strings, objects, arrays, and table answers still display correctly.
32. As a signed-in user, I want confidence and status tones in **Extraction result** cards to remain unchanged, so that result quality cues remain familiar.
33. As a signed-in user, I want deleting a Document to behave exactly as it does today, so that removed Documents leave the UI and cache consistently.
34. As a signed-in user, I want **Completed document cache** behavior to remain unchanged, so that completed **Extraction jobs** can still render quickly after Workspace resolution.
35. As a signed-in user, I want visible workspace-scoped data to clear on accepted Workspace context changes exactly as it does today, so that data from different Workspaces is not mixed.
36. As a signed-in user, I want **Stored workspace preference** behavior to remain unchanged, so that only accepted Workspace ID and display name persist.
37. As a signed-in user, I want **Loading workspace context** and **Workspace resolution error** displays to remain unchanged, so that startup and failure states remain understandable.
38. As a maintainer, I want App to stay as the public root component, so that tests and application bootstrap do not need unnecessary churn.
39. As a maintainer, I want App to become a thinner orchestration component, so that feature-specific rendering is easier to find.
40. As a maintainer, I want frontend modules to align with product features, so that Workspaces, Templates, Documents, auth, profile, and layout concerns have clear homes.
41. As a maintainer, I want **Workspace selection view** components separated from Template and Document components, so that Workspace changes do not require reading unrelated UI.
42. As a maintainer, I want accepted Workspace UI separated from invitation UI, so that **Locked invitation state** remains explicit in code.
43. As a maintainer, I want Template-specific modal code kept with Templates, so that Template JSON behavior stays near **Template field** behavior.
44. As a maintainer, I want upload UI kept with Documents, so that Source file submission remains near **Document** and **Extraction job** review.
45. As a maintainer, I want auth UI separated from profile UI, so that unauthenticated session creation is not mixed with signed-in user display.
46. As a maintainer, I want layout wrappers separated from feature-specific lists, so that shared shell structure does not become another large branching component.
47. As a maintainer, I want pure display helpers moved with their owning feature, so that helper ownership is obvious.
48. As a maintainer, I want cross-feature orchestration to stay in App during phase one, so that request headers, Workspace recovery, and session behavior are not accidentally changed.
49. As a maintainer, I want explicit props during phase one, so that dependencies remain visible while feature boundaries are clarified.
50. As a maintainer, I want React Context considered later, so that it is introduced only after real dependency patterns are visible.
51. As a maintainer, I want CSS to remain global during phase one, so that visual regressions are not mixed into component extraction.
52. As a maintainer, I want API client extraction deferred, so that networking behavior is not changed as part of presentation modularisation.
53. As a maintainer, I want stateful hooks deferred, so that state behavior is not changed before presentation seams are established.
54. As a maintainer, I want small behavior-preserving slices, so that each refactor is easy to review and revert if needed.
55. As a maintainer, I want the document result/status extraction to happen first, so that the modularisation approach is proven on a low-risk seam.
56. As a maintainer, I want complex leaf components tested where valuable, so that extracted deep modules have reliable behavioral coverage.
57. As a maintainer, I want existing App-level integration tests to remain the primary safety net, so that user-visible behavior is protected.
58. As a maintainer, I want frontend build verification after modularisation slices, so that bundling and imports remain valid.
59. As an AI coding agent, I want feature boundaries that use the domain glossary, so that future changes can be made without rediscovering product language.
60. As an AI coding agent, I want a PRD that records phased decisions, so that implementation does not re-open settled design questions.

## Implementation Decisions

- Preserve current single-page behavior exactly during the first modularisation phase.
- Keep App as the public root and top-level orchestration component.
- Make App thinner by delegating presentation to feature-oriented components.
- Use feature folders as the target organisation rather than a generic shared component bucket.
- Use auth, profile, layout, Workspaces, Templates, and Documents as the primary feature boundaries.
- Extract presentation components before extracting stateful hooks.
- Move pure helper functions only when they are tightly owned by the extracted feature component.
- Keep cross-feature orchestration in App during phase one.
- Keep API request helpers in App during phase one because they are coupled to API base, Workspace context, forbidden-access recovery, logging, and session behavior.
- Use explicit props during phase one rather than introducing React Context immediately.
- Preserve the intention to consider React Context later after real prop dependency patterns are visible.
- Keep CSS global during phase one.
- Keep upload under the Documents feature because upload is how a **Document** and **Source file** enter the app.
- Keep Template JSON export/import under the Templates feature because it is Template-specific behavior, not a generic modal concern.
- Split accepted Workspace UI from **Workspace invitation** UI so that **Locked invitation state** remains explicit.
- Use a small context-sidebar layout wrapper plus feature-specific context lists, rather than one large branching context sidebar.
- Split auth UI from profile UI because unauthenticated session creation and signed-in profile management have different lifecycles.
- Extract document result/status UI first as the proof slice because it is relatively self-contained.
- Prefer deep modules where they encapsulate meaningful functionality behind a small interface.
- Treat **Extraction result** display as a deep module candidate because it encapsulates table, object, array, confidence, and status rendering behind a simple component interface.
- Treat **Template field** editing and Template field normalization as a deep module candidate because it encapsulates field mutation, object schema editing, validation, and serialization behind a feature-owned interface.
- Treat Workspace context presentation as a boundary around accepted Workspace UI and invitation UI, while keeping existing Workspace transition orchestration outside the first presentation extraction.
- Treat App integration behavior as unchanged unless explicitly covered by a later phase.
- Do not create a domain CONTEXT entry for this refactor because it is implementation architecture rather than domain terminology.
- Do not create an ADR for the phase-one prop strategy because it is tactical and easy to reverse.
- No schema changes are required.
- No backend API contract changes are required.

## Testing Decisions

- Tests should verify external behavior and user-visible outcomes, not internal component boundaries.
- Existing App integration tests remain the primary regression safety net during the first modularisation phase.
- Component-level tests should be added selectively for extracted deep or branch-heavy leaf components.
- **Extraction result** display should have component tests because it has meaningful rendering branches for missing values, arrays, objects, tables, confidence, and status.
- **Template field** editing should have component or module tests when extracted because field mutation and object schema behavior are complex.
- Workspace page, layout wrappers, and modal shell components do not need immediate component tests if App integration tests already cover their important user-visible flows.
- Auth behavior should continue to be covered through existing App-level tests that mock the runtime auth client and assert toast feedback and form behavior.
- Workspace behavior should continue to be covered through existing App-level tests that mock network responses, local storage, and toast feedback.
- Existing pure library tests for Workspace selection, completed document cache, and toast notifications should remain in place.
- Each implementation slice should run the frontend test suite.
- Each implementation slice should run the frontend production build.
- Good tests for this work should continue to query by accessible roles, labels, and user-visible text rather than component names.

## Out of Scope

- Changing user-visible behavior.
- Introducing URL routing for **Active page**.
- Introducing React Context during phase one.
- Extracting stateful feature hooks during phase one.
- Creating a shared API client during phase one.
- Modularising CSS during phase one.
- Redesigning the UI.
- Changing backend routes or API contracts.
- Changing storage keys, **Stored workspace preference**, or **Completed document cache** behavior.
- Changing auth behavior or Better Auth configuration.
- Changing Workspace access rules, Workspace invitation rules, or **Workspace API key display** behavior.
- Changing Template validation semantics or Template JSON payload shape.
- Changing **Document** upload formats, multipart field names, or **Extraction job** lifecycle behavior.
- Creating an ADR for this tactical refactor unless a later decision becomes hard to reverse, surprising without context, and the result of a real trade-off.

## Further Notes

- The repository uses multiple domain contexts. This PRD concerns the frontend context and should preserve the frontend glossary language around **Workspace selection view**, **Active page**, **Action toast**, **Document**, **Source file**, **Extraction job**, **Extraction result**, **Template**, **Template field**, **Stored workspace preference**, **Loading workspace context**, **Workspace resolution error**, and **Workspace API key display**.
- The backend ADR about silent **Workspace API keys** remains relevant background for preserving **Workspace API key display** semantics, but this refactor does not alter that decision.
- The implementation should proceed in small behavior-preserving slices: document result/status UI, modal components, page components, layout components, then later stateful hooks if desired.
- Long prop lists are acceptable during phase one because they expose coupling. They should be treated as evidence for later hook or React Context extraction, not solved prematurely.
