# Bun 1.4 release and project opportunities

Research date: 2026-08-20

## Executive conclusion

Bun 1.4 is unusually consequential for this repository. It is the first stable release of Bun's Rust port, raises the reported Node.js compatibility target to Node 26.3.0, makes Web Streams native, substantially expands the test runner and observability surface, and completes an opt-in global virtual package store. The official release is [`bun-v1.4.0`, commit `34cbb9a`](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0), published on 2026-08-20.

The best project work is, in priority order:

1. Stage a pinned 1.4 upgrade through the complete command surface and the existing throughput prototype, with an immediate rollback path to 1.3.14.
2. Land a separate dependency-security change: the 1.4 audit found 17 advisories (eight high, nine moderate), including a product-facing `pdfjs-dist` issue for malicious PDFs, plus Vite/esbuild and ExcelJS/UUID paths that need explicit major-version decisions.
3. Change shutdown to await Bun 1.4's graceful `server.stop()` before closing SQLite stores.
4. Replace the model gateway's JavaScript binary-string/base64 loop with `Buffer.from(arrayBuffer).toString("base64")`; a project-local 10 MiB microbenchmark was about 104x faster with identical output.
5. Make the Bun-native backend suite isolated and then parallel, record per-file timings, and give agents quiet, machine-readable, deterministic test lanes.
6. Replace full-buffer SPA asset reads with `Bun.file()` responses or Bun's new directory routes, preserving the SPA fallback.
7. Feed `process.on("memoryPressure")` into the existing adaptive resource controller as an immediate backpressure signal.
8. Bound WebSocket and request-body backpressure, and consider Bun's native pub/sub for workspace fanout.
9. Add Markdown CPU/heap profiling runbooks so a person or an agent can inspect performance without a GUI.
10. Use the 1.4 package-manager controls: the global isolated store, `bun ci`, `bun dedupe --check`, `bun audit`, `bun pm diff`, and optionally a package minimum-release-age policy.
11. Add a small Playwright end-to-end lane running on Bun. Treat experimental `Bun.WebView` as an optional agent/local visual smoke tool, not the sole browser test oracle.

A Vite-to-`bun build` migration, production HTTP/3, `Bun.cron`, `Bun.Image`, and a single-executable build should not be on the immediate upgrade path. Some are promising prototypes; none is needed to realize the largest 1.4 gains.

## Scope and evidence policy

The [Bun 1.4 release post](https://bun.com/blog/bun-v1.4) explicitly says it covers everything shipped since 1.3.0, not only changes first appearing in 1.4.0. Its `{% since %}` annotations are therefore important. This ledger distinguishes new-in-1.4 features from accumulated 1.3.x features that are part of the 1.4 release story.

Only first-party Bun material is used for Bun claims: the official release/blog/docs and the owning `oven-sh/bun` issue or pull request. Repository observations come from the checked-out source. No third-party performance claims are used.

Numeric performance results are included only when Bun publishes a sufficiently concrete method. Other release-post performance claims are treated as directional and require a local measurement before they inform capacity limits.

## Current repository baseline

The project is already deeply coupled to Bun rather than merely using it as a package manager:

- The root is a two-package Bun workspace and its command surface is Bun-native ([`package.json`](../../../package.json)). The local shell observed during this research is Bun `1.3.14`, and CI explicitly installs `1.3.14`; there is no root `packageManager` declaration or `.bun-version` to enforce the same version for local developers and agents ([`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)).
- The backend runs `Bun.serve`, uses `bun:sqlite`, Bun files, Bun subprocesses, WebSockets, and `bun:test` ([`backend/package.json`](../../../backend/package.json), [`backend/src/server.ts`](../../../backend/src/server.ts)).
- There are 37 `*.bun.test.ts` files. The backend test script first runs Vitest and then expands the Bun test file list through `find`; the frontend is Vite 5 + React 18 + Vitest 4 ([`backend/package.json`](../../../backend/package.json), [`frontend/package.json`](../../../frontend/package.json)).
- The lockfile is version 1 with `configVersion: 1` ([`bun.lock`](../../../bun.lock)). Bun's official install documentation says a workspace with config version 1 uses the isolated linker; the current physical `node_modules/.bun` store is consistent with the pre-1.4 isolated layout ([Bun install strategies](https://bun.com/docs/pm/cli/install#installation-strategies)).
- Multipart Source admission is already a bounded streaming path: Web `ReadableStream` -> Node stream -> limiter -> Busboy -> file, with abort handling and 64 KiB watermarks ([`backend/src/localMultipartSubmission.ts`](../../../backend/src/localMultipartSubmission.ts)). This is an excellent match for 1.4's native Web Streams and backpressure work.
- The runtime already has an adaptive controller sampling RSS, CPU, event-loop lag, disk, and gateway outcomes every five seconds, and can drive extraction permits to zero ([`backend/src/localResourceController.ts`](../../../backend/src/localResourceController.ts)). It does not yet consume an OS low-memory event.
- Built frontend assets are served by `stat()` plus `readFile()`, materializing every GET into memory and implementing content types manually; it does not emit ETags, Last-Modified, conditional responses, or ranges ([`backend/src/localRuntime.ts`](../../../backend/src/localRuntime.ts)).
- Shutdown calls `server.stop(false)` but does not await it, then immediately closes product stores ([`backend/src/server.ts`](../../../backend/src/server.ts)). That ordering matters more under 1.4's new graceful-stop contract.
- Product schema initialization and migrations use `Database.exec()` extensively ([`backend/src/localWorkspaceProductStore.ts`](../../../backend/src/localWorkspaceProductStore.ts)); there is no use of a live `Statement.iterate()` cursor.
- Local analytics and captured mail are JSONL append-only files ([`backend/src/localProductAnalytics.ts`](../../../backend/src/localProductAnalytics.ts), [`backend/src/localMailSink.ts`](../../../backend/src/localMailSink.ts)).
- PDF rendering uses the N-API package `@napi-rs/canvas`. It is an N-API module with per-platform optional binaries, rather than a classic addon keyed only to `NODE_MODULE_VERSION`; it still needs cross-platform smoke coverage after a runtime rewrite.

## Local validation and measurements

The official Bun `1.4.0` binary was run against the current checkout without changing application source or dependency declarations. This is encouraging compatibility evidence, not a production soak or a substitute for the existing throughput benchmark.

| Check | Result under Bun 1.4.0 |
| --- | --- |
| Root typecheck | Passed |
| Root lint | Passed |
| Root build | Passed; Vite 5.4.21 built 138 modules in about 0.52 s |
| Complete current test surface | 392/392 passed: 106 Bun-native backend, 43 backend Vitest, 243 frontend Vitest |
| Current sequential root test command | About 12.11 s wall time in one run |
| Bun-native backend, serial | 7.19 s runner time |
| Bun-native backend, default `--parallel` (12 workers on this host) | 2.88 s runner / 3.45 s wall time; 106/106 passed |
| Same default-parallel command under Bun 1.3.14 | 3.56 s; 106/106 passed |

A separate capped-worker baseline under 1.3.14 measured the Bun-native subset at 7.30 s and 308 MB peak RSS serially versus 3.70 s and 445 MB at `--parallel=4`: about 2x faster for about 45% more peak memory. `--parallel=4 --randomize --rerun-each=3` also passed all 318 executions in 6.83 s. These are single-machine observations with warm caches, so they establish a promising starting point rather than a capacity guarantee. Start at four workers, measure again under 1.4 on CI hardware, and reduce the cap if RSS or SQLite/disk contention worsens.

The current real-process smoke test cannot safely join that pool yet. It reserves an ephemeral port by binding port `0`, releases the port, and only then launches the child server with the chosen number ([`backend/src/localRuntimeSmoke.bun.test.ts`](../../../backend/src/localRuntimeSmoke.bun.test.ts)). That is a time-of-check/time-of-use race: another test worker can claim the port between those actions. Keep this file in a separate serial lane until the child binds port `0` itself and communicates its actual address, or until server creation is made importable.

### Opportunity shortlist

| Priority | Opportunity | Expected project value | First acceptance signal |
| --- | --- | --- | --- |
| P0 | Pin Bun 1.4.0 and migrate the lockfile separately | Reproducible runtime rollout with easy rollback | Clean `bun ci`, all checks, native canvas/PDF smoke, throughput comparison |
| P0 | Await graceful server shutdown | Prevent handlers touching SQLite after stores close | In-flight request completes before store close; bounded forced stop works |
| P0 | Repair audited dependencies in a separate change | Reduce malicious-document and build-chain exposure | High-severity audit clean or explicitly waived with rationale |
| P0 | Replace manual base64 encoding with `Buffer` | Remove a CPU- and allocation-heavy model-payload hot loop | Byte-identical corpus and end-to-end latency/RSS benchmark |
| P0 | Isolated, capped-parallel backend tests | Roughly 2x faster native feedback without unbounded RSS | 20 randomized repetitions; no leaked state; stated RSS ceiling |
| P0 | Remove the smoke test's port race | Make parallel/agent test results trustworthy | 100-run stress with no bind/startup failures |
| P1 | Agent test command + JUnit/timings/coverage | Less noisy output and better failure localization | `AGENT=1`/`--only-failures`, uploaded JUnit/LCOV/timings |
| P1 | Backend `bun:test --changed` consolidation | Run only import-affected backend tests during agent loops | Known source/doc changes select the expected test set |
| P1 | Selective `--bun` CLIs and parallel static checks | Reduce orchestration/startup time without destabilizing frontend tests | Repeated CI timings and equivalent artifacts |
| P1 | `Bun.file` or directory-route static serving | Avoid full-buffer JS allocations; gain ETag/range handling | 304/206/HEAD/traversal/SPA tests pass |
| P1 | OS memory-pressure fast path | React before the current five-second RSS sample | Permits fall to zero and recover only through hysteresis |
| P1 | WebSocket idle/backpressure/pub-sub policy | Avoid reconnect churn, bound slow clients, and lower fanout overhead | Idle/stalled-client soak plus status-aware send tests |
| P1 | Early request-body cap | Reject oversized bodies before multipart parsing | Structured 413 behavior with upload-overhead boundary tests |
| P1 | CPU/heap Markdown benchmark artifacts | Give agents direct hot-path/retention evidence | Repeatable synthetic profile with top regressions summarized |
| P1 | Bun package hygiene and global store | Faster worktree/CI installs and better supply-chain review | Install/disk benchmark; audit/dedupe/license artifacts |
| P1/P2 | Playwright critical-path E2E on Bun | Validate browser APIs, routing, WebSockets, downloads, and actual UI | One isolated Chromium flow with trace/screenshot/network evidence on failure |
| P2 | Gzipped gateway request experiment | Potentially reduce large model-request wire bytes | Gateway compatibility plus CPU/latency/byte measurements |
| P2 | Embedded-asset executable prototype | Potentially simplify distribution, not throughput | Cross-platform PDF/native/auth/state validation |
| P2 | Bounded PDF render worker pool | Isolate CPU-heavy PDF.js/canvas work from API responsiveness | Output equivalence, cancellation, worker-crash, RSS and p95 tests |
| P2 | Batched analytics writes and incremental disk accounting | Reduce per-event filesystem calls and repeated full-tree walks | SIGTERM durability plus burst and large-state benchmarks |
| Defer | Vite replacement, HTTP/3, cron migration, `Bun.Image` PDF rendering | High migration/experimental risk or wrong abstraction | Revisit only under a separate, measured product objective |

## What materially changed in Bun 1.4

### Runtime architecture, compatibility, and reliability

Bun 1.4 is the first stable release of the Rust rewrite. Bun describes the port as a mechanical architecture-preserving rewrite motivated by use-after-free, double-free, and missed-cleanup classes of bugs. It retained the language-independent TypeScript suite and reported that no tests were skipped or deleted; before merge it ran roughly 57,000-61,000 tests and 1.0-1.39 million `expect()` calls per supported CI platform ([Bun's Rust rewrite account](https://bun.com/blog/bun-in-rust#stats)). That is substantial evidence, but it is not proof that an application will see no regression. This project should treat a same-day major runtime rewrite as a staged rollout.

Bun reports 1,517 additional passing files from Node's test suite and targets Node 26.3.0. It reports 97% of Node's own tests passing for `node:http`, `node:fs`, `node:cluster`, `node:timers`, `node:zlib`, `node:vm`, and `node:stream`; 100% for `node:events`, `node:trace_events`, and `node:sqlite` ([release compatibility section](https://bun.com/blog/bun-v1.4#node-js-compatibility)). Newly supported ecosystem cases include Vitest (including coverage), Playwright, OpenTelemetry, Datadog tracing/profiling, TypeORM decorator configuration, `testcontainers`, `nock`, Fastify injection, and Piscina. This is relevant to Better Auth, Vitest/Vite, PDF.js, and native canvas dependencies, though only the project's own suite can validate their particular paths.

The reported Node version is now 26.3.0 and `NODE_MODULE_VERSION` is 147. Native addons selected by the Node ABI need a compatible build; Node-API/N-API remains the more stable boundary. Bun also implements Node-API version 10 ([upgrade guide](https://bun.com/blog/bun-v1.4#node-js-26-node-module-version-147-res-writeheader-removed-paused-read-returns-one-chunk), [Node-API changelog](https://bun.com/blog/bun-v1.4#node-api-version-10)).

### Memory, CPU, streams, and backpressure

Bun unified JavaScriptCore and Bun allocations on mimalloc and added partial-page clearing, lazy zeroing, and a scavenger that frees memory while JavaScript is idle. It also changed GC scheduling/root traversal and reduced `futex` traffic ([production section](https://bun.com/blog/bun-v1.4#production)). The post publishes attractive HTTP memory, idle CPU, and startup deltas, but it does not give enough complete workload/hardware/run-count detail for those tables to become this project's capacity assumptions. Measure the local extraction workload instead.

`ReadableStream`, `WritableStream`, and `TransformStream` are now native and pass the Web Platform Tests. `Bun.serve` and `fetch()` propagate backpressure; a slow connection holds at most one buffer of a response/request body, and the same mechanism composes with transform streams, child processes, `Bun.spawn`, `Bun.file().stream()`, and blobs ([streams and bodies](https://bun.com/blog/bun-v1.4#streams-and-bodies), [backpressure](https://bun.com/blog/bun-v1.4#backpressure)). This should benefit the existing multipart pipeline automatically, but Busboy and the file writer remain part of the end-to-end path and must be measured.

The one first-party runtime benchmark with a full enough method to retain here moves 64 MiB through four pipelines in 4 KiB chunks using the same script for Bun, Node, and Deno. Bun states: AMD EPYC 9R14, Linux x64, one process per run, median of three, peak RSS from `/usr/bin/time -v`. Bun 1.4 reports 132 MB/s and 62 MB peak RSS for file decode/encode/file, versus Bun 1.3's 116 MB/s and 92 MB; the subprocess pipeline reports 751 MB/s and 65 MB, versus 505 MB/s and 207 MB. These are evidence that the native-stream rewrite can matter, not predictions for multipart PDF admission ([benchmark, method, and source code](https://bun.com/blog/bun-v1.4#streams-and-bodies)).

New `process.on("memoryPressure")` fires from OS facilities on macOS, Linux, and Windows without keeping the event loop alive. Bun explicitly suggests clearing caches, closing idle connections, or stopping workers ([memory-pressure documentation in the release](https://bun.com/blog/bun-v1.4#process-on-memorypressure)). This is a natural fast-path input to the existing resource controller.

### Testing and agent-oriented diagnostics

The most project-relevant test features are:

- `bun test --parallel[=N]` runs files across worker processes, implies isolation by default, merges coverage/JUnit output, stops all workers for `--bail`, and exposes `BUN_TEST_WORKER_ID`/`JEST_WORKER_ID` ([parallel tests](https://bun.com/blog/bun-v1.4#bun-test-parallel)).
- `bun test --isolate` gives every file a new global and module registry; it closes leaked servers/sockets/watchers/subprocesses, cancels timers, restores fake timers, and still shares transpiled source/bytecode caches. 1.4 fixes leaked fake time, working-directory, subprocess, native-addon, and handle state between files ([isolation](https://bun.com/blog/bun-v1.4#bun-test-isolate)).
- `--shard=M/N` deterministically partitions files, while `--timings=<file>` plus `--update-timings` records per-file durations and balances shards/workers by wall time, keeping files with shared imports together ([sharding](https://bun.com/blog/bun-v1.4#bun-test-shard), [timings](https://bun.com/blog/bun-v1.4#bun-test-timings)).
- `--changed[=<git-ref>]` walks the reverse import graph from Git changes, supports tsconfig path aliases, and can re-filter in watch mode ([changed tests](https://bun.com/blog/bun-v1.4#bun-test-changed)).
- Retries and repeats can stress an individual flaky/concurrent test; fake timers now interoperate with Testing Library and `Bun.cron` ([retry/repeat](https://bun.com/blog/bun-v1.4#bun-test-retry), [fake timers](https://bun.com/blog/bun-v1.4#jest-usefaketimers)). Retries should diagnose flakiness, not normalize it in the required lane.
- Vitest now runs under Bun with threads/forks, and the V8 coverage provider is implemented through `node:inspector`; Bun says per-file coverage agrees with Node on its comparison project ([Vitest coverage](https://bun.com/blog/bun-v1.4#vitest-coverage)).

Bun can now produce CPU profiles, heap profiles, and bundle metafiles as Markdown. `--cpu-prof-md` includes hot functions and call relationships; `--heap-prof-md` includes retained sizes, largest objects, and retention chains; `bun build --metafile-md` includes entry sizes and import chains. Bun explicitly calls out terminal/SSH use and handing the files to an LLM ([observability](https://bun.com/blog/bun-v1.4#observability), [dev tooling](https://bun.com/blog/bun-v1.4#dev-tooling)). CPU and heap Markdown reports are immediately relevant; the metafile report describes Bun's bundler output, not the current Vite/Rollup bundle.

`Bun.WebView` can navigate, click, type, evaluate JavaScript, and take screenshots. On macOS it can use system WebKit; on all desktop platforms it can drive an installed Chrome-family browser. The documentation explicitly marks the API experimental, and its default engine differs by platform ([WebView release section](https://bun.com/blog/bun-v1.4#bun-webview), [WebView documentation and warning](https://bun.com/docs/runtime/webview)). Playwright also now runs on Bun, including its test runner, config, UI, CDP connections, and Chromium launch on Windows ([Playwright compatibility](https://bun.com/blog/bun-v1.4#playwright)).

### Package manager

For the isolated linker, Bun 1.4's global virtual store extracts a package once into Bun's cache and symlinks it into each project's `node_modules/.bun`, instead of copying every package into each project. Bun's published motivating path is a warm-cache CI install with the lockfile present, `node_modules` removed, and 1,400 packages; it reports up to 7x faster. Hardware and variance are not included, so use the claim to justify measuring worktree/CI installs rather than assuming 7x here ([global virtual store](https://bun.com/blog/bun-v1.4#global-virtual-store-up-to-7x-faster-installs)). This repository already selects the isolated linker through `configVersion: 1`, so it should receive the layout change on upgrade without a linker migration.

New maintenance/security commands include:

- `bun pm diff` summarizes files, install scripts, and sensitive module imports added between package versions, then shows a normalized diff ([package diff](https://bun.com/blog/bun-v1.4#bun-pm-diff)).
- `bun audit fix` upgrades vulnerable packages within allowed ranges, supports `--dry-run`, and requires `--latest` for major-version fixes ([audit fix](https://bun.com/blog/bun-v1.4#bun-audit-fix)).
- `bun dedupe` removes semver-compatible duplicate versions without editing `package.json`; `--check` is a CI guard ([dedupe](https://bun.com/blog/bun-v1.4#bun-dedupe)).
- `bun prune --production` removes extraneous packages and development dependencies after a build ([prune](https://bun.com/blog/bun-v1.4#bun-prune)).
- `bun pm licenses --prod --json` produces a machine-readable production license inventory ([licenses](https://bun.com/blog/bun-v1.4#bun-pm-licenses)).
- `bun update` now updates transitive copies, and add/remove/update accept workspace filters ([updates and filters](https://bun.com/blog/bun-v1.4#bun-update-updates-transitive-dependencies)).

Beyond 1.4, Bun already supports `bun ci` as the frozen-lockfile CI install, and `install.minimumReleaseAge` can reject newly published versions for a chosen cooling-off period ([Bun CI install](https://bun.com/docs/pm/cli/install#ci-cd), [minimum release age](https://bun.com/docs/pm/cli/install#minimum-release-age)). These are useful complements to the new diff/audit tools.

The new commands found actionable repository-specific work immediately:

- A complete `bun audit` reported 17 advisories: eight high and nine moderate, across `brace-expansion`, `nanoid`, `pdfjs-dist`, `postcss`, `undici`, Vite/esbuild, and ExcelJS/UUID dependency paths. Most importantly for a document-extraction product, the installed `pdfjs-dist` 6.1.200 is affected by an arbitrary-JavaScript issue when processing a malicious PDF; 6.2.108 is the fixed version identified by the audit.
- `bun audit fix --dry-run` proposed 12 allowed-range repairs, including `pdfjs-dist`, `brace-expansion`, `nanoid`, `postcss`, and `undici`, without blindly changing declared majors. The remaining direct Vite/esbuild and ExcelJS/UUID paths need explicit dependency decisions. The frontend currently resolves Vite 5.4.21 while Vitest 4 brings a second Vite 8.1.x build stack; upgrade and align the direct Vite/tooling line in a reviewed change rather than using `--latest` blindly.
- `bun dedupe --check` found removable duplicate copies of `safe-buffer` and `string_decoder` and correctly exited non-zero. Run the mutating dedupe only in a dependency change whose lockfile diff is reviewed.
- `bun pm licenses --prod --json` successfully produced a machine-readable production inventory.

Do not combine these dependency changes with the Bun runtime/lockfile migration. Separate commits make a runtime rollback possible and make `bun pm diff`/audit review much more legible. In CI and agent scripts, also use `--no-env-file` where ambient project secrets are not required so tests do not pass only because an unrelated local `.env` was loaded.

### Server, networking, and files

New directory routes can serve static trees with `sendfile`, inferred content types, ETags, Last-Modified, `304`, `Range`, and an `index.html`. Paths are normalized; Linux uses `openat2` with beneath-root resolution to prevent a symlink escaping the directory. `Bun.file()` responses also gain range and conditional request handling ([serve files and folders](https://bun.com/blog/bun-v1.4#serve-files-folders), [range and conditional requests](https://bun.com/blog/bun-v1.4#range-and-conditional-requests)). This directly addresses the custom full-buffer asset path in `localRuntime.ts`.

`fetch()` can compress buffered request bodies with gzip, deflate, Brotli, or zstd and sets `Content-Encoding`/`Content-Length`; streaming bodies are unchanged. TLS sessions are cached per origin, and connection reuse improves for proxies/custom TLS ([request compression](https://bun.com/blog/bun-v1.4#fetch-request-compression), [TLS resumption](https://bun.com/blog/bun-v1.4#tls-session-resumption), [connection reuse](https://bun.com/blog/bun-v1.4#connection-reuse)). Compressing the large JSON/base64 request sent to LiteLLM could reduce bytes on the wire, but only if that gateway explicitly accepts compressed request bodies. It needs a disposable integration test and should not be assumed.

HTTP/3 serving and HTTP/2/3 `fetch()` are explicitly experimental. Bun's release says not to ship `http3: true` to production yet ([HTTP/3 server warning](https://bun.com/blog/bun-v1.4#http3-in-bunserve-experimental), [experimental clients](https://bun.com/blog/bun-v1.4#http2-http3-in-fetch-experimental)). They do not belong in the first upgrade.

### Build and standard-library additions

`bun build --react-compiler` embeds the React auto-memoization compiler into Bun's parser. The release also adds barrel-import optimization, compile-time feature flags, in-memory virtual files, `--asset` for embedding files/directories in a standalone executable, ESM bytecode, esbuild-compatible metafiles, and an O(V+E) code-splitting reachability walk ([build section](https://bun.com/blog/bun-v1.4#bun-build)). None applies to `vite build` automatically.

`--asset` is worth a later distribution prototype because embedded paths are visible through `node:fs` under `/$bunfs/`; an executable could potentially contain the built SPA as well as the server ([compiled assets](https://bun.com/blog/bun-v1.4#asset)). The prototype must prove Better Auth, PDF.js dynamic loading/workers, `@napi-rs/canvas`, editable `.local` state, and environment/config paths all work. It should not be combined with the runtime upgrade.

The expanded built-ins include `Bun.Image`, `Bun.markdown`, `Bun.cron`, `Bun.Terminal`, JSON5/JSONC/JSONL/XML/TOML, archive handling, compression streams, `Response.textStream()`, and child-process cgroup assignment ([built-ins summary](https://bun.com/blog/bun-v1.4#also-built-in)). For this project:

- `Bun.JSONL.parseChunk()` can incrementally parse analytics/mail logs without losing an incomplete final chunk and without first producing a giant array ([JSONL details](https://bun.com/blog/bun-v1.4#bun-jsonl)). This is useful if an admin/diagnostics reader is added, not for the current append path.
- `Bun.Image` decodes raster formats, not PDF. It is not a replacement for PDF.js + the canvas implementation. It could later resize/encode already-rendered pages ([image API](https://bun.com/blog/bun-v1.4#bun-image)).
- `Bun.cron` can register OS jobs or run a non-overlapping in-process job, but 1.4 changes in-process/default parsing from UTC to local time. Replacing the current timers would alter lifecycle and time semantics for little immediate gain ([cron API](https://bun.com/blog/bun-v1.4#bun-cron), [timezone migration](https://bun.com/blog/bun-v1.4#bun-cronparse-and-in-process-buncron-now-use-local-time)).
- `Bun.markdown` and `Bun.Terminal` are valuable tool-building surfaces but have no current product bottleneck to solve.

### Platforms and security

Bun now ships native Windows ARM64 and FreeBSD x64/ARM64 builds, experimental Android builds, supports glibc 2.17 and Linux kernels back to 3.10 with fallbacks, and has more accurate Windows timers ([platform section](https://bun.com/blog/bun-v1.4#platforms)). x64 artifacts are baseline-only; the former Haswell and `-baseline` URLs now point at the same runtime-dispatched binary, so existing download scripts continue to work ([baseline build migration](https://bun.com/blog/bun-v1.4#x64-builds-are-now-baseline-only)). This broadens where local extraction can run, but the application's native canvas binary and document stack still determine its real support matrix.

Security tightening includes certificate identity checks before `fetch()` writes a request, default TLS verification for Bun sockets/listeners, hostname verification for TLS clients, stricter malformed HTTP framing rejection, and tarball path hardening. Bun recommends that everyone upgrade and says advisories will be published after an adoption window ([security section](https://bun.com/blog/bun-v1.4#security)). Private-CA or IP-address LiteLLM deployments should be included in the upgrade matrix because stricter hostname/SNI handling can convert a previously accepted connection into `ERR_TLS_CERT_ALTNAME_INVALID` ([TLS hostname migration](https://bun.com/blog/bun-v1.4#tlsconnect-now-uses-host-as-the-default-servername)).

## Migration and behavior-change audit for this repository

| Change | Repository exposure | Required response |
| --- | --- | --- |
| Node 26.3.0 / module ABI 147 | `@napi-rs/canvas` is native; Better Auth/PDF tooling may branch on reported Node versions. The canvas package is N-API, reducing but not eliminating risk. | Run PDF rendering/extraction and install on macOS ARM64, Linux x64/ARM64, and Windows targets actually supported. Log `Bun.version`, revision, reported Node/N-API/SQLite versions in the diagnostic lane. |
| Rust runtime replacement | Every server/test/package-manager path changes beneath the app. | Pin 1.4.0 initially, run 1.3.14 and 1.4.0 as a comparison matrix, keep rollback simple, then adopt a patch release deliberately. |
| Lockfile version 2 | Current `bun.lock` is version 1. Version 2 adds integrity/path traversal validation. Nested/version-scoped overrides can produce version 3, which older Bun cannot read ([lock migration](https://bun.com/blog/bun-v1.4#bunlock-is-now-lockfileversion-2)). | Run `bun install --lockfile-only` on an upgrade branch, review the complete diff, then use `bun ci`/frozen installs. Do not mix dependency upgrades into the runtime-lock migration. |
| Global isolated store | Current `configVersion: 1` workspace already selects isolated. 1.4 changes physical copies in `node_modules/.bun` into shared-cache links. | Measure clean-worktree/warm-cache install time and disk use. Exercise native optional dependency selection and offline/frozen installs. |
| `node` emulation no longer auto-loads `.env` | Project scripts currently invoke `bun`, `bunx`, or Vite, not literal `node`, but dependency subprocesses may do so under `--bun`. | Make test/runtime env explicit. If trialling `bun --bun vitest`, confirm required variables are supplied by the harness or `--env-file`, not accidental ambient loading ([env migration](https://bun.com/blog/bun-v1.4#bun-invoked-as-node-no-longer-loads-env-files)). |
| Strict TOML/YAML | No project `bunfig.toml`; no runtime Bun YAML parsing found. | Any new bunfig must quote strings. No code migration today. |
| Request/Response clone after body use now throws | Two request validation paths clone before reading and then hand the original onward, which is correct. | Add/retain tests proving validation reads only the clone. Do not reorder clone after body consumption ([clone rule](https://bun.com/blog/bun-v1.4#requestclone-and-responseclone-now-throw-once-the-body-has-been-read)). |
| Fetch network errors are `TypeError`; failed reads consume the body | Model gateway logic mostly treats errors as `Error` and checks abort names, so it should remain compatible. | Add one reset-mid-body test and assert classification/retry behavior by `.code`, not the old concrete `Error` class ([fetch error migration](https://bun.com/blog/bun-v1.4#fetch-network-errors-are-now-typeerror-and-a-failed-body-read-sets-bodyused)). |
| `server.stop()` is genuinely graceful | Shutdown currently starts `server.stop(false)` and immediately closes SQLite stores. 1.4 closes idle connections, waits for in-flight responses, and resolves when all connections close. | Make shutdown async/idempotent: stop admission/timers, await graceful server stop, flush analytics, then close stores. Add a bounded force-stop fallback and a test with an in-flight request ([stop semantics](https://bun.com/blog/bun-v1.4#serverstop-now-closes-idle-connections-and-waits-for-in-flight-requests)). |
| `bun:sqlite` close/exec/iterate behavior | Project has no `iterate()` cursor, but uses multi-statement `exec()` and closes many query-backed stores. | Add upgrade regression tests: a non-final migration statement error must abort/throw; close after cached queries/transactions must be deterministic; no statement may be used after close. Bun now finalizes `db.query()` statements on close and throws on stricter invalid reuse ([release behavior list](https://bun.com/blog/bun-v1.4#other-behavior-changes), [maintainer breaking-change tracker](https://github.com/oven-sh/bun/issues/28792)). |
| Bun test matcher/reset semantics | No `resetAllMocks()` or NaN `toContain()` dependency found. | No migration expected. Be aware `resetAllMocks()` now removes implementations and `toContain()` uses `===` ([matcher changes](https://bun.com/blog/bun-v1.4#jestresetallmocks-now-drops-mock-implementations)). |
| WebSocket validation/ordering | The browser client passes no requested subprotocol; Bun server tests call close normally. | Retain live-update smoke coverage. If subprotocols are introduced, the server must negotiate one; close callbacks are now queued ([WebSocket migrations](https://bun.com/blog/bun-v1.4#websocket-now-fails-the-handshake-if-a-requested-subprotocol-is-not-negotiated)). |
| TLS defaults and hostname checks | Active gateway is HTTPS; private/local gateways may use private CAs or IP routing. | Test production-like CA/SNI settings. Add the CA or correct `servername`; do not globally disable verification. |
| `bun build --compile` config auto-loading | Not currently compiling. | If the later executable prototype ships, choose explicitly whether runtime package/tsconfig, dotenv, and bunfig should load ([compiled-config migration](https://bun.com/blog/bun-v1.4#bun-build-compile-no-longer-auto-loads-tsconfigjson-or-packagejson-at-runtime)). |

## Prioritized project backlog

### P0 — staged upgrade and compatibility gate

Create a dedicated upgrade change that changes only the runtime expectation, `@types/bun`, and the lockfile migration. Keep dependencies otherwise fixed. The gate should run:

```sh
bun --version
bun --revision
bun ci
bun run migrate
bun run typecheck
bun run lint
bun run test
bun run build
bun run start
```

Add the existing `bun run prototype:throughput` under 1.3.14 and 1.4.0 on the same target machine. Capture jobs/second, p50/p95 completion latency, peak RSS, CPU, event-loop lag, SQLite busy/retry outcomes, admission rejections, and gateway concurrency. Use identical fixtures/state reset and at least several steady-state repeats. The release's general HTTP tables are not a substitute for this application's PDF + SQLite + model-gateway workload.

The read-only compatibility pass already completed typecheck, lint, build, and all 392 current tests under the official 1.4.0 binary. The remaining adoption gate is the clean/frozen install, migration and runtime smoke, cross-platform native canvas/PDF checks, and the application-specific 1.3.14-versus-1.4 throughput comparison. Pin CI and local development with the same mechanism, such as `packageManager: "bun@1.4.0"` or `.bun-version`; do not leave CI and agents to select different patches implicitly.

At research time the `@types/bun` wrapper in this lockfile still resolved to 1.3.14 even though `bun-types@1.4.0` was available. Verify the wrapper release before editing declarations; if it still lags, use a narrow temporary `bun-types` resolution/override or correct local compatibility type rather than pretending `server.stop()` returns `void`. Align `@types/node` with the newly reported Node 26 surface only after its compile/runtime impact is reviewed.

### P0 — dependency security remediation, isolated from the runtime change

Upgrade `pdfjs-dist` to at least the audited fixed 6.2.108 before treating hostile document input as safely covered. Apply and review the 12 proposed in-range repairs, then plan the direct Vite/esbuild and ExcelJS/UUID upgrades needed for the remaining paths. Because Vitest already resolves a nested Vite 8 line, explicitly inspect why both Vite generations remain and align the frontend build/test stack where compatible.

Re-run `bun audit --audit-level=high`, the complete command surface, a malicious/invalid-PDF regression set, and frontend dev-server route/security tests. A remaining high advisory must be documented with reachability, compensating controls, an owner, and a deadline; a green test suite alone does not resolve a vulnerable parser or dev server.

### P0 — fix graceful shutdown ordering

Before calling the 1.4 migration complete, change shutdown to await `server.stop(false)` and only then flush/close durable resources. Add a timeout that escalates to `server.stop(true)`. Test a slow in-flight request, an idle keep-alive client, a WebSocket, and a second signal. This is a correctness fix, not merely an optimization.

The shutdown inventory is broader than the product-store registry: stop new admissions and timers, drain or stop queued work, await the server, await `localProductAnalytics.flush()`, close the auth runtime/database, and then close all workspace stores. The hand-written local `BunServerLike.stop(): void` type currently hides the new promise contract; replace it with Bun's actual server/socket types or update the shim as part of the migration. Remove the `memoryPressure` listener and any other runtime listeners during the same idempotent sequence.

### P0 — replace the manual model-payload base64 encoder

`backend/src/consumer/modelGateway.ts` currently converts every `ArrayBuffer` to a `Uint8Array`, expands it into a large JavaScript binary string in chunks, and finally calls `btoa()`. That path is used for inline source files and rendered PDF pages, so its CPU and temporary allocations multiply with document size and extraction concurrency.

A local Bun 1.4 microbenchmark on a 10 MiB buffer produced identical output with these median times:

| Encoder | Median |
| --- | ---: |
| Current `String.fromCharCode` + `btoa` loop | 83.66 ms |
| `Buffer.from(arrayBuffer).toString("base64")` | 0.80 ms |

The roughly 104x microbenchmark ratio is project-specific and should not be presented as an end-to-end extraction speedup. It is nevertheless a low-effort hot-path removal, and Bun 1.4 separately reports a 20-30% improvement to medium-sized `Buffer.toString("base64")` operations in the [official release](https://bun.com/blog/bun-v1.4). Require byte-for-byte equality for empty, odd-sized, multi-megabyte, PDF, and image fixtures; then measure complete gateway preparation latency and peak RSS at realistic page concurrency.

### P0/P1 — trustworthy, fast Bun test workflow for people and agents

Split the Bun-native backend test command from Vitest so each can be scheduled and reported independently.

Recommended Bun-native lanes:

1. Deterministic merge gate: `bun --no-env-file test --isolate ...`, fixed order, zero retries.
2. Fast local/agent gate after it is green: `AGENT=1 bun --no-env-file test --parallel=4 --only-failures --timings=.scratch/bun-test-timings.json --update-timings ...`.
3. Scheduled/manual flake lane: add `--randomize --rerun-each=10`, retain the printed seed, and document reproduction with `--seed=<value>`.
4. Focused agent loop after backend runner consolidation: `bun test --changed=<base-ref> --isolate ...`, followed before handoff by the complete lane.
5. CI scale-out only when needed: commit or cache a stable timings file and use `--shard=M/N --timings=...` after the lane grows beyond roughly 30-60 seconds.

Start with four processes because the local baseline was about 2x faster at a roughly 45% RSS cost; benchmark two and four on CI hardware before committing the cap. Every file can create SQLite databases, temporary files, auth state, and occasionally servers, so increase only while wall time improves and RSS/disk contention remain bounded. `--parallel` implies isolation, but running isolation alone first makes state leaks easier to diagnose.

Do not make retries part of the required success criterion. Use `--repeats` or `--retry` only in a diagnostic script that proves a concurrency fix.

Keep `localRuntimeSmoke.bun.test.ts` serial until its port allocation race is removed. Run it after the parallel native pool initially; then require a 100-run parallel stress pass with no `EADDRINUSE` or startup connection failure before returning it to the pool.

Add JUnit XML, LCOV, and timings as CI artifacts, uploaded even when tests fail. Keep the complete lane non-bailing so an agent receives the full failure set; expose a separate targeted `--bail=1` loop for fast local iteration. Coverage should begin as a measured baseline/ratchet and should report production modules absent from LCOV, because unloaded files do not lower Bun's percentage automatically.

There are nine backend Vitest files, and most use simple `describe`/`expect`/`it` APIs. Port those incrementally to `bun:test` so `--changed` can traverse one backend import graph. Leave the gateway test until its `vi.stubGlobal`, `vi.unstubAllGlobals`, and `vi.waitFor` usage has explicit replacements. Do not migrate frontend Vitest wholesale: it is already fast, uses richer Vitest mocking, and should gain separate V8 coverage plus a real-browser lane.

Remove avoidable time-based flake sources as part of this work. Register temp directories, child processes, servers, and SQLite cleanup immediately after acquisition; freeze dates used in daily filenames; replace unit/component `setTimeout` sleeps with events, injected scheduling, or fake timers. Centralize React Testing Library DOM/mock/timer cleanup in the frontend setup. Isolation is a safety net, not evidence that resources were released correctly.

### P1 — machine-readable performance artifacts

Add opt-in scripts/runbooks for:

```sh
bun --cpu-prof-md --cpu-prof-dir ./.scratch/profiles backend/src/server.ts
bun --heap-prof-md --heap-prof-dir ./.scratch/profiles backend/src/server.ts
```

Exercise a fixed throughput fixture, then retain the reports with the benchmark result. Agents can identify hot functions and retention chains directly from Markdown, which is more accurate than inferring performance from source alone.

Heap and CPU artifacts may include URLs, document text, auth/session values, filenames, or model request data. Keep them under ignored scratch state, use synthetic fixtures, and scrub before sharing or committing.

### P1 — stream built assets instead of reading them completely

Replace `readFile(assetPath)` with a lazy `Bun.file(assetPath)` response, or move the static part into a Bun 1.4 directory route. Preserve all current behavior:

- `/v1` and `/api/auth` routing always wins;
- only GET/HEAD reaches static content;
- normalized paths cannot escape the configured root;
- a real asset wins, otherwise the SPA falls back to `index.html`;
- a missing build remains `503`;
- HEAD has no body.

Then add assertions for content type, ETag, Last-Modified, `If-None-Match -> 304`, a byte range -> `206`, traversal rejection, and SPA fallback. This removes a full JS allocation per static response and delegates well-tested range/cache behavior to Bun.

### P1 — connect OS memory pressure to existing admission/backpressure

Register one `process.on("memoryPressure")` listener at runtime composition. On warning/critical pressure, immediately drive processing permits to zero, stop new large admission, reap safe caches/idle resources, and trigger `sampleNow()`. Resume only through the controller's existing hysteresis after measured headroom returns; do not immediately undo a critical signal.

Record the reason and level in diagnostics. Test the policy through an injected controller event rather than trying to force the host OS into low memory during unit tests.

This event complements the five-second RSS sampler; it does not replace application limits, because it reports host/cgroup pressure rather than which allocation caused it.

### P1 — make WebSocket and HTTP backpressure explicit

The current WebSocket layer maintains a JavaScript `Map<workspace, Set<socket>>`, treats only thrown `send()` calls as failure, and leaves Bun's idle, payload, and backpressure policies at their defaults. The browser is receive-only and can be quiet for longer than Bun's default 120-second idle timeout, so an idle close can trigger a reconnect, re-authentication, SQLite access, and job reload despite no product activity.

Set an intentional idle policy: either server pings or a justified longer/disabled idle timeout. Set a very small incoming `maxPayloadLength` because client messages are unused, apply a bounded backpressure limit, and handle `send()`/`publish()` status values instead of typing `send()` as `void`. Test a stalled receiver and expose `pendingWebSockets` and subscriber counts in diagnostics. Bun's native topic `subscribe()`/`publish()` is a good follow-on experiment for workspace fanout after authorization remains at upgrade time; compare it against the current map before replacing the simpler code.

Also set `Bun.serve`'s `maxRequestBodySize` slightly above the supported 10 MiB source plus proven multipart overhead. The current application limiter begins inside multipart handling, so a transport cap rejects abusive bodies earlier. Preserve the stable structured 413 response and test just-below, exact, just-above, chunked, aborted, and malformed requests so the lower-level limit does not silently change the API contract.

### P1 — run toolchain CLIs under Bun selectively

The installed Vite, Vitest, TypeScript, and ESLint binaries have Node shebangs, so `bunx` alone does not prove the CLI executes inside Bun. Explicit `--bun` trials under 1.4 found backend Vitest at about 0.57 s versus 0.71 s under Node, frontend Vitest at 5.15 s versus 5.00 s, and Vite build at 0.52 s versus 0.56 s; TypeScript and ESLint passed in both modes. Use Bun deliberately where the local result is neutral or better, but retain Node for the frontend test runner until repeated CI measurements show a benefit.

Run independent typecheck and lint work concurrently in CI or with a clearly named parallel script, while keeping build after typecheck/tests and avoiding unbounded simultaneous CPU-heavy work. An agent-oriented aggregate should continue independent checks after one failure so it can report the whole failure surface, while the release gate still fails if any constituent command fails. Make required environment inputs explicit because Bun 1.4 no longer auto-loads `.env` when it is masquerading as `node` through `--bun`.

### P1 — use the package-manager upgrade surface

After the lock migration is reviewed:

- Use `bun ci` for all clean/CI installs.
- Measure the 1.4 global store across two clean worktrees and verify native canvas optional binaries resolve correctly on each target OS/CPU.
- Add `bun dedupe --check` as a non-mutating CI guard; run `bun dedupe` only in a reviewed dependency-maintenance change.
- Run `bun audit --prod` in CI and use `bun audit fix --dry-run` to propose, not silently merge, fixes.
- Require `bun pm diff <package>` for sensitive dependency upgrades (auth, parsing, native binaries, networking) so reviewers/agents see new scripts and sensitive imports.
- Generate `bun pm licenses --prod --json` for release artifacts if this app is distributed.
- Consider `minimumReleaseAge` in `bunfig.toml` to reduce exposure to freshly compromised packages. Pick a window and an explicit, narrow exclude list based on release workflow; do not exclude the whole dependency graph.

### P1/P2 — browser-level product verification

Add a minimal Playwright suite running on Bun for the workflows unit tests cannot prove: sign-up/sign-in, workspace selection, template creation/edit, document submission, live status transition, export, and deletion. Use ephemeral app state and a stub model gateway. Preserve Playwright traces/screenshots on failure so an agent can inspect the actual UI outcome.

Optionally build a smaller `Bun.WebView` visual smoke command for local/agent use: boot the app, use an ephemeral profile, navigate through one happy path, capture screenshots, and assert a few DOM states. Keep it non-blocking until the experimental API stabilizes. Because WebView defaults to WebKit on macOS and Chrome elsewhere, a passing WebView smoke is not a cross-engine equivalence proof.

### P2 — gateway transport experiments

On a disposable LiteLLM route, test `fetch(..., { compress: "gzip" })` for the current buffered JSON request. Confirm the gateway accepts `Content-Encoding`, response/error behavior is identical, and measure wire bytes, CPU, latency, and peak RSS for 2/5/10 MiB PDF requests. Do not enable globally without that evidence.

Keep experimental HTTP/2/3 clients off the required path. A later HTTP/2 experiment could help concurrent same-origin model calls share one connection, but the gateway/proxy must support it and the feature remains experimental.

### P2 — isolate PDF rendering and evaluate image preprocessing

`pdfPageRenderer.ts` renders PDF.js pages and encodes PNGs on the main JavaScript thread, then the gateway path can retain multiple page buffers. Prototype a bounded `worker_threads` pool with transferable `ArrayBuffer`s so CPU-heavy rendering cannot starve API/WebSocket responsiveness. Bind worker count and lifecycle to the existing resource controller; cancellation, native canvas loading, worker crash recovery, and peak RSS are adoption gates. Compare documents/minute, event-loop lag, p95 API latency, and exact page output against the current implementation.

`Bun.Image` is not a PDF decoder or PDF.js canvas replacement, but it could resize oversized raster uploads or re-encode rendered pages when the model accepts JPEG/WebP. Any lossy transform must be A/B tested on scans, fine print, screenshots, forms, and photographs for payload size, total latency/cost, and field-level extraction accuracy. Do not trade agent/model accuracy for a synthetic byte-size win.

### P2 — reduce background filesystem amplification

Product analytics currently serializes each event through `mkdir` plus `appendFile`, reopening the daily JSONL path for every record. A bounded `FileSink`/append-stream or small batcher can reduce filesystem operations, but it must have explicit size/time flush bounds and be awaited by the corrected shutdown path. Validate ordering, rotation, burst throughput, write errors, and SIGTERM durability; the current promise chain is safer than a faster buffer that silently loses tail events.

The resource controller also walks and `stat()`s the complete local state tree periodically. That is acceptable at today's scale but grows with total historical files rather than active work. Maintain incremental byte counters on managed write/delete paths and reconcile them with a slower full scan. Measure background I/O and drift before replacing the current authoritative walk.

### P2 — single-executable distribution prototype

In a throwaway branch/prototype, build the frontend, compile the server, and embed `frontend/dist` with `--asset`. Validate every supported platform and specifically:

- `@napi-rs/canvas` native binary loading;
- PDF.js workers/dynamic resources;
- Better Auth and SQLite initialization;
- the difference between embedded read-only assets and writable `.local` state;
- dotenv/bunfig loading policy;
- SPA fallback and direct assets;
- upgrade/diagnostic version reporting.

Adopt only if distribution/startup/operational simplicity has a real product value. It does not inherently improve extraction throughput.

### P2/P3 — incremental JSONL readers

If local analytics/mail gains a query, export, or diagnostics reader, use `Bun.JSONL.parseChunk()` over bounded file chunks. Preserve incomplete-tail handling and corrupted-line reporting. There is no reason to rewrite the current append-only writer solely for 1.4.

### Defer or reject for now

- **Vite -> Bun bundler / built-in React Compiler:** the current Vite dev server, jsdom tests, plugin behavior, and React build are established. Bun's compiler/metafile features do not flow through Vite. Revisit only with a separate build-system objective and bundle/runtime benchmarks.
- **Production HTTP/3:** explicitly experimental and not needed on a localhost-bound server.
- **OS-registered `Bun.cron`:** conflicts with the current single-process local runtime ownership model. An in-process non-overlap primitive may be useful for retention later, but its local-time semantics must be explicit.
- **`Bun.Image` as the PDF renderer:** it does not decode PDF and cannot replace the PDF.js canvas surface.
- **Replace `bun:sqlite` with `node:sqlite`:** Node compatibility is useful for libraries, but the project already owns a working Bun-native store. A migration would add work without a demonstrated performance or portability gain.
- **Rewrite all frontend Vitest tests to `bun:test`:** frontend Vitest is already fast and uses richer mocking APIs. Consolidating the simpler backend Vitest files is worthwhile for `--changed`; a wholesale frontend migration needs a separate representative pilot.

## Acceptance criteria for adopting Bun 1.4

1. The version and revision used in development/CI/release are explicit and observable.
2. `bun ci`, migration, typecheck, lint, all backend/frontend tests, build, and smoke runtime pass from a clean checkout.
3. The 1.4 lockfile diff is isolated and reviewed; subsequent frozen installs are no-op.
4. Native canvas + PDF extraction pass on every supported OS/architecture.
5. Streaming multipart abort, size-limit, backpressure, and concurrent admission tests pass under isolated and parallel execution.
6. SQLite schema/migration/close behavior is covered, including non-final `exec()` errors.
7. Graceful shutdown does not close stores before in-flight handlers finish and has a tested forced-stop deadline.
8. A same-machine 1.3.14 vs 1.4.0 throughput/RSS comparison shows no unacceptable regression at target concurrency.
9. Private-CA/SNI model gateway behavior is verified with production-like TLS settings.
10. Rollback to the prior Bun runtime does not require reversing an incompatible lockfile or data migration.
11. The dependency-security change removes the `pdfjs-dist` malicious-document finding; every remaining high advisory has documented reachability, controls, owner, and deadline.
12. The `Buffer` base64 path is byte-identical across the fixture corpus and improves end-to-end preparation CPU/RSS without changing model requests.
13. The capped-parallel test lane passes repeated randomized runs, keeps the real-process smoke test race-free, and preserves JUnit/LCOV/timing artifacts on failure.
14. Oversized HTTP bodies and stalled WebSocket clients are bounded without changing stable API errors or losing live-update events.
15. CPU/heap profiles and throughput artifacts use synthetic data, are ignored by Git, and are safe for an agent to inspect.

## Primary source index

- [Bun 1.4 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0)
- [Bun 1.4 release post and upgrade guide](https://bun.com/blog/bun-v1.4)
- [Rewriting Bun in Rust](https://bun.com/blog/bun-in-rust)
- [Bun 1.4 maintainer breaking-change tracker](https://github.com/oven-sh/bun/issues/28792)
- [Bun WebView documentation](https://bun.com/docs/runtime/webview)
- [Bun test runner, isolation, parallelism, reporters, and coverage](https://bun.com/docs/test)
- [Bun HTTP routing, static files, WebSockets, and server metrics](https://bun.com/docs/runtime/http/routing)
- [Bun package installation, isolated linker, CI, and minimum release age](https://bun.com/docs/pm/cli/install)
- [Bun audit](https://bun.com/docs/pm/cli/audit)
- [Bun lockfile](https://bun.com/docs/pm/lockfile)
- [Official setup-bun version resolution](https://github.com/oven-sh/setup-bun)
