# Set the implementation-ready verification contract

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 03, 04, 05, 06, 07

## Question

Which acceptance scenarios and evidence are required before the later implementation can be considered complete and safe to hand off?

Cover blank creation and cutover, role enforcement, cross-Workspace isolation, credential encryption and redaction, machine-secret loss and recovery, submission `409`/`503` with no Source-file/job side effects, configuration replacement and clearing, stale-revision conflicts, the transient connection-test contract and redaction, queued/in-flight/retry behaviour, hard erasure, backup/export boundaries, restart recovery, UI states, removal of global fallbacks and managed-file behavior, and the root Bun check surface. Gateway processing will be confirmed manually by the user; a new gateway-backed or concurrent two-Workspace integration suite is not required.

Include the resolved [blank-state cutover contract](07-define-blank-state-global-configuration-cutover.md): repeated migration preserves subsequently saved configuration; legacy-file cleanup is idempotent and its failure only warns; retired environment variables cannot configure a Workspace or leak their values through warnings; the removed global endpoint returns `404`; operational controls remain supported; and upgrade recovery cannot fall back to global settings. Verify the approved expandable Workspace section without the separate readiness banner. Rollback and downgrade support are out of scope, while current-version backup/restore remains in scope.

## Comments

### Initial verification-surface inspection

- Root commands already expose typechecking, Bun backend tests, Vitest frontend tests, a production build, and a separate Playwright end-to-end suite.
- `backend/src/localRuntimeSmoke.bun.test.ts` already launches the real Bun server against temporary local state and a loopback `chat/completions` stub, then exercises sign-up/sign-in, Workspace access, Document submission, persisted completion, and live updates.
- That smoke test currently supplies gateway settings through environment variables. The later implementation must configure its test Workspace through the new authenticated Workspace resource instead; retaining environment setup would conflict with the agreed cutover.
- No tests or production changes have been implemented or run as part of this planning ticket.

### Agreed: external-provider verification boundary

The user initially agreed to local stubs and dummy credentials, then clarified that gateway integration testing is unnecessary and they will confirm processing manually. Required new automated checks may use mocked outbound requests and disposable local state; they need not run a gateway or require real provider credentials or paid model calls. Gateway-backed integration is not an automated acceptance gate. This concerns implementation verification; it does not remove or expand the product's already-agreed single-request Model gateway connection test.

### Declined: mandatory concurrent gateway integration coverage

The current runner suite tests dynamic app-wide configuration and persisted model/route metadata, but injects the extraction function in that scenario. Recovery tests cover multiple Workspace stores. Neither inspected scenario establishes that concurrent Workspaces send the correct credentials and model to their own gateway over HTTP.

The proposed mandatory concurrent two-Workspace HTTP gateway scenario was declined: "Not needed, we don't need to test against an actual gateway I will confirm it works." Do not require this new integration suite or make implementation handoff depend on gateway-backed evidence. Local access-isolation and configuration-selection checks can use mocks. This does not direct removal of unrelated existing smoke tests, which still need to remain compatible with the new configuration contract.

### Agreed: local automated safety checks

The user agreed to required local coverage of configuration create/update/clear and owner/admin/member access rules; blank configuration returning `409` and unreadable credentials returning `503` before Source-file/job side effects; and encrypted, write-only credential handling with redaction. Use temporary local stores and mocked model calls, without requiring a running gateway.

### Agreed: completion gate

The current CI runs `bun run ci:quality` (typechecking, lint, backend/frontend tests, existing frontend coverage checks, and build) and `bun run test:e2e`. The existing browser journey already uses a loopback fake gateway, temporary state, and network isolation. Its fixture currently relies on retired gateway environment variables and will need to use the Workspace configuration contract. These existing checks do not require a real provider.

The user confirmed the complete verification contract: pass the focused local safety checks above and preserve the existing CI checks, adapting existing smoke/browser fixtures to Workspace setup without adding a new gateway/concurrency suite. Also perform a brief manual walkthrough of the implemented B layout, covering setup, write-only key replacement, clearing, and member visibility. Leave real-gateway processing confirmation to the user and report it separately from automated results. No additional gateway-backed test suite or new testing framework is required.

## Answer

Verification is deliberately local and proportionate. Required new automated coverage uses disposable local stores, dummy credentials, and mocked model requests. The user will confirm real Model gateway processing manually; do not require real provider credentials, paid model calls, or a new gateway-backed/concurrent two-Workspace integration suite for handoff.

### Required local safety coverage

- Configuration creation, update, and whole-configuration clearing, with the owner/admin/member access rules from the resolved [HTTP contract](04-define-workspace-model-configuration-http-contract.md).
- An absent configuration returns `409 workspace_model_not_configured`, and an unreadable credential returns `503 workspace_model_configuration_unavailable`, before Source-file or Extraction-job side effects.
- Credentials are encrypted at rest, remain write-only through product interfaces, and obey the agreed redaction rules. Use temporary state and dummy values, never real operator credentials or the operator's local databases.

The detailed expected behavior remains in the resolved authority, lifecycle, processing, HTTP, compatibility, UI, and cutover tickets. Preserve relevant existing regression coverage and adapt focused mocked tests when those interfaces change; this contract does not require a separate new integration suite for every scenario in the original question. It does not change the product's optional single-request Model gateway connection test.

### Existing project checks

Pass `bun run ci:quality` and `bun run test:e2e`. These retain the existing typecheck, lint, backend/frontend tests, frontend coverage checks, production build, and browser journey. Existing loopback-stub smoke/browser tests remain supported and must be adapted to configure Workspaces through the new authenticated resource instead of retired gateway environment variables. No new testing framework or gateway/concurrency suite is required.

### UI and handoff evidence

Perform a brief manual walkthrough of the implemented B layout: Workspace setup, write-only key replacement, clearing, and member visibility, with status in the expandable section header and no separate readiness banner. This checks the implemented UI, not only the throwaway prototype.

Report the focused test results, existing project-check results, and UI walkthrough outcome. Report real-gateway processing separately as awaiting the user's confirmation until the user supplies it; mocked or stubbed success is not evidence of real-provider verification. The user-owned check is not a prerequisite for handing back the implementation and its local verification results.

Rollback/downgrade testing is out of scope. Current-version backup/restore and the other resolved product contracts remain unchanged. This ticket defines later acceptance evidence only; no production changes or implementation tests were run during its resolution.
