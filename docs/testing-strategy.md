# Testing strategy

Tests should protect behavior that matters to a user or an operator. A test is
worth keeping when its failure explains a real regression and the test remains
valid after the implementation is refactored without changing that behavior.

## Preferred test seams

1. **Browser journeys** cover workflows that a person can complete in the SPA.
   They use the built frontend, Bun server, Better Auth, SQLite, and filesystem
   together. Only the external model gateway is replaced with a deterministic
   local boundary.
2. **HTTP integration tests** cover API behavior, policy, error contracts, and
   cases that are impractical to express through the browser.
3. **Focused domain tests** cover complex state transitions, parsing, security,
   concurrency, and failure recovery where a narrower seam makes the expected
   rule clearer.

Prefer real repositories, databases, files, routes, and auth flows. Replace a
dependency only at an external or nondeterministic system boundary, such as the
model gateway, time, or a resource signal that cannot be reproduced reliably.

## User-journey coverage

| Journey | Browser coverage | Supporting coverage |
| --- | --- | --- |
| Sign-up, verification, profile, Workspace Model gateway setup/replacement/clear, sign-out, password reset, sign-in | `e2e/accountRecoveryJourney.spec.ts` | Better Auth and Workspace model-configuration HTTP tests |
| Workspace creation, settings, API-key rotation, invitations, roles, leaving, deletion | `e2e/workspaceCollaborationJourney.spec.ts` | Workspace policy and storage tests |
| Template editing, upload, extraction, live updates, export, document and template deletion | `e2e/extractionJourney.spec.ts` | Job orchestration, persistence, and recovery tests |
| Admin search, role changes, banning, and impersonation | `e2e/applicationAdminJourney.spec.ts` | Admin authorization tests |

## Tests to avoid

- Assertions about source text, package-script text, exact CSS implementation,
  internal call order, or callback/mock call counts when visible behavior can be
  asserted instead.
- Tests whose only useful assertion is that a function did not throw.
- Tests that restate the configured mock rather than exercise production code.
- Duplicate component tests for behavior already protected by a browser journey
  or a clearer public-seam test.

Negative assertions on an external boundary remain useful when they enforce a
security or validation rule, for example proving invalid input never reaches a
model gateway.

## Commands

- `bun run test` runs backend and frontend integration/unit suites.
- `bun run --cwd frontend test:coverage` enforces the manually maintained
  frontend coverage floor. Browser coverage is not included in V8's unit-test
  report, so the baseline is adjusted only when a deliberate suite change is
  reviewed; it must never update itself.
- `bun run test:e2e` builds the SPA and runs the real browser journeys.
- `bun run ci:quality` runs the platform-neutral typechecking, linting, test,
  coverage, and build checks used by the Ubuntu/macOS quality matrix.
- `bun run ci` adds the browser journeys for a complete local verification. In
  GitHub Actions those journeys run once in the separately provisioned
  Ubuntu-only browser job.
