# Backend

The backend uses one Bun server. It serves the frontend, the `/v1` API, Better Auth under `/api/auth`, and browser progress updates through a WebSocket. The default address is http://127.0.0.1:8787.

To install and run the app, see the [root README](../README.md) and [Contributing](../CONTRIBUTING.md). This page describes backend operation.

## Running it

From the repository root:

```bash
bun install --frozen-lockfile
bun run migrate     # safe to run repeatedly
bun run build       # builds the frontend the server will serve
bun run start       # or `bun run dev` to restart on code changes
```

The shared loader, [`src/localConfiguration.ts`](src/localConfiguration.ts), reads and validates settings. Startup, `bun run migrate`, and `bun backend/src/checkConfiguration.ts` use this loader. See [Configuration](../docs/configuration.md) and [`.env.example`](../.env.example) for setting definitions.

The frontend reads public settings from `GET /v1/config`, including enabled sign-in methods and upload limits. Restart the app after a settings change. A rebuild is unnecessary.

## How requests are handled

| Activity | Handled by | Access |
| --- | --- | --- |
| Sign-in and account actions | Better Auth (`src/localAuth.ts`) | Browser |
| Automatic Workspace progress updates | `src/localLiveUpdateUpgrade.ts` | Signed-in Workspace member |
| Template assistant and document review | `src/localApplication.ts`, `src/localDocumentProcessingHttp.ts` | Signed-in Workspace member |
| Workspace API integrations | `src/localApplication.ts` | `Authorization: Bearer <workspace API key>` |
| Frontend page and asset reads (`GET`/`HEAD`) | Built frontend files, with fallback to `index.html` | — |

Workspace API keys permit template management, sample-based template generation, document submission, extraction job access, and packet reads and deletion. See the [Workspace API specification](../mkdocs/docs/api/overview.md).

Use **Templates → Assistant** for [draft assistance](../docs/template-assistant.md) and **Documents** for [held-document review](../mkdocs/docs/usage/document-extraction.md#progress-and-review). Manage membership, invitations, and model settings in **Workspaces**. Account and admin actions also occur in the app.

Submission validates and stores a document, then queues a job through `src/localMultipartSubmission.ts` and `src/localExtractionQueue.ts`. The runner, `src/localExtractionRunner.ts`, prepares the document and calls the Workspace model through `src/consumer/modelGateway.ts`. It then saves normalized results.

`src/localDocumentProcessingRunner.ts` uses the same durable queue for classification by tags and PDF splitting before extraction. Splitting commits child IDs and original-page maps before it creates independent derived sources. Automatic jobs bind a validated Template version before extraction. Each stage permits one initial assessment and at most two targeted reassessments. Unresolved work waits for manual resolution.

The WebSocket sends changes to browsers. API clients poll the returned job or packet location, discover children, and read each job for results. An accepted one-document split retains its packet API identity. The frontend presents it as one ordinary Document.

## Local data

`bun run migrate` creates the control database, Better Auth tables, session signing secret, and data folders. You can run it repeatedly. Each Workspace database initializes on first use.

By default everything lives in `.local/`:

| Path | Contents |
| --- | --- |
| `data/control.sqlite` | Accounts, sessions, Workspaces, members, invitations, and API key hashes. |
| `data/workspaces/*.sqlite` | One database per Workspace: templates/tags, jobs/results, document packets and split plans, processing settings, and its encrypted model credential. |
| `data/better-auth-secret` | Key that signs sessions. |
| `secrets/model-gateway.key` | Key that encrypts model credentials. Created the first time a credential is saved. |
| `source-files/` | Uploaded documents, kept only while they are needed. |
| `mail/YYYY-MM-DD.jsonl` | Captured verification and password-reset emails, when email is not sent through Cloudflare. |
| `analytics/YYYY-MM-DD.jsonl` | Local usage events (see [Analytics](#analytics)). |

Keep both key files with the databases. A restored Workspace database retains model settings without `secrets/model-gateway.key`, but requires a new credential entry. Exports, analytics, diagnostics, and live updates exclude both plaintext and encrypted credentials.

Deleting `.local/` deletes every account, Workspace, and result. For backups, see [Backing up and restoring](../docs/setup.md#backing-up-and-restoring).

## Workspace model gateway

Each Workspace has separate model settings. New Workspaces and Workspaces upgraded from global settings start without configuration. An owner or admin configures them under **Workspaces → Model gateway → Set up**:

- **Gateway URL** and **model name.** The app accepts HTTP(S) addresses, including private and local addresses. It rejects redirects.
- **Gateway credential.** The app uses this secret for model calls. It differs from the Workspace API key used by clients. The credential is write-only. Leave it blank during editing to keep the saved value.
- **Capability switches** (all off by default):
  - **Direct PDF input** sends PDFs to the model as they are. Without it, pages are rendered as images.
  - **Structured output** asks the model for JSON matching the template.
  - **Sequential calls** stops the Workspace from making more than one model call at a time.

**Document classification & splitting** is an optional role alongside Extraction and Template assistant. It inherits Extraction settings or uses its own model and capabilities on the shared gateway. Classification receives the source and eligible Template IDs, names, and descriptions. Field schemas are used only for extraction.

The Workspace settings **Enable smart splitting** and **Exclude blank pages** default to off. Blank exclusion requires splitting.

Model routes can impose document and image-count limits below runtime limits. Each assessment sends selected PDF pages in one request. Role capabilities determine whether the request uses a PDF or page images. The app does not automatically batch requests to meet provider limits.

**Test connection** is optional. It sends one `chat/completions` request per distinct model with the prompt "Reply with OK." It waits up to 30 seconds without retries and requires a readable reply. The test neither verifies capabilities nor saves configuration. Saving settings does not contact the gateway.

Without Workspace model settings, uploads return `409 workspace_model_not_configured`. An unreadable encrypted credential returns `503 workspace_model_configuration_unavailable`. Both validations occur before upload storage or job creation.

Each extraction attempt uses the latest saved settings. Changing or clearing the settings does not stop an attempt already in progress.

Under **Workspaces → Model gateway**, members can view configuration status. Owners and admins can read non-secret settings, edit or clear configuration, and test drafts. If another user changes settings during editing, reload before saving. Other open browsers refresh after a saved change.

The app ignores old global model environment variables and logs their names during startup. See [Configuration](../docs/configuration.md#model-settings-are-per-workspace). Startup deletes an old `data/model-gateway.json` file without reading it.

## Built-in protections

The runtime limits admitted work to control memory use on busy machines and machines with limited resources.

### Uploads

The file limit, `MAX_SOURCE_FILE_BYTES`, is separate from the request limit. Document requests permit the file limit plus 40 KiB for fields and multipart framing. A measured maximum-size browser upload used approximately 25 KB of framing.

Oversized requests return `400 source_file_too_large` before storage. Validation order is authorization, Workspace storage, model settings, then `Content-Length`. Requests without a length are counted during streaming. Bun’s hard limit permits another 40 KiB so the app can return its own error first.

PDF inspection uses a bounded pool of separate processes with size, decoding, and time limits. Inspectors recycle after 32 documents, 64 MiB of input, or 128 MiB sampled RSS, and exit after five seconds idle. PDF subsets, child sources, previews, and blank verification use a second bounded recycling pool with the same worker lifetime limits. These operations have output bounds and cancellable deadlines. See [Configuration](../docs/configuration.md#uploads-and-extraction).

### Memory pressure

When the operating system reports memory pressure, the resource controller reacts immediately:

- **Warning:** Reduce extraction concurrency by half, with a minimum of one. Reject new uploads at or above `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES`.
- **Critical:** Pause new extractions, reject all new uploads, and close idle Workspace databases.

Active work continues. Normal service resumes after three consecutive samples show sufficient memory and event-loop capacity. `/v1/health` reports current and previous pressure levels and recovery times. Diagnostics exclude Workspace and document content.

On Linux, native pressure events are checked against host and cgroup PSI counters to filter the known false event after arming a watcher ([Bun #42783](https://github.com/oven-sh/bun/issues/42783)). Low host or cgroup memory headroom, missing counters, and counter resets still forward the event conservatively.

The runtime reserves preparation memory before work starts. It creates split subsets after admission and holds the shared reservation until derived files persist. The default budget is 72% of physical RAM, below the 80% memory threshold. This budget is an estimate, not an operating-system limit. Lower it when a local model server shares the machine.

### Live updates

The live-update WebSocket sends only to the browser. Any client message closes the connection with code 1008. Bun rejects messages above 64 bytes, which the browser sees as code 1006. Quiet connections remain open for five minutes, with automatic pings.

Each connection permits at most 64 KiB of unsent data. Reaching this limit closes the connection. Messages are not queued for retry. Diagnostics include aggregate counts and exclude Workspace IDs and message content.

## Transactional email

With the default `EMAIL_PROVIDER=local`, the app captures verification and password reset emails without sending them. It writes links to the server log and `mail/YYYY-MM-DD.jsonl`. Installer users can read them with the launcher’s `mail` command.

With `EMAIL_PROVIDER=cloudflare`, the app sends emails through Cloudflare’s Email REST API. It does not save them locally. See [Send email with Cloudflare](../docs/configuration.md#send-email-with-cloudflare).

Workspace invitations appear in the app and are not emailed. The frontend offers only configured sign-in and verification options.

## Analytics

With the default `LOCAL_ANALYTICS_ENABLED=true`, `.local/analytics/YYYY-MM-DD.jsonl` records template changes, submissions, and extraction outcomes. Records include IDs and limited metadata. They exclude emails, API keys, filenames, document content, and answers. No analytics leave the machine.

## Tests

From the repository root, `bun run test` runs backend and frontend suites. Run these backend-only commands from `backend/`:

| Command | Use it to |
| --- | --- |
| `bun run test` | Run the whole backend suite, then the full-app smoke test. |
| `bun run test:agent [file] [-t name]` | Run tests with quiet output: only failures and the summary are shown. |
| `bun run test:target <filter>` | Run matching tests, stopping at the first failure. |
| `bun run test:bun:changed` | Run tests affected by changes since `HEAD` (or `BUN_CHANGED_BASE`). |
| `bun run test:evidence` | Run the full suite serially in a fixed order, writing JUnit, timings, and coverage to `.scratch/ci/backend/`. This is the CI lane. |
| `bun run test:bun:flake` | Rerun the suite in random orders to find flaky tests. Reproduce a run with the command it prints, for example `BUN_TEST_SEED=90909 BUN_TEST_RERUNS=20 bun run test:bun:flake`. |

From the root, `bun run check:agent` runs typecheck, lint, backend tests, and frontend tests concurrently. It reports every result.

The backend coverage floor is in `backend/coverage-baseline.json`. Raise it manually when coverage improves. No process updates it automatically.

## Benchmarks

Benchmarks compare implementations on your machine. Use them to detect regressions; their results do not guarantee capacity. Run them from `backend/`. Most write a Markdown report under `.scratch/`.

| Command | Measures |
| --- | --- |
| `bun run benchmark:static-assets` | Serving frontend files lazily with `Bun.file()`, compared with buffering them in memory. Tune with `STATIC_ASSET_BENCH_BYTES`, `_CONCURRENCY`, and `_ROUNDS`. |
| `bun run benchmark:memory-pressure` | Behavior under simulated memory-pressure events, with the policy on and off. It never actually exhausts memory. |
| `bun run benchmark:document-body-limit` | A real server under oversized and aborted uploads: responses, latency, memory, and leftover files. |
| `bun run benchmark:live-update-fanout` | The cost of sending live updates to many subscribers inside the hub. Network and browser time are not included. |
| `bun run benchmark:loopback-saturation` | Extraction throughput and the overhead of automatic template selection and smart splitting against a local simulated model, sending PDFs inline or as rendered pages. |
| `bun run benchmark:model-payload-base64` | Encoding documents for model requests. |
| `bun run benchmark:test-parallel` | Running the test suite in parallel compared with serially. |
| `bunx bun@1.4.2 run benchmark:bun-runtime` | Synthetic queue/admission throughput on Bun 1.4.2 compared with 1.3.14. It fails if 1.4.2 is more than 10% slower, adds more than 15% to p95 job time, or fails a job. |

The loopback benchmark runs four scenarios in each PDF mode: `explicit`, `automatic`, `split-explicit`, and `split-automatic`. It uses the same two-page PDF and two tagged candidate Templates across scenarios, with fresh application state for each pass. The simulated model selects the benchmark Template and splits each page into a separate Document. PDF preparation, assessment validation, child materialization, and field extraction use the current server implementation.

Reports include uploads/s, extracted Documents/s, upload p50/p95 latency, CPU, memory, and model-call counts for extraction, classification, and splitting. Splitting completes an upload only when every child finishes. Throughput uses persisted completion timestamps during the measurement window; latency runs from persisted acceptance to completion and includes all completed uploads. The report shows throughput and latency changes against the explicit-template baseline for the same PDF mode. It fails for missing work, unexpected stage counts, invalid model requests, or load/drain errors. These scenarios assess processing cost, not model accuracy, retries, or human review.

From the repository root:

```bash
# Default: 60 seconds per scenario and PDF mode (eight passes), plus setup/drain.
bun run benchmark:loopback-saturation

# Short comparison with a simulated 100 ms delay for every model call.
LOOPBACK_BENCH_DURATION_SECONDS=10 LOOPBACK_BENCH_GATEWAY_LATENCY_MS=100 bun run benchmark:loopback-saturation
```

Use `LOOPBACK_BENCH_SCENARIOS=explicit,automatic` to select scenarios and `LOOPBACK_BENCH_MODES=inline-pdf` to select a PDF mode. `LOOPBACK_BENCH_RENDER_PAGES` controls the page count in **both** modes (default 2). `LOOPBACK_BENCH_GATEWAY_LATENCY_MS` defaults to 0 to expose local processing cost. `LOOPBACK_BENCH_RUNNER_CONCURRENCY`, `LOOPBACK_BENCH_SUBMITTERS`, and `LOOPBACK_BENCH_BACKLOG` control offered load; adaptive concurrency stays disabled for comparisons. Capacity retries honor `Retry-After`, wait at least one second, and add up to 250 ms of jitter to avoid repeated bursts of rejected uploads. Reports, JSON, optional CPU profiles, and isolated state are under `.scratch/loopback-gateway-saturation/runs/`.

`benchmark:bun-runtime` still uses the older throughput prototype with an injected extraction delay; use the loopback benchmark for the full PDF/model preparation path. All benchmark TypeScript files are included in the normal backend typecheck.

The loopback benchmark defaults to a process RSS threshold of 25% of physical RAM and a model preparation budget of at most 512 MiB, leaving space for other services on a shared development host. `LOOPBACK_BENCH_MEMORY_LIMIT_RATIO` and `LOOPBACK_BENCH_PREPARATION_MAX_BYTES` override these settings. Raw health samples and each completed scenario's result are saved immediately, including parser-pool diagnostics, so later failures do not erase earlier measurements.

CPU profiling is disabled by default. Set `LOOPBACK_BENCH_CPU_PROFILE=true` only for short diagnostic runs. [Bun 1.4.2 retains sampled closures under `--cpu-prof`](https://github.com/oven-sh/bun/issues/42377), which can retain document buffers and inflate RSS by gigabytes. Use unprofiled runs for throughput and memory comparisons; the benchmark records the profiling setting in its evidence.

Packet processing and ready extraction alternate within a Workspace, preserving FIFO within each stage. This prevents large split-upload backlogs from blocking child completion. PDF page copying uses four isolated subprocesses; preview and blank checks load rendering dependencies only when needed. Benchmark RSS includes both the API and a separate process-tree total for its PDF workers.
