# Testing strategy

A good test fails when something a user or operator relies on breaks, and keeps passing when the code is refactored without changing that behaviour. This page explains which kind of test to write and how to run each kind.

## Which kind of test to write

Pick the widest level that can express the behaviour clearly:

1. **Browser journeys** (`e2e/`). Workflows a person completes in the app. They run the built frontend, the Bun server, Better Auth, SQLite, and the filesystem together. Only the model gateway is faked.
2. **HTTP integration tests** (`backend/src/*.bun.test.ts`). API behaviour, permissions, error responses, and cases that are awkward to reach through the browser.
3. **Focused tests.** Complex state changes, parsing, security rules, concurrency, and failure recovery, where testing a smaller piece makes the rule clearer. Frontend component and hook tests live next to the code as `*.test.js(x)`.

Use real databases, files, routes, and sign-in wherever you can. Only replace something at a genuine outside boundary that can't be made reliable: the model gateway, the clock, or operating-system signals such as memory pressure.

## What the browser journeys cover

| Journey | Spec | Backed up by |
| --- | --- | --- |
| Sign up, verify, edit profile, set up / replace / clear the Workspace model, sign out, reset password, sign in | `accountRecoveryJourney.spec.ts` | Auth and model-settings HTTP tests |
| Create a Workspace, rename it, rotate its API key, invite people, change roles, leave, delete | `workspaceCollaborationJourney.spec.ts` | Workspace permission and storage tests |
| Edit a template, upload, extract, see live updates, export, delete documents and templates | `extractionJourney.spec.ts` | Job queue, storage, and recovery tests |
| Generate a template from a sample, review it, save it | `templateGenerationJourney.spec.ts` | Template generation HTTP tests |
| Set up, run, and score a model Evaluation | `evaluationJourney.spec.ts` | Evaluation HTTP tests and scoring unit tests |
| Follow the optional onboarding tour | `onboardingTour.spec.ts` | Onboarding component tests |
| Search users, change roles, ban, and impersonate as an Application admin | `applicationAdminJourney.spec.ts` | Admin permission tests |

## Tests to avoid

- Assertions on source code text, `package.json` script text, exact CSS, internal call order, or how many times a mock was called, when you could check visible behaviour instead.
- Tests whose only check is that nothing threw.
- Tests that only check the mock you just set up.
- Component tests that repeat what a browser journey or a clearer higher-level test already covers.

Checking that something *didn't* reach an outside boundary is still worthwhile when it enforces a security or validation rule. For example, invalid input must never be sent to the model gateway.

## Commands

| Command (from the root) | What it runs |
| --- | --- |
| `bun run test` | Backend and frontend test suites. |
| `bun run --cwd frontend test:coverage` | Frontend tests, failing if coverage drops below `frontend/coverage-baseline.json`. |
| `bun run test:e2e` | Builds the frontend and runs the browser journeys (see [e2e/README.md](../e2e/README.md)). |
| `bun run ci:quality` | Typecheck, lint, tests, frontend coverage, and build: what CI runs on Ubuntu and macOS. |
| `bun run ci` | `ci:quality` plus the browser journeys. In GitHub Actions the journeys run separately, on Ubuntu only. |

The [backend README](../backend/README.md#tests) lists the backend-only commands, such as quiet output, changed-file runs, and flaky-test hunting.

## Coverage floors

The coverage floors in `frontend/coverage-baseline.json` and `backend/coverage-baseline.json` are fixed regression gates. They never update themselves. Raise them by hand when coverage genuinely improves, and only lower them as a reviewed decision, for example after deleting tests for removed code. Browser journeys don't count towards these numbers, so a floor can be lower than the real protection the suite gives.
