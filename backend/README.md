# Document Extraction Local Runtime

Document Extraction runs locally on Bun. One server at `http://127.0.0.1:8787` serves the API, Better Auth routes, Workspace live updates, and the built React app.

## Quick Start

From the repository root:

```bash
bun install --frozen-lockfile
bun run migrate
bun run build
bun run start
```

Open `http://127.0.0.1:8787` in a browser. For reload while changing backend code, use `bun run dev`; for Vite UI work in a second terminal, use `bun run dev:frontend` and open `http://127.0.0.1:5173`.

## Local Configuration

Start with the [root README](../README.md) and [setup and maintenance guide](../docs/setup.md).
The complete deployment surface is documented in [configuration](../docs/configuration.md)
and mirrored by [`.env.example`](../.env.example). One validated configuration loader is
shared by startup, migration, and `bun backend/src/checkConfiguration.ts`.

The default is a loopback server on port 8787, email/password accounts with verification
through local mail capture, no Google login, and local analytics. Google OAuth and
Cloudflare email delivery are explicit opt-ins. The SPA reads safe auth capabilities
and the upload limit from `/v1/config`; deployment changes require a restart, not a
frontend rebuild. Model settings remain per Workspace, as described below.

Memory limits are resolved at startup. Default preparation reservations can total 72%
of physical RAM, leaving headroom below the 80% process RSS threshold. This does not
preallocate memory or enforce an operating-system memory cap. A local model server
and other programs consume separate memory; lower the budget on shared machines.
`/v1/health` reports aggregate model-preparation and runtime diagnostics.

## Workspace Model Gateway

All Workspaces start without a gateway, model, or credential, including existing
Workspaces upgraded from global model settings. A Workspace owner or admin must
configure **Workspace → Model gateway → Set up** in the frontend. The profile
settings dialog contains account settings only.

Save a complete HTTP(S) gateway base URL, model identifier, and outbound gateway
credential. All three capability/call-behavior switches start off. Direct PDF
input sends PDFs inline; otherwise pages are rendered as images. Managed-file
upload and model-prefix upload inference are not supported. Both connection tests
and extraction refuse redirects; private/local HTTP endpoints are allowed.

The gateway credential is separate from the inbound Workspace API key. It is
write-only: leave its input blank during an edit to preserve a usable saved key,
or enter a new key to replace it. If the machine secret or encrypted credential is
unavailable, enter a replacement credential or clear the whole configuration.

**Test connection** is optional. It makes one 30-second, non-retrying POST to
`chat/completions`, with only the model and “Reply with OK.” user message. It
checks readable assistant content, not declared capabilities. Testing never saves;
saving never contacts the gateway.

Document admission responds with `409 workspace_model_not_configured` until
configured, or `503 workspace_model_configuration_unavailable` when the saved
credential cannot be read. These checks run before parsing or storing a Source
file or creating a job. Each claimed attempt snapshots the latest configuration;
changes do not cancel an in-flight attempt. Queued/retry attempts use the latest
configuration at their existing scheduled time. Clearing stops future attempts,
not those already in flight.

The frontend uses the session-only
`/v1/workspaces/:workspaceId/model-configuration` resource. Members can read
presence only; owners/admins can read non-secret details, PUT complete
configurations, DELETE them, or POST drafts to `/test`. Mutations require
revision-based preconditions (`If-None-Match: *` to create, `If-Match` to
replace/clear). Stale changes return 412; missing preconditions return 428.
Responses are no-store, and successful mutations publish a secret-free
`model_configuration_changed` invalidation for other browsers.

Retired environment variables are ignored, with one startup warning containing
names only: `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`,
`MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_SEQUENTIAL_CALLS`,
`MODEL_SUPPORTS_PDF_INPUT`, `MODEL_SUPPORTS_STRUCTURED_OUTPUT`, and
`MODEL_GATEWAY_USE_MANAGED_FILES`. Operational timeout, retry, capacity, and
retention settings remain supported. The old `/v1/settings/model` route returns
404. After successful initialization, only `data/model-gateway.json` is deleted,
without reading or importing it. Cleanup failures are warned safely and retried
next startup. There is no rollback or downgrade path.

## Local State

`bun run migrate` is idempotent. It creates the control database, Better Auth schema, local secret, and required state directories. Workspace product databases initialize lazily when first used, including saving model configuration. Reading an unconfigured Workspace does not create its database. The additive model-configuration migration preserves product data and previously saved Workspace configurations on subsequent runs.

By default `.local/` contains:

- `data/control.sqlite`: accounts, sessions, Workspaces, memberships, invitations, and API-key hashes.
- `data/workspaces/*.sqlite`: one product database per Workspace, including encrypted Model gateway credentials.
- `secrets/model-gateway.key`: dedicated, random, owner-only machine encryption secret, created on the first explicit credential save (separate from Better Auth).
- `source-files/`: temporary uploaded Source file binaries.
- `mail/YYYY-MM-DD.jsonl`: captured verification and password-reset mail.
- `analytics/YYYY-MM-DD.jsonl`: privacy-filtered Workspace product analytics.

A full current-version backup is secret-bearing: include both the Workspace databases and `secrets/model-gateway.key`, restrict access, and restore them together. A database without the matching machine secret retains its configuration but requires credential replacement. Workspace/job exports, analytics, diagnostics, and live updates exclude plaintext and ciphertext credentials.

Stop the application before copying the full state and private configuration to a
backup **outside the repository**. Follow the [backup/restore guide](../docs/setup.md#backup-and-restore).
Deleting the state directory deletes accounts, Workspaces, results, captured mail,
and machine secrets; it is not an update step. Installer-managed state lives outside
release directories and is preserved by upgrades and application removal.

## Transactional Email

`EMAIL_PROVIDER=local` captures verification and password-reset messages. Action
links appear in private logs and `mail/YYYY-MM-DD.jsonl` beneath the state directory;
installer users can run the launcher's `mail` command. No inbox delivery occurs in
this mode. Google login and verification-disabled mode are reflected in runtime UI
capabilities, so the UI offers only configured access paths.

`EMAIL_PROVIDER=cloudflare` sends through the Cloudflare Email REST API using the
configured account, token, and sender. It does not duplicate action links into the
local mail sink. See [Cloudflare setup](../docs/configuration.md#cloudflare-email-setup).
Delivery attempts are awaited and bounded; API acceptance does not prove inbox
arrival. Workspace invitations remain in-app invitations.

## Product Analytics

When `LOCAL_ANALYTICS_ENABLED=true`, template changes, document submissions, and terminal extraction outcomes append operational events to `.local/analytics/YYYY-MM-DD.jsonl`. These best-effort logs contain stable product IDs and limited metadata only; they intentionally exclude account emails, API keys, Source file names and bytes, document contents, extracted answers, and evidence.

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

After session or Workspace API-key authorization, a product-store lease, and
model-configuration readiness, a known `Content-Length` above the logical limit
is rejected before a temporary file or Extraction job is created. Unknown/chunked bodies use the same limit in the
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
