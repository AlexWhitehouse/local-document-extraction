# Logical PDF sources and shared-page processing

> Historical experiment record. ADR-0022 makes Go mandatory and removes the intake/result prototypes and Bun engine. Commands referring to those paths describe the measured revision, not the current runtime.


This iteration preserves the separate split, child classification and child
extraction calls. Model context remains restricted to each child's pages. It
changes source ownership, page reuse, IPC, accounting commits and artifact lifetime.
All models are simulated on loopback; no paid requests or prompt/quality reductions
are involved. See [ADR-0020](../backend/docs/adr/0020-logical-pdf-sources-and-shared-pages.md).

## Matched split comparison

Both runs use the identical two-page colored PDF, fast lossless PNG, six renderers,
96 local permits, 96 model slots, 24 submitters, a 192-upload backlog, zero provider
delay and a 40-second load window with ten seconds excluded for warm-up. Each
packet produces two one-page Documents with five model calls total.

| Metric | Previous implementation, fresh baseline | Final implementation |
| --- | ---: | ---: |
| Completed Documents/s | 9.37 | **20.86** |
| Completed packets/s | 4.43 | **10.37** |
| Complete packet p95 | 46.17 s | **24.12 s** |
| Child lifecycle p95 | 20.39 s | **8.24 s** |
| All completed Documents | 706 | 1,128 |
| Peak app process-tree RSS | 2.23 GiB | 2.09 GiB |

The final matched run is **2.23×** the fresh baseline. Intermediate runs reach
20.83 and 22.76 Documents/s. These are individual runs on a shared host, not
confidence intervals. The earlier report's comparable split/automatic result was
10.80 Documents/s; conclusions should emphasize roughly doubled throughput, rather
than treating one baseline as an exact capacity constant.

Parent pixels now serve child classification and extraction. Tests verify one
render operation and zero child materialization operations for a local rendered
packet, with identical child PNGs and isolated page attachments. Physical child
PDFs are still produced on demand for PDF-capable models and downloads.

## Broader workload checks

| Workload | Completed Documents/s | All completed |
| --- | ---: | ---: |
| Rendered extraction, two pages/Document | 12.06 | 660 |
| Rendered automatic template + extraction, two pages/Document | 11.97 | 650 |
| Rendered split + explicit extraction, one page/Document | 22.62 | 1,190 |
| Rendered split + automatic template, 1,500 slots, zero delay | 22.30 | 1,244 |
| Rendered split + automatic template, 1,500 slots, seven-second calls | **22.00** | **1,812** |
| Sixteen-page packets, split + automatic template | **26.63** | **1,392** |
| Inline PDF, seven-second calls, ordinary answer | **89.89** | **5,384** |
| Inline PDF, seven-second calls, real 64 KiB extracted answer | **79.44** | **4,940** |

Ordinary inline PDF improves from the preceding report's 78.55 Documents/s to
89.89 (+14.4%); the 64 KiB answer improves from 69.83 to 79.44 (+13.8%). These
comparisons have matching workload settings but are separate single runs. Ordinary
inline completion p95 is 7.72 seconds with 0.91 GiB peak process-tree RSS. The
large answer is actually normalized, stored and exposed by the application.

The delayed rendered test uses 60/28-second load/warm-up, backlog 512 and 24
submitters. Each packet requires split, classification and extraction serially
along its critical path. Child p95 is 14.65 seconds and full-packet p95 is 65.81
seconds, including the deliberately large preparation backlog. Peak simulated
provider concurrency is 429. It sustains about the same throughput as zero-delay
rendering without consuming local CPU permits or final-stage artifact credits
while the provider works.

The sixteen-page test uses 40/10 seconds, backlog 24, eight submitters and zero
model delay. It completes 87 packets (1,392 Documents), with 87 splitting calls,
1,392 classification calls and 1,392 extraction calls. Full-packet p95 is 20.66
seconds, peak process-tree RSS is 2.27 GiB, and no uploads are rejected. Different
packet size and load settings mean this is a capacity check, not an isolated
before/after improvement percentage.

For the two-page zero-delay matrix, extraction processes 24.12 pages/s and splitting
plus automatic classification processes 22.76 pages/s in the same intermediate
build/settings. Avoiding repeated page rendering brings their page throughput
close together, even though splitting still makes five provider calls per packet.

## Work removed and ownership preserved

* A local child owns a durable page manifest and a hard link to immutable original
  bytes. Packet deletion/cleanup does not invalidate accepted children. Source
  `open`/`read` exposes only a child's PDF pages; current Bun can resume Go-created
  children. S3-retained children retain the existing physical derived-PDF path.
* A bounded Workspace/source/page cache reuses exact parent PNGs. Each active reader
  owns links, so eviction cannot interrupt upload. Normal completion removes the
  shared pages; abandoned entries expire after one idle minute. Restart recovery
  regenerates images from durable sources. Independent submissions never share
  cache entries by identical content, including repeated benchmark fixtures.
* Admission inspectors and Go PDF workers receive file paths over private protocols
  and read directly. Whole source files no longer pass through the Bun admission
  heap and worker input pipes just to inspect them. Parser limits and deadlines stay.
* Opaque grayscale pages use exact 8-bit grayscale PNG; all other pages retain RGBA.
  This reduces grayscale encoder input bytes without changing decoded pixels.
  The main colored fixture does not establish a grayscale throughput gain.
* Classification/binding and split assessment/acceptance are batched transactions.
  Successful usage receipts and validated results share one callback and commit;
  invalid model content still records usage before the existing retry policy.
* FULL-synchronous commits collect up to 64 mutations or four milliseconds. The
  SQLite statement cache grows from 20 to 128 entries. No accepted mutation is
  acknowledged before commit and no result validation is removed.
* Final extraction artifacts and their byte credits are released once HTTP request
  upload completes. Durable sources remain until completion, preserving retries.
  Classification images remain reusable for the subsequent extraction call.

## Profiling and limits

An instrumented inline run shows considerable native SQLite `run`, `get` and
`prepare` time; compiled statement caching and commit batching target that work.
The profiling run itself caused memory-pressure admission pauses, so its rate is
not used as a capacity comparison. A separate approximate `/proc` sample during an
unprofiled inline run averages 1.01 CPU cores for the Bun API process, 0.51 for Go
and 0.89 for PDF inspectors. Recycled processes lose partial sampling intervals;
these figures are diagnostic, not an exact CPU accounting proof.

The app is **not yet provider-bound**. At 1,500 concurrent seven-second requests,
the ideal request ceiling is 214.3/s. The final inline run peaks at 769 calls;
rendering limits the image-only path much earlier. Increasing the provider-slot
allowance alone will not remove PDF rendering/encoding and API/storage costs.
The public API, authorization and authoritative SQLite adapter remain Bun. This
iteration does not claim a complete Go-owned intake and storage implementation.

The corpus is generated PDFs, not representative customer scans or a real-model
accuracy evaluation. Pixel equality, unchanged model requests and validation protect
the current processing contract; they do not establish real-model accuracy.

## Evidence and validation

[Raw results and implementation hashes](benchmarks/results/source-views) contain
15 audited capacity/profile runs: **34,430 completed Documents and 47,807 simulated
model calls**, with exact expected stage counts, zero failed Documents, zero
invalid model requests and zero client network errors. Under deliberate saturation,
3,697 upload attempts receive admission backpressure and are not accepted work.
All accepted work drains; rejected attempts are not counted as completed Documents.

The full matrix, sixteen-page and large-response checks precede the final
upload-release refinement. `matched-final`, `release-rendered`, `delayed-rendered`
and `release-inline` exercise the final binary recorded in `implementation.json`.
The other files explicitly record baseline, profiling and intermediate results.
No claim is made that the few-percent difference between the 87.97, 88.19 and 89.89
inline runs isolates one code change.

Validation: root typecheck, lint, build, 609 backend tests, the smoke test and 598
frontend tests; Go race tests and vet; 17 dedicated Go integration/group-commit
tests. Coverage includes exact child page attachments for both provider modes,
parent deletion, source reopening, nested page views, cross-Workspace rejection,
cache eviction/expiry during active reads, pixel equality including all grayscale
shades, killed-process recovery, switching to Bun, accounting on invalid output,
and HTTP/2 upload release while the provider response remains blocked.

Reproduce the matched rendered test:

```sh
bun run build:go
GO_PROCESSOR_BINARY=$PWD/.scratch/go-backend/document-extraction \
GO_MODEL_CONCURRENCY=96 \
LOOPBACK_BENCH_MODES=rendered-pages LOOPBACK_BENCH_SCENARIOS=split-automatic \
LOOPBACK_BENCH_RUNNER_CONCURRENCY=96 LOOPBACK_BENCH_BACKLOG=192 \
LOOPBACK_BENCH_SUBMITTERS=24 LOOPBACK_BENCH_DURATION_SECONDS=40 \
LOOPBACK_BENCH_WARMUP_SECONDS=10 bun run benchmark:loopback-saturation
```

For delayed rendering set model concurrency to 1500, gateway latency to 7000,
backlog to 512, duration to 60 and warm-up to 28. For delayed inline extraction use
`inline-pdf`/`explicit`, 48 submitters, backlog 2000 and 60/20 seconds; set
`LOOPBACK_BENCH_RESPONSE_ANSWER_BYTES=65536` for the large-answer case. For large
packets use rendered splitting, `LOOPBACK_BENCH_RENDER_PAGES=16`, eight submitters,
backlog 24 and 40/10 seconds. All commands use the existing loopback-only harness.
