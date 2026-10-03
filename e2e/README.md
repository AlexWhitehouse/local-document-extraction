# Browser tests

Playwright tests run the real app in Chromium. They use the production frontend build and Bun server. They cover sign-in, email verification, live updates, uploads, and extraction. A fake gateway replaces the AI model. The tests do not call a real model.

## Run them

For the first run, install Chromium from the repository root:

```bash
bunx playwright install chromium
```

Run the browser tests:

```bash
bun run test:e2e
```

This command builds the frontend and runs every journey in `e2e/*.spec.ts`. To run one journey, build the frontend first:

```bash
bun run build
bunx playwright test e2e/extractionJourney.spec.ts
```

The tests require the Bun version specified in `package.json`. If your version differs, use the specified version. For example, run `bunx bun@1.4.2 run test:e2e`.

## What the harness does

- Starts the app on loopback with a new temporary data folder.
- Deletes that folder after the tests.
- Runs a fake model gateway on loopback.
- Verifies accounts through locally captured email.
- Blocks browser access to the public internet. External stylesheet requests receive an empty response.

## Results

| Location | Contents |
| --- | --- |
| `.scratch/ci/playwright/report` | HTML report. Open it with `bunx playwright show-report .scratch/ci/playwright/report`. |
| `.scratch/ci/playwright/results` | Trace and screenshot for each failed test. |
| `.scratch/ci/playwright/evidence` | Structured run summaries for tools. |

Evidence files exclude sensitive content. Network entries contain only the method, status, resource type, and URL without its query string. Live-update entries contain only the event type, job ID, and status.
