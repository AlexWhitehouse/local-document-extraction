# PRD: Workspace Context Live Invalidation

Status: ready-for-agent

## Problem Statement

The frontend currently shows **Billing operational status** badges and Workspace capacity metrics from the resolved **Workspace context**. Those values are authoritative only after the frontend refetches the backend Workspace list, because the backend recomputes remaining Credits, remaining Plan page capacity, and Plan limit overage state from Workspace billing, Workspace membership, and Workspace product data.

The current **Workspace live update** stream is useful for live **Extraction job** status, but it also causes the frontend to refresh Workspace capacity whenever any live **Extraction job** lifecycle event arrives. That makes the header reasonably fresh after Document submission, but it couples job lifecycle notifications to billing/context refreshes. Under high-volume external API ingestion, many job lifecycle messages can cause every open frontend to refetch Workspace context several times per second.

Template-related Plan limit overage has the opposite problem. Template create, update, and delete actions refresh Template data, but they do not reliably refresh the Workspace context that drives header badges. A Workspace can therefore have stale “Template limit overage” or “Template schema limit overage” badges until another Workspace refresh happens.

Users need the header badges and submission-blocking state to become fresh when Workspace context may have changed, without turning every live job update or every external API submission into an immediate `/workspaces` refetch per connected browser.

The current Workspace refresh path is also broader than live invalidation needs. It fetches the full Workspace list and pending invitations, and the backend recomputes billing and Plan limit state for every listed Workspace. Live invalidation only needs to refresh the currently accepted **Workspace context** in the common case.

Live update authorization is currently checked when the websocket is opened. If a member loses Workspace access while a socket is already open, the implementation needs an explicit access-revalidation or socket-closing behaviour so the removed member does not continue processing live events for a Workspace they can no longer access.

## Solution

Introduce an explicit Workspace context invalidation signal on the existing **Workspace live update** protocol.

The backend should emit a lightweight invalidation event after committed mutations that may affect **Billing operational status**, Workspace capacity metrics, or submission-blocking state. The event should only say that Workspace context may be stale and why. It must not contain computed badge strings, Credit balances, invoice details, payment details, or owner-only billing information.

The frontend should parse Workspace live update envelopes into separate event groups:

- **Extraction job** lifecycle events update the Documents UI.
- Workspace context invalidation events schedule a throttled refetch of Workspace context.

The frontend should stop refreshing Workspace context solely because a job lifecycle event arrived. It should refresh because a Workspace context invalidation event arrived, or because a local user action deliberately asks for a prompt refresh after a successful mutation.

Workspace context refreshes triggered by live invalidation should be coalesced and rate-limited. A burst of external Document submissions should produce a small number of Workspace context refetches per connected frontend, not one refetch per live job event or per submitted Document.

Live invalidation refreshes should use a selected-Workspace context refresh path rather than the full Workspace list whenever possible. The selected refresh should recompute and return the current Workspace entry data needed by the frontend, including **Billing operational status**, remaining Credits, remaining Plan page capacity, Plan limits, role/access flags, and API-key existence metadata. Full Workspace-list refresh should remain for startup, Workspace switching, invitation resolution, and access recovery.

When Workspace access may have changed for a connected session, the client should revalidate access immediately before applying further Workspace live update effects. The backend may also close known affected live update sockets after member-removal or Leave Workspace mutations when enough session identity is available on the websocket attachment.

The backend remains the source of truth for **Billing operational status** and Workspace capacity. The websocket is an invalidation transport, not an alternate billing or Plan limit rules engine.

## User Stories

1. As a workspace member, I want header badges to update after Credits or Plan page capacity change, so that I know when Document submission is blocked or available again.
2. As a workspace member, I want header badges to update after Template Plan limit overage changes, so that I understand why Document submission may be blocked.
3. As a workspace member, I want the upload action to become disabled when the backend says the accepted Workspace context is blocked, so that I do not start a Document upload that is already known to fail.
4. As a workspace member, I want the upload action to become available again after Credits, capacity, or overage state is repaired, so that I can resume work without refreshing the browser.
5. As a workspace owner, I want owner-side billing or admin-side billing changes to refresh operational badges for connected members, so that the product state reflects the repaired Workspace billing state.
6. As a workspace owner, I want buying Credits or receiving a Goodwill Credit grant to make connected browsers eventually show updated remaining Credits, so that users understand capacity has changed.
7. As a workspace owner, I want Plan changes to refresh connected browsers' Workspace context, so that limits and submission-blocking state follow the new entitlement.
8. As a workspace owner, I want No-billing mode changes to refresh connected browsers' Workspace context, so that Enterprise limit profile behaviour is reflected without manual reload.
9. As a workspace owner or admin, I want member changes that affect Plan member limit overage to refresh connected browsers, so that overage badges do not remain stale.
10. As a Template builder, I want creating a Template to refresh operational badges when Template count limits may be affected, so that the header reflects the current Workspace product data.
11. As a Template builder, I want deleting a Template to refresh operational badges when Template count overage may be relieved, so that the header no longer shows stale blockers.
12. As a Template builder, I want updating Template fields to refresh operational badges when Template schema limits may be affected, so that schema overage is shown or cleared accurately.
13. As a Template builder, I do not want typing draft Template changes to refresh Workspace context, so that local editing stays fast and quiet.
14. As a Template builder, I do not need a Workspace context refresh for Template selection or navigation, so that ordinary browsing does not cause unnecessary network work.
15. As a document reviewer, I want live **Extraction job** status to continue updating from Workspace live updates, so that the Documents page remains responsive.
16. As a document reviewer, I do not want every `processing` or `completed` live **Extraction job** event to refetch Workspace context, so that high-volume processing does not make the app noisy.
17. As an external API user, I want high-throughput Document submission through a Workspace API key to remain efficient, so that browser sessions do not amplify ingestion load into many Workspace-list requests.
18. As a backend maintainer, I want **Extraction job** lifecycle live updates separated from Workspace context invalidation, so that document-status freshness and billing-context freshness can be tuned independently.
19. As a backend maintainer, I want Workspace context invalidation events to carry only reason codes, so that websocket messages do not duplicate billing rules or expose owner-only billing details.
20. As a backend maintainer, I want the backend HTTP Workspace listing to remain the source of truth for **Billing operational status**, so that Plan limit, Credit, page capacity, and membership rules live in one authoritative path.
21. As a backend maintainer, I want mutation code that changes Template, billing, or membership state to explicitly emit invalidation, so that the system does not rely on the Product Store Durable Object inferring unrelated domain state.
22. As a backend maintainer, I want the Product Store Durable Object to remain a Workspace live update transport for Workspace product data, so that it does not become responsible for computing Workspace billing state.
23. As a backend maintainer, I want Workspace context invalidation emitted only after committed mutations, so that frontend refreshes see durable state rather than racing ahead of writes.
24. As a backend maintainer, I want failed mutations not to emit invalidation events unless they already changed authoritative state, so that clients do not refetch after no-op failures.
25. As a backend maintainer, I want Credit refunds after failed acceptance steps to emit billing invalidation when they change the Billing ledger, so that connected frontends do not show stale spent capacity.
26. As a backend maintainer, I want Stripe billing event handlers that mutate Workspace billing state to emit billing invalidation, so that connected browsers learn about asynchronous payment outcomes.
27. As a backend maintainer, I want Application admin billing flows to emit invalidation after successful state changes, so that members see repaired or changed **Billing operational status**.
28. As a backend maintainer, I want Workspace member actions and invitation acceptance to emit member-limit invalidation when accepted membership counts may change, so that Plan member limit overage stays fresh.
29. As a backend maintainer, I want live invalidation refreshes to be throttled on the frontend, so that bursts of mutations coalesce into a bounded number of Workspace context refetches.
30. As a backend maintainer, I want the throttle to include a trailing refresh, so that the frontend eventually catches up after a burst even if it skipped intermediate invalidations.
31. As a backend maintainer, I want local user actions to remain able to request a prompt refresh, so that the user who just saved or submitted sees feedback quickly.
32. As a backend maintainer, I want live invalidation to tolerate missed websocket messages, so that reconnect still relies on HTTP revalidation rather than durable websocket history.
33. As a backend maintainer, I want the client parser to ignore unknown Workspace live update event types, so that the protocol can evolve without breaking existing browsers.
34. As a backend maintainer, I want malformed live update frames ignored safely, so that one bad message does not break the Documents or Workspace UI.
35. As a backend maintainer, I want stale websocket handlers guarded when Workspace context changes, so that an old socket cannot update the wrong accepted Workspace context.
36. As a backend maintainer, I want Workspace API keys to remain unable to open Workspace live updates, so that live browser updates stay session-based.
37. As a backend maintainer, I want live invalidation refreshes to update only the current accepted Workspace context in the common case, so that connected browsers do not repeatedly fetch invitations or recompute every Workspace they can access.
38. As a backend maintainer, I want full Workspace-list refreshes reserved for startup, Workspace switching, invitation resolution, and access recovery, so that live invalidation uses the smallest reliable HTTP revalidation path.
39. As a backend maintainer, I want connected live update sockets to revalidate or close when Workspace access changes, so that removed members do not keep receiving useful Workspace live updates.
40. As a backend maintainer, I want session identity stored only as backend live-update connection metadata, so that access-change handling does not expose account identity in websocket messages.
41. As a backend maintainer, I want Workspace context invalidation after Document submission to happen after the submission is accepted, so that temporary Credit reservations for failed submissions do not create confusing capacity flicker.
42. As a backend maintainer, I want Credit refund invalidation to happen only when a refund mutation actually changes Billing ledger state, so that no-op compensation does not create unnecessary refreshes.
43. As an AFK agent, I want the Workspace live update parser and Workspace context refresh scheduler to be deep, testable modules, so that the implementation is easy to verify without a real websocket server.
44. As an AFK agent, I want a selected Workspace context refresh module behind a small Interface, so that callers do not need to know whether a refresh is full-list, selected-context, or access-recovery work.
45. As an AFK agent, I want clear reason-code tests for each mutation family, so that future billing or Template changes do not silently stop invalidating Workspace context.
46. As a product operator, I want high-volume external ingestion to avoid avoidable frontend refetch storms, so that live browser sessions do not add accidental backend load.
47. As a product operator, I want connected browser badges to be eventually fresh rather than synchronously exact for every external submission, so that the product balances responsiveness with operational stability.

## Implementation Decisions

- Keep backend HTTP reads as the authoritative way to compute Workspace context, **Billing operational status**, remaining Credits, and remaining Plan page capacity.
- Add or deepen a selected accepted Workspace context refresh path for live invalidation. This may be a route such as `GET /v1/workspaces/:workspaceId/context` or an equivalent existing-route extension, but it should return the current Workspace entry shape needed by the frontend without fetching pending invitations or every Workspace the user can access.
- The selected Workspace context refresh path should compute **Billing operational status**, remaining Credits, remaining Plan page capacity, Plan limits, Workspace role/access flags, and Workspace API key existence metadata for the requested accepted Workspace.
- The selected Workspace context refresh path should reuse the same backend **Billing operational status** computation as the Workspace listing path, preferably through a shared Workspace context snapshot or operational-status Module, so list refresh and selected refresh cannot drift.
- The frontend live-invalidation refresh path should call the selected Workspace context refresh path and merge the returned Workspace entry into existing Workspace context state.
- The frontend should fall back to full Workspace-list refresh when selected Workspace context refresh returns forbidden/not found, when access-recovery semantics are needed, or when the accepted Workspace context can no longer be trusted.
- Full Workspace-list refresh should remain the default for startup resolution, Stored workspace preference recovery, Workspace switching, pending Workspace invitation resolution, and explicit access recovery.
- Extend the existing **Workspace live update** envelope with a new event type for Workspace context invalidation.
- Use a versioned batch envelope for live update messages, matching the existing protocol direction.
- The invalidation event should carry a reason code and occurrence timestamp, not computed badge state or owner-only billing details.
- Initial invalidation reason codes should cover billing usage, billing entitlement, Template limits, member limits, and Workspace access revalidation.
- Treat invalidation reason codes as hints for logging, debugging, and future tuning. The frontend should refetch Workspace context regardless of the specific recognized reason once it decides a refresh is needed.
- Do not add badge-computation rules to the Product Store Durable Object.
- Do not make the Product Store Durable Object read the Billing ledger, Stripe state, or Workspace membership state in order to decide exact badge values.
- Provide a narrow backend helper or live-update interface that mutation paths can call with Workspace ID and invalidation reason.
- The helper may use the existing Workspace Product Store Durable Object socket broadcaster as the transport in the first implementation.
- The helper interface should leave room for a future dedicated live-update Durable Object if Workspace live updates outgrow the Product Store boundary.
- The Worker should provide the Product Store Durable Object with enough session identity metadata when accepting a live update socket to support access-change handling. This identity is backend connection metadata and must not be sent to other clients.
- Member-removal and Leave Workspace mutations should close known affected live update sockets when the affected session identity is known to the live-update transport.
- When exact socket closure is not possible or when access may have changed broadly, emit a Workspace access revalidation invalidation. The frontend should immediately revalidate the selected accepted Workspace context and should ignore further useful live update effects for that socket until revalidation succeeds.
- Emit Template-limit invalidation after successful Template create, Template delete, and Template field/schema update mutations.
- A pure Template rename or description-only update may emit Template-limit invalidation for implementation simplicity, but the preferred implementation should avoid it if field/schema changes can be distinguished cleanly.
- Do not emit Template-limit invalidation for local browser draft edits, Template selection, Template list loading, or Template detail loading.
- Emit billing-usage invalidation after a Document submission is accepted, meaning the Credit reservation has succeeded and the Document has reached the accepted queueing point that the API reports to the caller.
- Do not emit billing-usage invalidation immediately after a temporary Credit reservation if later acceptance steps can still fail and refund the reservation before the caller receives an accepted submission response.
- Emit billing-usage invalidation after a successful Credit refund or any other Billing ledger mutation that changes remaining Credits or Plan page capacity.
- Credit refund invalidation should be emitted only when the refund operation records a new or existing effective refund state that changes or confirms Workspace capacity, not for compensation calls that find no refundable reservation.
- Emit billing-entitlement invalidation after successful Plan changes, No-billing mode changes, Plan overrides, Enterprise deal term changes, scheduled subscription change cancellation, subscription cancellation, and Stripe billing event processing that changes Workspace billing state.
- Emit member-limit invalidation after accepted Workspace membership count can change, including Workspace invitation acceptance, member removal, Leave Workspace, and Workspace member actions that affect access.
- Emit invalidation only after the durable mutation has succeeded.
- Failed mutations should not emit invalidation unless they performed a compensating mutation such as a Credit refund.
- Replace the current frontend behaviour where any live **Extraction job** lifecycle message schedules Workspace capacity refresh.
- Keep live **Extraction job** lifecycle messages updating Documents UI state.
- Add a frontend Workspace live update parser that returns recognized **Extraction job** lifecycle events separately from Workspace context invalidation events.
- Unknown live update event types should be ignored safely.
- Malformed live update payloads should be ignored safely.
- Add a throttled Workspace context refresh scheduler for live invalidations.
- The scheduler should allow a quick refresh for the first invalidation after an idle period.
- The scheduler should enforce a minimum interval between automatic live-triggered Workspace context refreshes.
- The scheduler should remember dirty state during the throttle window and run a trailing refresh after the window when needed.
- A reasonable first throttle target is one immediate or near-immediate refresh followed by at most one trailing refresh every several seconds during a burst.
- Local foreground actions may request a prompt Workspace context refresh using the existing Workspace controller refresh path, but this should be separate from high-volume live invalidation handling.
- Keep reconnect behaviour consistent with the existing ADR: clients should revalidate over HTTP after reconnecting because Workspace live updates are not durable history.
- The frontend should guard live update handlers so events from a stale websocket do not mutate state after the accepted Workspace context changes.
- The frontend should keep **Billing operational status** advisory: final backend enforcement still happens at Document submission after exact Billable Document page count is known.
- No database schema change is required for the basic invalidation event because it is not durable history.
- No public REST API contract change is required beyond the existing Workspace live update websocket message shape.
- The new live update event shape may be represented as:

```ts
type WorkspaceContextInvalidationReason =
  | "billing_usage"
  | "billing_entitlement"
  | "template_limits"
  | "member_limits"
  | "workspace_access";

type WorkspaceContextInvalidatedEvent = {
  type: "workspace_context_invalidated";
  reason: WorkspaceContextInvalidationReason;
  occurred_at: string;
};
```

## Testing Decisions

- Good tests should assert externally visible behaviour: live messages update Documents UI, invalidation messages trigger bounded Workspace context refreshes, and header badges become fresh after the frontend receives recomputed Workspace context.
- Tests should avoid asserting private timer internals, exact implementation helper names, or direct Durable Object socket-loop details.
- Add backend tests for the selected Workspace context refresh path. They should verify it returns the current accepted Workspace context data needed by the frontend without pending invitations or unrelated Workspaces.
- Add backend tests proving the selected Workspace context refresh path and Workspace listing path share **Billing operational status** semantics for the same Workspace.
- Add frontend tests proving live invalidation uses selected Workspace context refresh in the common case and does not fetch invitations or the full Workspace list.
- Add frontend tests proving forbidden/not-found selected Workspace context refresh falls back to the existing access-recovery/full Workspace-list path.
- Add focused frontend tests for the Workspace live update parser. They should cover valid job lifecycle events, valid Workspace context invalidation events, mixed event batches, unknown event types, malformed JSON, unsupported envelope versions, and missing fields.
- Add focused frontend tests for the throttled Workspace context refresh scheduler. They should prove bursts coalesce, a trailing refresh happens, and the scheduler does not fire when no refresh callback exists.
- Add frontend controller tests proving job lifecycle events update **Extraction job** state without directly triggering Workspace context refresh.
- Add frontend controller tests proving Workspace context invalidation events trigger the throttled Workspace context refresh path.
- Add frontend tests proving stale websocket events are ignored after accepted Workspace context changes or socket replacement.
- Add frontend tests proving Workspace access invalidation causes immediate revalidation and prevents further useful live update effects until revalidation succeeds.
- Add frontend tests proving upload-blocking badges render from refreshed **Billing operational status** rather than live event payload contents.
- Add backend live update tests proving session identity is stored only as connection metadata and is not included in websocket message payloads.
- Add backend live update tests proving member-removal or Leave Workspace closes known affected sockets when the live-update transport has enough identity metadata.
- Add backend live update tests proving Workspace access revalidation invalidation can be emitted when exact socket closure is not available.
- Add backend tests for the Workspace live update broadcaster envelope. They should verify invalidation events use the versioned batch format and do not include computed billing values.
- Add backend tests for Template mutations proving successful create, delete, and schema update emit Template-limit invalidation after durable mutation.
- Add backend tests for Template mutation failures proving no invalidation is emitted when no durable state changed.
- Add backend tests for Document submission proving successful Credit reservation and accepted queueing emit billing-usage invalidation.
- Add backend tests proving failed submissions that reserve and then refund Credits do not emit accepted-submission invalidation before the failure, but do emit refund invalidation when the refund changes capacity.
- Add backend tests for Document submission compensation proving Credit refund paths emit billing-usage invalidation when refund state changes.
- Add backend billing tests proving successful Application admin billing changes emit billing-entitlement or billing-usage invalidation as appropriate.
- Add backend Stripe billing event tests proving processed events that change Workspace billing state emit billing invalidation, while ignored irrelevant events do not.
- Add backend Workspace membership tests proving member-count-affecting actions emit member-limit invalidation after successful mutation.
- Add tests proving Workspace API keys still cannot open Workspace live updates.
- Existing frontend app tests around billing blockers and upload disabling are useful prior art for verifying refreshed **Billing operational status** presentation.
- Existing backend Product Store Durable Object tests are useful prior art for verifying Workspace live update message emission.
- Existing billing tests are useful prior art for checking Credit reservation, Credit refund, Plan changes, Goodwill Credit grants, No-billing mode, and Stripe event processing.
- Run backend typecheck after implementation.
- Run frontend production build after implementation.
- Because the repo has no general test or lint scripts, use focused frontend/backend test commands that match the touched areas rather than inventing new global scripts.

## Out of Scope

- Pushing computed **Billing operational status** badge strings over Workspace live updates.
- Pushing remaining Credit counts, remaining Plan page capacity, invoice details, payment details, or owner-only billing state over Workspace live updates.
- Making Workspace live updates a durable event log.
- Replacing HTTP Workspace context refresh with websocket-sourced state.
- Adding a global D1 projection of Workspace product data.
- Moving the Billing ledger into the Product Store Durable Object.
- Changing Workspace billing product rules, Plan limits, Credit pricing, Credit pack sizes, or Enterprise commercial terms.
- Changing final backend enforcement for Document submission, Template Plan limits, member Plan limits, or Billing ledger reservations.
- Adding a new user-facing notification toast for every invalidation.
- Refreshing Workspace context for local draft edits, navigation, Template selection, or ordinary list reads.
- Implementing a full observability dashboard for live-update throughput.
- Solving offline browser synchronization beyond existing HTTP revalidation on reconnect.
- Changing the Workspace live update authentication model to support Workspace API keys.

## Further Notes

- This PRD intentionally follows the existing ADR direction that **Workspace live updates** are not durable history and that clients revalidate over HTTP after reconnecting.
- The design preserves the existing Durable Object boundaries: Workspace product data remains in the Product Store Durable Object, and the Billing ledger remains a separate Durable Object.
- The new invalidation event is a freshness hint. The user-facing truth remains the backend Workspace context response.
- The likely first implementation can reuse the Product Store Durable Object as the websocket transport while keeping invalidation emission behind a narrow helper, so future transport changes do not require every mutation path to know the Durable Object details.
- The highest-risk current behaviour to fix is the implicit Workspace context refresh on every live **Extraction job** lifecycle event.
- The highest-value missing freshness path is Template create, delete, and schema update changing Plan limit overage badges.
- The backend and frontend domain docs should be updated as part of implementation. The existing **Workspace live update** language currently focuses on **Extraction job lifecycle** changes, and this PRD expands the protocol to also carry Workspace context invalidation hints.
- If maintainers want to keep **Workspace live update** narrowly scoped to changed Workspace product data, introduce and document a separate term such as **Workspace context invalidation** for the new event family.
