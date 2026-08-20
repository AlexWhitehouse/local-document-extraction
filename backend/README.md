# Document Extraction Local Runtime

Document Extraction runs locally on Bun. One server at `http://127.0.0.1:8787` serves the API, Better Auth routes, Workspace live updates, and the built React app.

## Quick Start

From the repository root:

```bash
bun install
bun run migrate
bun run build
bun run start
```

Open `http://127.0.0.1:8787` in a browser. For reload while changing backend code, use `bun run dev`; for Vite UI work in a second terminal, use `bun run dev:frontend` and open `http://127.0.0.1:5173`.

## Local Configuration

The server reads ordinary environment variables. A local `.env` file is suitable for secrets, but do not commit it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Bun server port. |
| `BETTER_AUTH_URL` | `http://127.0.0.1:$PORT` | Public origin used in auth links. |
| `DOCUMENT_EXTRACTION_STATE_DIR` | repo `.local/` | Root directory for all durable local state. |
| `DOCUMENT_EXTRACTION_ADMIN_EMAILS` | empty | Comma-separated local Application admin emails. |
| `MAX_SOURCE_FILE_BYTES` | `10485760` | Maximum accepted Source file size; multipart request caps are derived from it. |
| `MODEL_GATEWAY_URL` | `https://litellm.t3m.uk` | OpenAI-compatible LiteLLM endpoint. |
| `LITELLM_KEY` | unset | Credential sent to LiteLLM; required for real extraction. |
| `AI_MODEL` | `claude-opus-4-7` | LiteLLM model name. |
| `MODEL_GATEWAY_ROUTE_LABEL` | gateway hostname | Stored operational route label. |
| `MODEL_GATEWAY_REQUEST_TIMEOUT_MS` | `300000` | Model request timeout. |
| `MODEL_SUPPORTS_STRUCTURED_OUTPUT` | `true` | Include `response_format` in model requests. |
| `EXTRACTION_RETRY_DELAY_MS` | `0` | Delay before retrying a failed model request. |
| `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES` | `4194304` | Upload reservation treated as large while the OS reports warning pressure. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Optional Google sign-in configuration. |

Signed-in users can override `MODEL_GATEWAY_URL`, `AI_MODEL`, and `LITELLM_KEY`
from **Settings → Model**. UI overrides take effect for new extraction attempts
without a server restart and are stored in
`.local/data/model-gateway.json` (or the configured state directory) with
owner-only file permissions. The saved token is write-only in the UI; removing
it explicitly also overrides any `LITELLM_KEY` environment fallback.

## Local State

`bun run migrate` is idempotent. It creates the control database, Better Auth schema, local secret, and required state directories. Workspace product databases initialize when the Workspace first uses Templates or Documents.

By default `.local/` contains:

- `data/control.sqlite`: accounts, sessions, Workspaces, memberships, invitations, and API-key hashes.
- `data/workspaces/*.sqlite`: one product database per Workspace.
- `source-files/`: temporary uploaded Source file binaries.
- `mail/YYYY-MM-DD.jsonl`: captured verification and password-reset mail.
- `analytics/YYYY-MM-DD.jsonl`: privacy-filtered Workspace product analytics.

To make a backup while the server is stopped:

```bash
cp -a .local ".local-backup-$(date +%F)"
```

To reset all local data while the server is stopped, remove `.local/`, then run `bun run migrate` again.

## Local Mail Sink

Verification and password-reset messages are captured locally instead of being sent. The server logs the action link, and each message is appended to `.local/mail/YYYY-MM-DD.jsonl`. Open the recorded verification link in the local browser to complete account verification.

## Product Analytics

Template changes, document submissions, and terminal extraction outcomes append operational events to `.local/analytics/YYYY-MM-DD.jsonl`. These best-effort logs contain stable product IDs and limited metadata only; they intentionally exclude account emails, API keys, Source file names and bytes, document contents, extracted answers, and evidence.

## Checks

```bash
bun run typecheck
bun run test
bun run build
```

For concise agent output, the backend command hides passing-test detail while
retaining failures and the final summary. File paths and Bun name filters are
forwarded directly:

```bash
bun run --cwd backend test:agent
bun run --cwd backend test:agent src/consumer/modelGateway.bun.test.ts -t "HTTP failures"
```

`bun run check:agent` starts typecheck, lint, backend tests, and frontend tests
independently, reports every result, and fails if any constituent check fails.
Use `bun run --cwd backend test:target <filter>` only for a focused fail-fast
loop; its `--bail=1` policy is not used by merge or handoff checks.

`bun run --cwd backend test:evidence` performs the deterministic serial merge
lane and writes JUnit, per-file timings, LCOV, and a coverage-gap summary under
`.scratch/ci/backend/`. CI uploads the same files even after a test failure.
Coverage may be ratcheted upward by reviewing `backend/coverage-baseline.json`;
the command never changes that file itself.

The scheduled/manual flake lane chooses and records a seed. Reproduce any run
with the exact command printed in its artifact, for example:

```bash
BUN_TEST_SEED=90909 BUN_TEST_RERUNS=20 bun run --cwd backend test:bun:flake
```

The focused static-asset benchmark compares the former application-buffered
response with the lazy `Bun.file()` response under identical local
concurrency. It writes a Markdown record, including workload parameters and
server RSS, to `.scratch/bun-1-4-review/evidence/15-static-asset-concurrency.md`:

```bash
bun run --cwd backend benchmark:static-assets
```

Treat the result as a repeatable local comparison, not a production capacity
budget. `STATIC_ASSET_BENCH_BYTES`, `STATIC_ASSET_BENCH_CONCURRENCY`, and
`STATIC_ASSET_BENCH_ROUNDS` may be set explicitly when reproducing a run.

## OS Memory Pressure

Bun 1.4 host memory-pressure events feed the adaptive resource controller
immediately. Warning pressure halves Extraction permits (with a floor of one)
and rejects new upload reservations at or above
`MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES`. Critical pressure pauses new
Extraction claims, rejects every new upload reservation, and closes only idle
Workspace product stores. Active work is never cancelled or evicted.

The pressure latch clears only after three consecutive resource samples show
RSS and event-loop headroom. Runtime diagnostics expose the current and last
pressure level, policy reason, permit transition, idle eviction count, signal
and recovery times, and recovery duration; no Workspace or Document content is
included.

The focused stress comparison runs policy-disabled and policy-enabled modes in
fresh child processes and writes its Markdown evidence under `.scratch/`:

```bash
bun run --cwd backend benchmark:memory-pressure
```

It injects the controller event and uses bounded touched allocations; it never
tries to make the development host run out of memory. Treat its peak RSS and
latency numbers as local comparative evidence only.

## Document Request Body Limits

The Source-file limit and multipart envelope are separate boundaries. The
logical request limit is `MAX_SOURCE_FILE_BYTES` plus 32 KiB: three parser
fields at 8 KiB each plus 8 KiB for multipart boundaries and part headers. A
maximum-shaped Bun 1.4 browser `FormData` fixture (three full fields, a
250-character filename, and the file part) measured 25,378 envelope bytes.

After session or Workspace API-key authorization, a known `Content-Length`
above the logical limit is rejected before a Workspace store, temporary file,
or Extraction job is created. Unknown/chunked bodies use the same limit in the
streaming parser. Bun's `maxRequestBodySize` is one further 32 KiB envelope
beyond the logical limit, leaving bounded room for the application to return
the established structured `400 source_file_too_large` response before the
runtime's emergency hard stop.

Run the bounded real-server stress lane with:

```bash
bun run --cwd backend benchmark:document-body-limit
```

It records structured responses, latency, peak RSS growth, aborted connection
settlement, pending handlers, and temporary/promoted/job side effects in
`.scratch/bun-1-4-review/evidence/17-document-body-limit-stress.md`.

## Workspace Live Updates

Workspace live updates are receive-only. Bun keeps a quiet browser eligible for
five minutes and sends automatic pings, rather than applying the former
two-minute default. Client messages are limited to 64 bytes and any
supported-size message closes the receive-only connection with policy code
1008. Bun 1.4 terminates a payload over 64 bytes at the native limit; its client
currently observes that as abnormal close 1006 rather than a 1009 close frame.

Each client has at most 64 KiB of Bun-managed outbound buffering and is closed
when that limit is reached. The JavaScript hub does not retain payloads for
retry: positive send results are delivered, `-1` is counted as backpressured
until Bun calls `drain`, and `0`/exceptions remove and close the socket.
Diagnostics contain aggregate open/pending counts, subscriber distribution,
lifetime connection counts, and delivery outcomes only—never Workspace IDs or
message content.

Capture the current in-memory hub baseline before considering native topics:

```bash
bun run --cwd backend benchmark:live-update-fanout
```

The Markdown result is written to
`.scratch/bun-1-4-review/evidence/18-live-update-fanout.md`. It measures hub and
synthetic callback cost, not network or browser throughput.

## Bun Runtime Performance Evidence

The bounded full-application extraction prototype can compare the pinned Bun
1.4.0 runtime with the previous 1.3.14 runtime using one shared synthetic PDF
fixture set, fixed Model gateway behaviour, fresh local state, one discarded
warm-up, and three steady repetitions per runtime:

```bash
bunx bun@1.4.0 run --cwd backend benchmark:bun-runtime
```

The command writes the comparison to
`.scratch/bun-1-4-review/evidence/19-bun-runtime-comparison.md`, keeps native
raw CPU/heap profiles under ignored `.scratch/bun-1-4-review/raw/`, and writes
sanitized shareable profiles beside the comparison. It exits non-zero if Bun
1.4 loses more than 10% throughput, adds more than 15% lifecycle p95, exceeds
the documented resource/lag thresholds, fails a job, or observes a SQLite busy
outcome. This is repeatable project-local evidence, not a production capacity
claim or a reproduction of Bun's published benchmarks.

## API Access

Browser requests use a Better Auth session plus `x-workspace-id`. External product clients use a Workspace API key:

```http
Authorization: Bearer <workspace_api_key>
```

API keys can access Template, document-submission, and extraction-job routes. They cannot open live updates or manage account, Workspace, invitation, or admin routes.
