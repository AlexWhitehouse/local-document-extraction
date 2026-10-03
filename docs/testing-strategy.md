# Testing strategy

Tests must fail when behavior required by a user or operator breaks. They must still pass after refactoring that preserves that behavior. This guide describes test selection and commands.

## Which kind of test to write

Select the broadest level that clearly verifies the behavior:

1. **Browser journeys** (`e2e/`) verify workflows in the app. They run the built frontend, Bun server, Better Auth, SQLite, and filesystem together. Only the model gateway uses a fake.
2. **HTTP integration tests** (`backend/src/*.bun.test.ts`) verify API behavior, permissions, and errors. They also cover cases that are difficult to reach in a browser.
3. **Focused tests** verify complex state changes, parsing, security rules, concurrency, and recovery. Use them when a smaller test makes the rule clearer. Frontend component and hook tests use `*.test.js(x)` files beside the code.

Use real databases, files, routes, and sign-in where possible. Replace external dependencies only when they cannot run reliably in a test. Examples include the model gateway, clock, and operating-system memory-pressure signals.

## What the browser journeys cover

| Journey | Spec | Backed up by |
| --- | --- | --- |
| Sign up, verify, edit profile, set up / replace / clear the Workspace model, sign out, reset password, sign in | `accountRecoveryJourney.spec.ts` | Auth and model-settings HTTP tests |
| Create a Workspace, rename it, rotate its API key, invite people, change roles, leave, delete | `workspaceCollaborationJourney.spec.ts` | Workspace permission and storage tests |
| Edit a template, upload, extract, see live updates, export, delete documents and templates | `extractionJourney.spec.ts` | Job queue, storage, and recovery tests |
| Generate a template from a sample, review it, save it | `templateGenerationJourney.spec.ts` | Template generation HTTP tests |
| Request a focused Template edit, review its output key, apply once, then save explicitly | `templateAssistantJourney.spec.ts` | Assistant HTTP, shared contract, diagnostics, and request lifetime tests |
| Create, assign, rename, detach, and delete shared Template tags while preserving field versions | `templateTagsJourney.spec.ts` | Tag HTTP, persistence, multipart validation, and draft lifetime tests |
| Set up, run, and score a model Evaluation | `evaluationJourney.spec.ts` | Evaluation execution and scoring unit tests |
| Save a verified document to the Evaluation library, reuse it in a Batch Evaluation and update its saved answers | `evaluationLibraryJourney.spec.ts` | Library persistence, recovery and batch runner tests; saved answer sets, result cache and controller unit tests |
| Verify date formats and table cell statuses, then save and reuse expected answers | `evaluationExpectedAnswers.spec.ts` | Reference editor, scoring, saved answer set and backend reference validation tests |
| Follow the optional onboarding tour | `onboardingTour.spec.ts` | Onboarding component tests |
| Search users, change roles, ban, and impersonate as an Application admin | `applicationAdminJourney.spec.ts` | Admin permission tests |

## Tests to avoid

- Tests of source text, `package.json` script text, or exact CSS when visible behavior can be verified instead.
- Assertions about internal call order or mock-call counts when visible behavior can be verified instead.
- Tests that only confirm the absence of an exception.
- Tests that only verify the mock's configured behavior.
- Component tests that repeat a browser journey or a clearer higher-level test.

Negative checks remain useful for security and validation rules. For example, invalid input must never reach the model gateway.

## Commands

| Command (from the root) | What it runs |
| --- | --- |
| `bun run test` | Backend and frontend test suites. |
| `bun run --cwd frontend test:coverage` | Frontend tests, failing if coverage drops below `frontend/coverage-baseline.json`. |
| `bun run test:e2e` | Builds the frontend and runs the browser journeys (see [e2e/README.md](../e2e/README.md)). |
| `bun run ci:quality` | Typecheck, lint, tests, frontend coverage, and build: what CI runs on Ubuntu and macOS. |
| `bun run ci` | `ci:quality` plus the browser journeys. In GitHub Actions the journeys run separately, on Ubuntu only. |

The [backend README](../backend/README.md#tests) lists backend commands for quiet output, changed-file tests, and repeated tests that detect intermittent failures.

## Coverage floors

`frontend/coverage-baseline.json` and `backend/coverage-baseline.json` define fixed minimum coverage. These limits do not update automatically.

When coverage improves, increase the limits manually. Decrease them only through a reviewed decision, such as removal of tests for deleted code. Browser journeys do not contribute to these measurements. Actual behavior coverage can therefore exceed the reported minimum.
