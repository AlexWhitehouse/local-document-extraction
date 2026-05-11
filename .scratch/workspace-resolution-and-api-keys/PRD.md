# Workspace Resolution and API Key PRD

Status: needs-triage

## Problem Statement

The frontend currently has a synthetic default Workspace ID and can treat locally persisted state as if it were a real accepted Workspace context. From the user's perspective, this creates confusing and unsafe states: workspace-scoped UI can appear available before the backend has confirmed access, stale Workspace data can appear during loading or Workspace switches, and browser persistence can retain secret or obsolete Workspace API key material.

Workspace API keys are also mixed into the SPA's own authentication behavior. Users need Workspace API keys as external-client credentials, but the SPA itself should use the signed-in user session plus accepted Workspace context. Owners/admins need a clear generate/rotate flow with one-time key visibility, while members need a non-actionable API key display state.

## Solution

Remove synthetic default and fallback Workspace behavior from the frontend. A signed-in user should enter Loading workspace context while the SPA resolves accepted Workspace context from the backend. The frontend should only use backend-confirmed accepted Workspace IDs, should never invent a fallback Workspace ID, and should keep workspace-scoped UI actions unavailable until accepted Workspace context is resolved.

Make the backend responsible for preserving the accepted Workspace invariant. A signed-in user must always have at least one accepted Workspace after sign-up or first login. If that invariant is broken, `GET /v1/workspaces` repairs it by creating a personal Workspace through the same bootstrap path used for first login, then returns the repaired workspace list.

Separate SPA session authentication from Workspace API key authentication. The SPA uses the signed-in user session plus accepted Workspace context for workspace-scoped UI requests. Workspace API keys are external-client credentials for workspace-scoped product routes. They are generated or rotated explicitly by workspace owners/admins, shown once, copied when possible, and never stored or used by the SPA as its active credential.

Clean up frontend persistence. Stored workspace preference contains only accepted Workspace ID and display name under a new Document Extraction storage key. The frontend does not read the legacy local storage key. Auth form values, Workspace API key material, Templates, selected Template, selected Document, job history, and active page do not persist through the broad workspace preference blob. Completed document cache is allowed, but only for opened completed Documents, with strict retention, clearing, and content rules.

## User Stories

1. As a signed-in user, I want the app to resolve my accepted Workspace from the backend, so that I only work inside a Workspace I can access.
2. As a signed-in user, I want the app to avoid synthetic default Workspace IDs, so that actions are never sent to a fake Workspace.
3. As a signed-in user, I want workspace-scoped actions disabled while my Workspace is loading, so that I cannot accidentally act before access is confirmed.
4. As a signed-in user, I want a clear Loading workspace context, so that I understand the app is resolving my Workspace.
5. As a signed-in user, I want Loading workspace context to use generic loading text, so that stale stored names are not shown as current access.
6. As a signed-in user, I want a retryable Workspace resolution error when Workspaces cannot load, so that I can recover without the app inventing fallback access.
7. As an unauthenticated visitor, I want to be taken to the login page, so that Workspace context is only available after sign-in.
8. As an unauthenticated visitor, I do not want API keys to grant SPA access, so that external credentials do not become browser sessions.
9. As a new user, I want a personal Workspace created automatically on sign-up or first login, so that I can start using the app immediately.
10. As a signed-in user, I want the backend to repair a missing accepted Workspace invariant, so that impossible access states self-heal at the session boundary.
11. As a signed-in user with only pending Workspace invitations, I want the backend to create a personal accepted Workspace, so that invitations are not mistaken for access.
12. As a signed-in user, I do not want silent backend repair shown as a toast, so that implementation recovery does not feel like a user action.
13. As a signed-in user with multiple Workspaces, I want the app to restore my last accepted Workspace when it is still valid, so that refreshes are not disruptive.
14. As a signed-in user with stale stored Workspace preference, I want the app to select another backend-confirmed accepted Workspace, so that I recover from removed access.
15. As a signed-in user without a stored Workspace preference, I want the app to select the first accepted Workspace returned by the backend, so that startup is deterministic.
16. As a signed-in user, I want pending Workspace invitations to appear in the workspace area without being auto-selected on startup, so that accepted Workspace access remains primary.
17. As a signed-in user, I do not want selected pending Workspace invitations persisted across reloads, so that refresh returns me to usable accepted Workspace context.
18. As an invitee, I want accepting a Workspace invitation to move me into the newly accepted Workspace context, so that I can start using it immediately.
19. As an invitee, I want declining a Workspace invitation to return me to an accepted Workspace context, so that invitation decisions do not disrupt my usable Workspace.
20. As a Workspace creator, I want newly created Workspaces to become the current accepted Workspace context, so that I can work in the Workspace I just created.
21. As a Workspace creator, I do not want Workspace creation to automatically expose API key material, so that creating a Workspace is separate from provisioning an external client.
22. As a Workspace owner, I want deleting the current Workspace to switch me to another accepted Workspace, so that the UI remains in a valid context.
23. As a Workspace owner, I cannot delete my only accepted Workspace, so that I always retain Workspace access.
24. As a Workspace member, I want Leave Workspace to move me to another accepted Workspace, so that I do not end up without context.
25. As a Workspace member leaving my last accepted Workspace, I want a Replacement personal Workspace created immediately, so that the app can move me to valid access.
26. As a Workspace owner/admin, I want to remove another user's Workspace membership even if it was their last accepted Workspace, so that Workspace administration is not blocked by private cross-Workspace state.
27. As a removed Workspace member, I want my accepted Workspace invariant repaired when I next list Workspaces, so that I recover on my next session boundary.
28. As a signed-in user whose current Workspace access is removed by someone else, I want the app to refresh Workspaces and move me to another accepted Workspace, so that I do not stay in forbidden context.
29. As a signed-in user whose Workspace access changes unexpectedly, I want an Action toast, so that I understand why the UI moved away from that Workspace.
30. As a signed-in user, I want switching Workspaces to clear visible workspace-scoped data immediately, so that data from the previous Workspace is not shown under the new Workspace.
31. As a signed-in user, I want switching Workspaces to clear completed Document cache entries, so that cached results do not carry across Workspace boundaries.
32. As a signed-in user, I want renaming the current Workspace to update display and stored preference without clearing data, so that non-context-changing edits feel lightweight.
33. As a signed-in user, I want stored workspace preference to contain only Workspace ID and display name, so that persistence is small and non-secret.
34. As a signed-in user, I want the app to ignore the legacy local storage key, so that old synthetic IDs and secret fields do not re-enter state.
35. As a signed-in user, I accept losing old local stored workspace preference once, so that stale local state is removed cleanly.
36. As a signed-in user, I do not want auth form name or email persisted by default, so that user-specific form data is not mixed into Workspace preference.
37. As a signed-in user, I do not want active page persisted across refresh, so that startup begins from a predictable Workspace page.
38. As a signed-in user, I do not want selected Document persisted across refresh, so that selection is based on the current backend job list.
39. As a signed-in user, I do not want selected upload Template persisted across refresh, so that Template selection is derived from current backend Templates.
40. As a signed-in user, I want completed Document details cached only after I open the Document, so that cache reflects actual review behavior.
41. As a signed-in user, I want at most 50 completed Documents cached, so that browser storage stays bounded.
42. As a signed-in user, I want completed Document cache to survive refresh for the same accepted Workspace, so that recently opened completed results can render quickly.
43. As a signed-in user, I want completed Document cache cleared on sign-out, so that sensitive extraction results do not persist after the session ends.
44. As a signed-in user, I want completed Document cache to exclude source file contents, File objects, blob URLs, and source preview URLs, so that local cache does not become document file storage.
45. As a signed-in user, I want failed, queued, and processing Extraction jobs fetched from the backend, so that local cache does not preserve operational states.
46. As a signed-in user, I want cached completed Document entries pruned conservatively, so that filtering does not delete useful cache entries.
47. As a signed-in user, I want a deleted or not-found Document removed from cache, so that stale results do not remain available.
48. As a signed-in user, I want the selected Document to move to the first available Document when the previous selection disappears, so that the document view stays coherent.
49. As a Workspace owner/admin, I want to see whether a Workspace API key exists, so that I know whether I am generating the first key or rotating an existing one.
50. As a Workspace owner/admin, I want to generate a Workspace API key only when I explicitly ask for one, so that external-client credentials are intentional.
51. As a Workspace owner/admin, I want to rotate an existing Workspace API key, so that I can replace credentials when needed.
52. As a Workspace owner/admin, I want rotation to require confirmation, so that I understand existing external clients will stop working.
53. As a Workspace owner/admin, I want first API key generation to avoid confirmation, so that initial setup is straightforward.
54. As a Workspace owner/admin, I want newly generated or rotated key material always shown once, so that I can copy it even if clipboard access fails.
55. As a Workspace owner/admin, I want the app to attempt to copy the one-time key automatically, so that setup is fast when the browser allows clipboard access.
56. As a Workspace owner/admin, I want different Action toast copy for generated versus rotated keys, so that I understand what happened.
57. As a Workspace owner/admin, I want a failed or unavailable clipboard copy to tell me to copy manually, so that the toast does not falsely claim success.
58. As a Workspace owner/admin, I want the one-time key visible until dismissed, Workspace change, sign-out, refresh, or navigation away, so that I have time to copy it.
59. As a Workspace owner/admin, I want a compact icon-only Copy button inside the key field, so that I can retry copying without visual clutter.
60. As a keyboard or screen-reader user, I want the icon-only Copy button to have an accessible label, so that I can use it reliably.
61. As a Workspace owner/admin, I want no format-specific key placeholder promises, so that the UI does not imply a guaranteed key length or prefix.
62. As a Workspace owner/admin, I want the empty key field to say "Generate an API key to view", so that the first action is clear.
63. As a Workspace owner/admin, I want the existing-hidden key field to say "Rotate API key to view again", so that I understand existing secrets cannot be recovered.
64. As a Workspace member, I want to see the API key section in its current non-actionable role-gated state, so that I understand owners/admins manage external credentials.
65. As a Workspace member, I cannot generate or rotate Workspace API keys, so that external-client credential management stays with owners/admins.
66. As an external API client, I want Workspace API keys to authenticate workspace-scoped product routes, so that integrations can access Templates, Extraction jobs, and Document submission.
67. As an external API client, I want API keys to keep current product-route access parity, so that existing product-route behavior remains compatible.
68. As an external API client, I cannot use Workspace API keys for profile, membership, invitations, Workspace deletion, or API key generation, so that user/session-only operations stay session-only.
69. As a maintainer, I want existing silent key hashes treated as no external-client API key during migration, so that unrecoverable implicit credentials are reset safely.
70. As a maintainer, I want the API-key reset decision recorded in an ADR, so that future maintainers know why existing hashes were cleared.
71. As a maintainer, I want Workspace API key format treated as opaque, so that tests and UI do not depend on a key schema.
72. As a maintainer, I want Workspace resolution, API key display, and completed Document cache rules extracted into deep modules where useful, so that behavior can be tested without rendering the entire App.

## Implementation Decisions

- Modify the backend Workspace policy so Workspaces can exist without an external-client Workspace API key.
- Add or migrate explicit backend state for whether a Workspace has an external-client Workspace API key.
- Existing silently generated workspace key hashes are treated as not being external-client Workspace API keys during migration.
- Respect the accepted ADR recording the reset of silent Workspace API keys.
- New and bootstrapped Workspaces start with `has_api_key: false` and no visible Workspace API key material.
- `GET /v1/workspaces` repairs a signed-in user's broken zero-accepted-Workspace invariant by creating a personal Workspace through the same bootstrap path used for first login.
- Pending Workspace invitations do not satisfy the accepted Workspace invariant.
- `GET /v1/workspaces` includes whether each accepted Workspace has an external-client Workspace API key.
- `POST /v1/workspaces` returns the new accepted Workspace context with `has_api_key: false` and no Workspace API key secret.
- Replacement personal Workspace responses include `has_api_key: false` and no Workspace API key secret.
- `POST /v1/workspaces/:id/api-key` remains the endpoint for issuing a new one-time Workspace API key secret.
- `POST /v1/workspaces/:id/api-key` replaces any existing key hash and returns the one-time secret plus `has_api_key: true`.
- Workspace owners/admins may generate or rotate Workspace API keys; members may not.
- Workspace API keys continue to authenticate external clients for workspace-scoped product routes.
- Workspace API keys continue to have current access parity on workspace-scoped product routes.
- Workspace API keys do not authenticate user/session-only routes or the SPA shell.
- The SPA no longer uses Workspace API keys as its own request authentication mode.
- The SPA uses the signed-in session plus accepted Workspace context for workspace-scoped UI requests.
- Remove the synthetic default Workspace ID behavior from frontend Workspace resolution.
- Startup Workspace resolution selects accepted Workspace context from the backend workspace list.
- Stored workspace preference is only a hint and is valid only when it still appears in the backend workspace list.
- Stored workspace preference contains only accepted Workspace ID and display name.
- The frontend uses a new Document Extraction local storage key and does not read the legacy Image Extraction storage key.
- Discarding legacy local stored workspace preference is intentional.
- Auth form values are not persisted by default.
- Active page, selected Document, selected upload Template, Templates, job history, and API key material are not persisted in stored workspace preference.
- Loading workspace context uses a generic display and unavailable workspace-scoped actions.
- Workspace resolution failure enters a retryable Workspace resolution error rather than falling back to stored state.
- Accepting a Workspace invitation moves to the newly accepted Workspace context.
- Declining a Workspace invitation returns to an accepted Workspace context.
- Creating a Workspace moves to the new accepted Workspace context without generating a Workspace API key.
- Deleting the current Workspace clears workspace-scoped state, refreshes Workspaces, and selects the first remaining accepted Workspace.
- Losing access to the selected Workspace triggers a workspace-list refresh and moves to another accepted Workspace when available, with an Action toast.
- Switching accepted Workspace clears visible workspace-scoped data and completed Document cache before loading the new Workspace data.
- Renaming the current Workspace updates display and stored preference without clearing workspace-scoped data.
- Build or deepen a Workspace resolution module that encapsulates accepted Workspace selection, stale preference handling, loading/error transitions, and post-action context transitions behind a small pure interface.
- Build or deepen a Workspace API key display module that encapsulates label selection, one-time secret visibility, confirmation requirements, copy outcomes, and non-secret UI state behind a small pure interface.
- Build a Completed document cache module that owns cache insert, lookup, retention, pruning, and clearing rules behind a small interface keyed by accepted Workspace context and job ID.
- Keep browser effects such as local storage, clipboard access, confirmation prompts, navigation, and toast emission in the App adapter layer.
- Keep network requests in the App adapter layer; pure modules should return decisions/effects rather than executing requests.
- Completed document cache stores only backend-returned completed job metadata and Extraction results.
- Completed document cache excludes source file contents, File objects, blob URLs, and source preview URLs.
- Completed document cache stores details only after the user opens a completed Document and details load.
- Completed document cache keeps at most 50 completed Documents for the current accepted Workspace.
- Completed document cache may survive page refresh for the same resolved accepted Workspace.
- Completed document cache is cleared on Workspace change and sign-out.
- Completed document cache entries are removed on explicit delete, not-found detail responses, and conservative unfiltered job-list evidence.
- Filtered job-list absence does not remove completed Document cache entries.
- The API key display section remains visible to members, but generate/rotate is available only to owners/admins.
- The API key action is "Generate API Key" when `has_api_key` is false and "Rotate API Key" when `has_api_key` is true.
- Rotating an existing Workspace API key requires confirmation; first generation does not.
- The API key display shows "Generate an API key to view" when no API key exists.
- The API key display shows "Rotate API key to view again" when a key exists but material is not visible.
- Generated or rotated Workspace API key material is always shown once, regardless of clipboard copy success.
- The frontend attempts clipboard copy when key material is issued.
- Clipboard success uses generated-and-copied or rotated-and-copied Action toast copy.
- Clipboard failure or unavailable Clipboard API uses manual-copy Action toast copy and leaves the key visible.
- Visible key material includes a compact icon-only Copy button with an accessible label.
- Workspace API key format remains opaque and should not be promised by placeholder text.

## Testing Decisions

- Good tests should assert external behavior and API contracts, not private implementation details.
- Backend policy tests should verify Workspace creation/bootstrap without external-client API keys, `has_api_key` state, API key issue/reissue behavior, owner/admin authorization, member rejection, API key authentication, and zero-Workspace repair.
- Backend API tests should verify response contracts for workspace listing, Workspace creation, Replacement personal Workspace, and API key generation.
- Backend migration tests or focused verification should prove existing silent key hashes are treated as no external-client Workspace API key.
- Existing Workspace policy tests are prior art for durable Workspace rules and authorization behavior.
- Existing auth and route tests are prior art for session-only versus API-key-authenticated route boundaries.
- Frontend pure module tests should cover Workspace resolution from backend lists, stale stored preference, missing stored preference, loading/error states, Workspace switch clearing decisions, invitation accept/decline transitions, create/delete/rename transitions, and forbidden-access recovery decisions.
- Frontend pure module tests should cover API key display labels, generate versus rotate action labels, rotation confirmation requirement, one-time visibility lifecycle, clipboard success/failure outcomes, and member versus owner/admin action availability.
- Frontend pure module tests should cover Completed document cache insertion, lookup, 50-entry retention, same-Workspace refresh survival, Workspace-change clearing, sign-out clearing, delete/not-found removal, filtered-list non-pruning, and exclusion of source preview data.
- Existing Workspace selection helper tests are prior art for pure frontend Workspace context behavior.
- Existing workspace toast tests are prior art for user-facing Action toast expectations.
- Existing toast notification tests are prior art for ensuring API key material is not leaked in toast messages.
- App-level tests should focus only on integration seams that pure tests cannot cover, such as local storage key behavior, clipboard adapter behavior, and visible role-gated API key controls.
- Tests should not assert internal helper names, React state variable names, or implementation-specific storage layout beyond the documented external persistence contract.
- Verification should include backend typecheck and frontend production build because the repo has no general lint/test command defined in the project instructions.

## Out of Scope

- Scoped Workspace API keys with separate read/write/delete permissions.
- Changing current API-key access parity on workspace-scoped product routes.
- Changing Workspace role policy to make API key generation owner-only.
- Persisting active page, selected Document, selected upload Template, Templates, or job history as user preferences.
- Offline-first Document review or long-term local storage of Extraction results.
- Persisting source files, preview URLs, File objects, or blob URLs.
- Supporting API-key access to the SPA shell.
- Supporting unauthenticated Workspace context in the frontend.
- Migrating data from the legacy Image Extraction local storage key.
- Changing Workspace API key prefix or making the key format a user-facing contract.
- Introducing URL routing for page persistence.

## Further Notes

- The domain glossary now defines Loading workspace context, Workspace resolution error, Workspace API key display, Workspace API key, Workspace API key format, Completed document cache, Active page, and Selected upload Template.
- The backend ADR for resetting silent Workspace API keys records why existing unrecoverable key hashes are treated as no external-client API key during migration.
- This PRD intentionally supersedes older frontend assumptions that restored API keys from local storage or used a synthetic default Workspace ID.
- The strongest implementation seam is to keep durable Workspace policy on the backend while moving frontend decision logic into pure modules that return decisions and required effects.
