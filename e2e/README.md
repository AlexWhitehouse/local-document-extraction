# Browser tests

These Playwright tests drive the real app in Chromium: the production frontend build, the Bun server, sign-in, email verification, live updates, uploads, and extraction. The AI model is replaced with a fake gateway, so no real model is called.

## Run them

From the repository root, the first time:

```bash
bunx playwright install chromium
```

Then:

```bash
bun run test:e2e
```

This builds the frontend and runs every journey in `e2e/*.spec.ts`. To run one, build first and then call Playwright directly:

```bash
bun run build
bunx playwright test e2e/extractionJourney.spec.ts
```

The tests check that the Bun version matches the one pinned in `package.json`. If yours differs, run through the pinned version, for example `bunx bun@1.4.2 run test:e2e`.

## What the harness does

- Starts the app on loopback with a fresh, temporary data folder, and deletes it afterwards.
- Runs a fake model gateway on loopback.
- Verifies accounts by reading the locally captured emails.
- Keeps the browser off the public internet: external stylesheet requests get an empty response.

## Results

| Location | Contents |
| --- | --- |
| `.scratch/ci/playwright/report` | The HTML report. Open it with `bunx playwright show-report .scratch/ci/playwright/report`. |
| `.scratch/ci/playwright/results` | The trace and screenshot for each failed test. |
| `.scratch/ci/playwright/evidence` | Structured summaries of each run, for tooling. |

The evidence files avoid recording anything sensitive. Network entries include only the method, status, resource type, and URL without its query string. Live-update entries include only the event type, job ID, and status.
