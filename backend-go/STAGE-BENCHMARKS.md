# Processing capacity and PDF encoding follow-up

> Historical experiment record. ADR-0022 makes Go mandatory and removes the intake/result prototypes and Bun engine. Commands referring to those paths describe the measured revision, not the current runtime.


The subsequent [logical-source/shared-page iteration](SOURCE-VIEW-BENCHMARKS.md)
implements parent-child page reuse and reports newer capacity measurements.

This extends [the original comparison](BENCHMARKS.md). All calls use a local
simulated model. No paid calls, reduced image resolution, lossy compression,
weaker result validation or weaker SQLite commit settings are involved.

## Seven-second provider responses

The example allowance of 1,500 simultaneous model requests implies an ideal
**214.3 calls/s** at seven seconds/request. That means 214.3 Documents/s for
explicit extraction, 107.1 for automatic classification plus extraction, and
85.7 extracted Documents/s for this two-child split-plus-classification fixture
(five calls produce two Documents). These are arithmetic ceilings, not measured
provider utilization. Real provider token limits and latency distributions can
lower them.

Every run below uses the same 1,052,228-byte, two-page PDF through the authenticated
public API, durable persistence and result handling. All accepted work drains.

| Implementation/tuning | Completed Documents/s | Peak provider calls | Completion p95 | Peak app process-tree RSS |
| --- | ---: | ---: | ---: | ---: |
| First Go implementation: 24 permits held during provider waits | 3.78 | 24 | 62.9 s | 839 MiB |
| Release provider waits; small 192-upload backlog | 26.39 | 232 | 8.23 s | 836 MiB |
| Dedicated control connections; 2,000-upload backlog, 24 local permits | 40.80 | 1,336 | 30.14 s | 939 MiB |
| Same, 96 local permits | 66.15 | 544 | 8.02 s | 938 MiB |
| Warm inspectors and batch remaining cleanup writes | 75.87 | 582 | 7.99 s | 1,071 MiB |

The first run is 30 seconds with seven seconds excluded for warm-up; the small
backlog run is 40/14 seconds; the final three are matched 60/20-second runs.
Do not treat the full first-to-last ratio as an isolated code-change effect:
backlog and local capacity were also tuned. The final tuning comparison is
**66.15 → 75.87 Documents/s (+14.7%)** with identical workload settings.
The final run completes all **4,500** accepted Documents, with no failed jobs,
invalid provider requests or client network errors. It peaks at 79 of the 96
local permits and has no pending local queue in sampled observations.

The 24-permit large-backlog run also records a five-second event-loop stall during
drain and temporary resource-controller suspension. Its high peak provider
concurrency is not a success metric: its completion throughput and latency are
worse than the 96-permit run. Count completed Documents and queueing delay.

At 75.87 Documents/s, seven seconds of remote work needs roughly 531 outstanding
calls on average. Increasing an allowance already set to 1,500 cannot remove the
remaining local admission/storage limit. The fake provider shares this six-core
host and itself uses about 0.55 cores in the final run.

The final implementation, including byte-based response admission, repeats the
60/20-second, 1,500-provider-call test at **78.55 Documents/s**. It accepts 79.2
uploads/s in the steady window, completes all **4,780** Documents, peaks at 634
provider calls and 1.04 GiB process-tree RSS, and records p95 completion at **7.89 s**.
No jobs fail and no requests are invalid. This repeat does not establish that the
response limiter itself increased throughput: the few-percent difference from
75.87 is within the uncertainty of single-host, single-run comparisons.

## What changed

* A job keeps its durable identity, Workspace lease and cancellation signal while
  releasing local capacity for provider, PDF-pool, artifact-budget and retry waits.
  Resuming responses take priority over new preparation. Shutdown waits for parked
  jobs; duplicate recovery cannot launch them again.
* Go bounds provider calls separately from upload/base64 encoding. Upload slots
  return when the request body is written, before the provider replies. Response
  bodies are read only after acquiring local capacity, applying TCP backpressure
  to bursts of large responses.
* Response buffers share a byte allowance held until result validation and commit,
  not merely until the HTTP response arrives. Unknown lengths reserve their full
  permitted size; actual sizes refund unused bytes. The default is 1/16 of RAM,
  capped at 512 MiB (minimum 64 MiB). HTTP/2 receive windows are bounded to
  256 KiB/stream and just under 4 MiB/connection. TLS/HTTP2 streaming is tested;
  throughput runs still use plain loopback HTTP.
* Long-running Bun-to-Go control requests use a dedicated HTTP pool. They no longer
  consume Bun fetch's shared 256-request allowance.
* Local concurrency defaults scale with CPU and response-memory allowance, rather
  than remote latency. Renderer defaults scale with CPU and memory. Existing
  adaptive local admission and explicit configuration overrides remain available.
* PDF admission gives two continuation/child turns for each new-parent turn,
  preserving FIFO within each class. Reservations happen only after this admission;
  queued PDFs do not hoard worst-case output space.
* Prepared PDF artifacts reserve worst-case disk bytes before preparation, refund
  the difference after measuring output, and release bytes after deletion. A new
  representation evicts the old one before reservation, avoiding a budget deadlock.
  The default allowance is a quarter of available disk at startup, capped at 4 GiB
  (minimum 96 MiB). Source uploads/restoration and process RSS have separate bounds.
* Selected pages are rendered directly from their source PDF; a temporary subset
  PDF is unnecessary for rasterization. Inline-PDF providers still receive real
  subset PDFs when required.
* PDF admission inspectors remain warm for up to 128 documents/256 MiB input,
  versus 32/64 MiB, with unchanged per-document parsing, deadlines, error retirement
  and 128 MiB RSS retirement. This also benefits the Bun reference processor.
* Source-cleanup markers and child-materialization mutations join existing durable
  group commits. Notification/scheduling still follows committed state.

## Lossless PNG investigation

The existing PDF.js rasterizer, scale, page dimensions and pixel values remain.
The alternative encoder uses unfiltered RGBA scanlines and native asynchronous
DEFLATE level 3, avoiding the native encoder's expensive filtering/compression.
Tests compare decoded RGBA pixels and dimensions, including selected pages, text,
color and transparency. Auto-template and extraction still reuse prepared images.
If faster encoding exceeds the existing artifact limit, Go discards partial files
and retries locally with the original encoder before contacting a provider.

Thirty warm, two-page documents from the benchmark fixture:

| Phase | Original PNG | Faster lossless PNG |
| --- | ---: | ---: |
| Load PDF | 79 ms | 79 ms |
| Rasterize pages | 2,224 ms | 2,000 ms |
| Encode PNG | 9,681 ms | 3,848 ms |
| Sum of measured phases | 11,984 ms | 5,927 ms |
| Total encoded bytes | 16,815,330 | 12,134,910 |

Encoding was 80.8% of the original measured phases. The alternative reduces
encoding time 60.2%, total measured phase time 50.5%, and payload bytes 27.8% on
this fixture. Compression ratios vary; these are fixture measurements, not universal
promises. Raw evidence is in [results/stages](benchmarks/results/stages).

Reproduce the phase profile after generating a fixture with the API benchmark:

```sh
bun backend-go/benchmarks/profile-pdf.ts /path/to/fixture.pdf
FAST_PNG=1 bun backend-go/benchmarks/profile-pdf.ts /path/to/fixture.pdf
```

## Matched API PNG comparison

Both runs use 40-second load windows with the first ten seconds excluded, 96 local
permits, six renderers, 24 submitters, a 192-upload backlog and a zero-delay model.
The PDF fixture SHA-256 and expected model stage counts match. This includes real
uploads, rendering, provider payloads, result validation, persistence and cleanup.

| Scenario | Native PNG Documents/s | Fast PNG Documents/s | Gain |
| --- | ---: | ---: | ---: |
| Extraction | 8.70 | 11.87 | 36% |
| Auto-template + extraction | 7.95 | 11.20 | 41% |
| Split + extraction | 4.87 | 9.37 | 92% |
| Split + auto-template + extraction | 5.23 | 9.30 | 78% |

All 4,741 extracted Documents across the pair finish successfully, with valid
provider request counts and no network errors. Faster encoding increases peak
process-tree RSS to approximately 2.1–2.3 GiB, versus 1.6–1.8 GiB for the native
encoder: raw scanline buffers trade memory for speed. The host has 11.4 GiB RAM.

The large backlog exposed unfairness beyond encoding: already-admitted split
parents could get ahead of their children inside the PDF pool. These two runs
precede the PDF fairness and just-in-time artifact-reservation refinement. Their
split rates are therefore affected by pipeline fill/drain, and should not be
compared as a matched tuning experiment against the original report's smaller
backlog. The subsequent fairness run measures that refinement separately.

## PDF fairness and later reservations

With the same workload settings and fast encoder:

| Scenario | Before refinement Documents/s | After refinement Documents/s |
| --- | ---: | ---: |
| Extraction | 11.87 | 12.30 |
| Auto-template + extraction | 11.20 | 11.67 |
| Split + extraction | 9.37 | 10.57 |
| Split + auto-template + extraction | 9.30 | 10.80 |

The split-plus-auto-template gain is 16.1%. Child-document p95 latency falls from
27.52 to 3.12 seconds; complete-upload p95 falls from 63.90 to 40.07 seconds.
Explicit extraction p95 falls from 33.22 to 16.90 seconds. FIFO within stage
classes removes the long tails from racing artifact-budget waiters. All **2,879**
Documents finish, with correct provider stage counts and no failed jobs or network
errors. Rate differences of a few percent should be treated as single-run evidence,
not precision estimates. Parent-to-child pixel reuse remains unimplemented.

## Final response-handling check

The final binary was tested with identical 60/20-second windows, a 1 MiB source
PDF, 96 local permits, 1,500 provider slots and seven-second simulated responses.
The larger answer is actually normalized, persisted and exposed by the product;
it is not padding in an ignored model-response field.

| Model answer | Documents/s | All completed | Completion p95 | Peak process-tree RSS |
| --- | ---: | ---: | ---: | ---: |
| Ordinary fixture answer | 78.55 | 4,780 | 7.89 s | 1.04 GiB |
| 64 KiB extracted answer | 69.83 | 4,370 | 8.01 s | 1.06 GiB |

The larger result retains 88.9% of ordinary-answer throughput. Neither run has
failed jobs, invalid model requests or client network errors. The ordinary run
still leaves provider capacity unused: the backend/API path remains below the
214 calls/s arithmetic ceiling. The Go service is not presented as removing every
application bottleneck.

Across the ten recorded capacity runs in this follow-up, **30,903 Documents**
complete with their exact expected model-stage counts. Phase microbenchmarks are
separate. [The implementation manifest](benchmarks/results/stages/implementation.json)
records the final binary/source hashes and the audit count. Intermediate runs
measure the successive implementations described above, not that final hash.

## Reproduction and validation

Build once, then run the final delayed-provider workload:

```sh
bun run build:go
GO_PROCESSOR_BINARY=$PWD/.scratch/go-backend/document-extraction \
GO_MODEL_CONCURRENCY=1500 \
LOOPBACK_BENCH_MODES=inline-pdf LOOPBACK_BENCH_SCENARIOS=explicit \
LOOPBACK_BENCH_GATEWAY_LATENCY_MS=7000 \
LOOPBACK_BENCH_RUNNER_CONCURRENCY=96 LOOPBACK_BENCH_BACKLOG=2000 \
LOOPBACK_BENCH_SUBMITTERS=48 \
LOOPBACK_BENCH_DURATION_SECONDS=60 LOOPBACK_BENCH_WARMUP_SECONDS=20 \
bun run benchmark:loopback-saturation
```

For large responses also set `LOOPBACK_BENCH_RESPONSE_ANSWER_BYTES=65536`.
The rendered comparison sets `LOOPBACK_BENCH_MODES=rendered-pages`, all four
scenarios, zero model delay, 24 submitters, backlog 192 and 40/10-second windows.
Use `GO_PDF_PNG_ENCODER=native` or `fast`. Exact settings, fixture hashes, stage
counts, failures and resource observations are preserved in the JSON evidence.

Validation includes root typecheck, lint, tests and build; Go race tests and vet;
durable recovery/integration tests; PDF stage fairness and cancellation; waiting
job ownership, response priority and shutdown; partial-artifact cleanup; byte
budget cancellation/refunds; TLS/HTTP2 streaming; and decoded PNG pixel equality
against the previous subset-PDF path, including page rotation and ordering.
The root suite has 606 backend tests plus its smoke test and 598 frontend tests.
The dedicated Go integration/group-commit suite has 13 tests. Go tests cover the
transport and PDF resource gates separately.

The rendered comparison precedes byte-based response admission and the final
HTTP/2 receive-window settings. Its simulated response bodies are small; the
final delayed-provider and large-response runs exercise the last implementation.
All tests and benchmarks use local simulated providers. They establish backend
correctness and throughput, not real-model accuracy on a representative corpus.

## Remaining work ranked by value

1. Profile and move the remaining hot public-admission and durable-store operations
   into Go if higher single-host API throughput is required. The current public API
   and authoritative SQLite adapter still run in Bun. Their cost now matters more
   than remote waiting. Preserve authentication and transaction semantics at that
   boundary; a language rewrite alone does not remove fsync or parsing costs.
2. Reuse parent split-page images for child processing with bounded, reference-counted
   ownership. The current cache only spans stages within one Document. This can
   remove repeat rasterization, but must handle child page order, cleanup, crashes
   and model-specific preparation settings before enabling it.
3. Tune PNG policy against scanned/photo-heavy and long-document corpora. The
   generated fixture and pixel tests do not measure every PDF shape. A different
   rasterizer, JPEG output or lower DPI needs explicit quality evaluation.
4. Prefer native PDF input where the configured provider supports it. This already
   bypasses rasterization. Do not silently switch a user's model/input strategy.
5. Consider merging classification/extraction calls or provider-side file reuse
   only after quality and provider-contract evaluation. Fewer calls can raise
   Documents/s more than backend tuning, but changing decisions/prompts is outside
   this unchanged-quality simulated-model baseline.
6. Shard authoritative stores/processing across hosts if measured single-host CPU
   or storage remains below the provider allowance. More parked jobs alone will
   just increase latency.
