# Backend

The backend is a single Bun server. It serves the web app, the `/v1` API, the Better Auth routes under `/api/auth`, and the WebSocket that pushes live updates to the browser. By default it runs at http://127.0.0.1:8787.

For installing and running the app, start with the [root README](../README.md) and [Contributing](../CONTRIBUTING.md). This page explains how the backend works.

## Running it

From the repository root:

```bash
bun install --frozen-lockfile
bun run migrate     # safe to run repeatedly
bun run build       # builds the frontend the server will serve
bun run start       # or `bun run dev` to restart on code changes
```

Every setting is read and validated in one place, [`src/localConfiguration.ts`](src/localConfiguration.ts). Startup, `bun run migrate`, and `bun backend/src/checkConfiguration.ts` all use it. The settings themselves are documented in [docs/configuration.md](../docs/configuration.md) and [`.env.example`](../.env.example). The frontend reads public settings, such as enabled sign-in methods and the upload limit, from `GET /v1/config`, so changing them needs a restart, not a rebuild.

## How requests are handled

| Activity | Handled by | Access |
| --- | --- | --- |
| Sign-in and account actions | Better Auth (`src/localAuth.ts`) | Browser |
| Automatic Workspace progress updates | `src/localLiveUpdateUpgrade.ts` | Signed-in Workspace member |
| Template assistant and document review | `src/localApplication.ts`, `src/localDocumentProcessingHttp.ts` | Signed-in Workspace member |
| Workspace API integrations | `src/localApplication.ts` | `Authorization: Bearer <workspace API key>` |
| Frontend page and asset reads (`GET`/`HEAD`) | Built frontend files, with fallback to `index.html` | — |

Workspace API keys reach templates, sample-based template generation, document submission, extraction jobs, and document packet reads/deletion. See the [Workspace API specification](../mkdocs/docs/api/overview.md) for integration requests. In the browser, use **Templates → Assistant** for [draft assistance](../docs/template-assistant.md), **Documents** for [held-document review](../mkdocs/docs/usage/document-extraction.md#progress-and-review), and **Workspaces** for membership, invitations, and model settings. Account and admin actions also take place in the app.

When a document is submitted, it's checked, stored, and queued as a job (`src/localMultipartSubmission.ts`, `src/localExtractionQueue.ts`). A runner (`src/localExtractionRunner.ts`) picks jobs up, prepares the document for the model, calls the Workspace's model gateway (`src/consumer/modelGateway.ts`), and saves the normalised results. `src/localDocumentProcessingRunner.ts` uses the same durable queue for tag-scoped classification and PDF packet splitting before field extraction. Splitting commits fixed child IDs and original-page maps before creating independent derived sources; automatic jobs bind a checked Template version before extraction. Both stages stop after one initial assessment and at most two targeted reassessments, holding unresolved work for manual resolution. Browsers are told about changes over the live-update WebSocket; API clients poll the returned job or packet location, discover packet children, and fetch each job for full results. Even an accepted one-document PDF split retains its packet API identity; collapsing it to one ordinary Document is a frontend presentation rule.

## Local data

`bun run migrate` creates the control database, the Better Auth tables, the session-signing secret, and the data folders. It's safe to run more than once. Each Workspace's own database is created the first time it's used.

By default everything lives in `.local/`:

| Path | Contents |
| --- | --- |
| `data/control.sqlite` | Accounts, sessions, Workspaces, members, invitations, and API key hashes. |
| `data/workspaces/*.sqlite` | One database per Workspace: templates/tags, jobs/results, document packets and split plans, processing settings, and its encrypted model credential. |
| `data/better-auth-secret` | Key that signs sessions. |
| `secrets/model-gateway.key` | Key that encrypts model credentials. Created the first time a credential is saved. |
| `source-files/` | Uploaded documents, kept only while they're needed. |
| `mail/YYYY-MM-DD.jsonl` | Captured verification and password-reset emails, when email isn't sent through Cloudflare. |
| `analytics/YYYY-MM-DD.jsonl` | Local usage events (see [Analytics](#analytics)). |

The two key files must stay with the databases. A Workspace database restored without `secrets/model-gateway.key` keeps its model settings, but the credential has to be entered again. Exports, analytics, diagnostics, and live updates never include credentials, encrypted or not.

Deleting `.local/` deletes every account, Workspace, and result. For backups, see [Backing up and restoring](../docs/setup.md#backing-up-and-restoring).

## Workspace model gateway

Each Workspace has its own model settings. New Workspaces, including ones upgraded from the old global settings, start with none. An owner or admin sets them up under **Workspaces → Model gateway → Set up**:

- **Gateway URL** and **model name.** Any HTTP(S) address works, including private and local ones. Redirects are refused.
- **Gateway credential.** This is the key the app uses to call the model, which is different from the Workspace API key that clients use to call the app. It's write-only: leave it blank when editing to keep the saved one.
- **Capability switches** (all off by default):
  - **Direct PDF input** sends PDFs to the model as they are. Without it, pages are rendered as images.
  - **Structured output** asks the model for JSON matching the template.
  - **Sequential calls** stops the Workspace from making more than one model call at a time.

**Document classification & splitting** is a third optional role alongside Extraction and Template assistant. It inherits Extraction by default, or uses its own model and capability flags on the shared gateway. Classification receives only eligible Template IDs, names, and descriptions, plus the actual source. Field schemas are reserved for extraction. **Enable smart splitting** and **Exclude blank pages** are Workspace settings, both off by default; exclusion only operates as part of splitting.

Model routes can impose document and image-count limits below the runtime limits. Assessment sends selected PDF pages in one request, either directly or as page images according to the chosen role’s capabilities; it does not automatically batch requests around provider limits.

**Test connection** is optional. It sends one `chat/completions` request per distinct configured model with the prompt "Reply with OK.", waits up to 30 seconds without retrying, and checks for a readable reply. It doesn't check capabilities or save anything, and saving doesn't contact the gateway.

Until a Workspace is set up, document uploads get `409 workspace_model_not_configured`. If the saved credential can't be decrypted, they get `503 workspace_model_configuration_unavailable`. Both checks happen before the upload is stored or a job is created.

Each extraction attempt uses the latest saved settings. Changing or clearing the settings doesn't stop an attempt already in progress.

Under **Workspaces → Model gateway**, members can see whether a model is configured. Owners and admins can view its non-secret settings, edit or clear the configuration, and test a draft. If someone else changes the settings while you edit, reload them before saving. Other open browsers refresh after a saved change.

The old global model environment variables are ignored, and startup logs any it finds by name (see [configuration](../docs/configuration.md#model-settings-are-per-workspace)). On startup, a leftover `data/model-gateway.json` from old versions is deleted without being read.

## Built-in protections

The runtime limits how much work it takes on, so a busy or small machine degrades gracefully instead of running out of memory.

### Uploads

The file limit (`MAX_SOURCE_FILE_BYTES`) and the request limit are separate. A document request may be up to the file limit plus 40 KiB for the form fields and multipart framing. A maximum-size browser upload measured about 25 KB of framing.

Oversized requests are rejected with `400 source_file_too_large` before anything is stored. Checks happen in this order: authorization, Workspace storage, model settings, then the `Content-Length` header. Uploads without a length are counted as they stream. Bun's own hard limit sits a further 40 KiB above that, so the app can always send its own error first.

PDFs are inspected in a separate, short-lived process with strict limits on size, decoding, and time. PDF subset creation, child materialization, previews, and blank verification also use disposable processes with bounded output and cancellable deadlines (see [configuration](../docs/configuration.md#uploads-and-extraction)).

### Memory pressure

When the operating system reports memory pressure, the resource controller reacts straight away:

- **Warning:** halves the number of extractions running at once (never below one) and refuses new uploads at or above `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES`.
- **Critical:** pauses new extractions, refuses all new uploads, and closes idle Workspace databases.

Work already in progress is never cancelled. Normal service resumes after three samples in a row show enough memory and event-loop headroom. `/v1/health` diagnostics show the current and last pressure level and recovery times, and never include Workspace or document content.

Memory for preparing documents is budgeted up front. Split subsets are created after admission, and fan-out holds its shared memory reservation until derived files are persisted. By default the budget is 72% of physical RAM, leaving room below the 80% memory threshold. It's an estimate, not an operating-system limit, so lower it on machines shared with a local model server.

### Live updates

The live-update WebSocket only sends to the browser: any message the browser sends closes the connection with code 1008. Messages over 64 bytes are cut off by Bun, which the browser sees as code 1006. Quiet connections stay open for five minutes, with automatic pings.

Each connection can have at most 64 KiB of unsent data. It's closed when it reaches that limit, and messages aren't queued for retry. Diagnostics include only aggregate counts, never Workspace IDs or message content.

## Transactional email

With `EMAIL_PROVIDER=local` (the default), verification and password-reset emails aren't sent. Their links are written to the server log and to `mail/YYYY-MM-DD.jsonl`, and installer users can read them with the launcher's `mail` command.

With `EMAIL_PROVIDER=cloudflare`, emails are sent through Cloudflare's Email REST API and aren't saved locally. See [Send email with Cloudflare](../docs/configuration.md#send-email-with-cloudflare).

Workspace invitations appear inside the app and are never emailed. The frontend only offers the sign-in and verification options that are actually configured.

## Analytics

When `LOCAL_ANALYTICS_ENABLED=true` (the default), template changes, document submissions, and extraction outcomes are written to `.local/analytics/YYYY-MM-DD.jsonl`. These files contain IDs and a little metadata only: no emails, API keys, file names, document contents, or extracted answers. Nothing is sent anywhere.

## Tests

From the repository root, `bun run test` runs the backend and frontend suites. Backend-only commands, run from `backend/`:

| Command | Use it to |
| --- | --- |
| `bun run test` | Run the whole backend suite, then the full-app smoke test. |
| `bun run test:agent [file] [-t name]` | Run tests with quiet output: only failures and the summary are shown. |
| `bun run test:target <filter>` | Run matching tests, stopping at the first failure. |
| `bun run test:bun:changed` | Run tests affected by changes since `HEAD` (or `BUN_CHANGED_BASE`). |
| `bun run test:evidence` | Run the full suite serially in a fixed order, writing JUnit, timings, and coverage to `.scratch/ci/backend/`. This is the CI lane. |
| `bun run test:bun:flake` | Rerun the suite in random orders to find flaky tests. Reproduce a run with the command it prints, e.g. `BUN_TEST_SEED=90909 BUN_TEST_RERUNS=20 bun run test:bun:flake`. |

From the root, `bun run check:agent` runs typecheck, lint, backend tests, and frontend tests side by side and reports every result.

The backend coverage floor is in `backend/coverage-baseline.json`. Nothing updates it automatically; raise it by hand when coverage improves.

## Benchmarks

The benchmarks compare approaches on your machine. Their results are useful for spotting regressions, not as capacity guarantees. Run them from `backend/`. Most write a Markdown report under `.scratch/`.

| Command | Measures |
| --- | --- |
| `bun run benchmark:static-assets` | Serving frontend files lazily with `Bun.file()`, compared with buffering them in memory. Tune with `STATIC_ASSET_BENCH_BYTES`, `_CONCURRENCY`, and `_ROUNDS`. |
| `bun run benchmark:memory-pressure` | Behaviour under simulated memory-pressure events, with the policy on and off. It never actually exhausts memory. |
| `bun run benchmark:document-body-limit` | A real server under oversized and aborted uploads: responses, latency, memory, and leftover files. |
| `bun run benchmark:live-update-fanout` | The cost of sending live updates to many subscribers inside the hub. Network and browser time aren't included. |
| `bun run benchmark:loopback-saturation` | Extraction throughput against a local fake gateway that can throttle, fail, or time out, sending PDFs inline or as rendered pages. |
| `bun run benchmark:model-payload-base64` | Encoding documents for model requests. |
| `bun run benchmark:test-parallel` | Running the test suite in parallel compared with serially. |
| `bunx bun@1.4.0 run benchmark:bun-runtime` | Full extraction throughput on Bun 1.4 compared with 1.3.14. It fails if 1.4 is more than 10% slower, adds more than 15% to p95 job time, or fails a job. |
