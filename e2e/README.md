# Browser journey

This lane proves the production-built SPA, Local Bun Runtime, auth cookies,
Local mail verification, Workspace live updates, Document upload, extraction
worker, fake Model gateway, and rendered results as one Chromium journey.

Run it from the repository root with the pinned runtime:

```sh
bunx bun@1.4.1 run build
bunx bun@1.4.1 x playwright install chromium
bunx bun@1.4.1 run test:e2e
```

The test owns a loopback fake gateway and temporary Local Runtime state. Browser
HTTP is isolated to loopback; external stylesheet requests are fulfilled with an
empty local response so the journey never depends on the public network. The
harness validates Bun 1.4.1, uses the Local mail JSONL record to verify the
account, and removes its state directory after its child runtime exits.

Agent-readable evidence is written to `.scratch/ci/playwright/evidence`, while
the HTML report is under `.scratch/ci/playwright/report`. Failed runs additionally
retain the Playwright trace and automatic screenshot under
`.scratch/ci/playwright/results`. Network evidence contains only method, status,
resource type, and query-free URL metadata; Workspace frames contain only event
type, job ID, and status.
