# Rendering overlap, renderer evaluation and Go data handoffs

> Historical experiment record. ADR-0022 makes Go mandatory and removes the intake/result prototypes and Bun engine. Commands referring to those paths describe the measured revision, not the current runtime.


Work remains on `feat/go-backend-architecture`. The production change overlaps
lossless PNG encoding with the next page's rendering and reuses renderer processes
longer. It also strengthens Source publication durability. Go multipart/result
prototypes and alternative rasterizers were evaluated; they are not enabled by
default because the measurements did not justify doing so.

## Matched rendering result

Both sides use the same two-page colored PDF, six workers, 96 local permits and
96 model slots, 24 submitters, backlog 192, a 40-second load window and ten-second
warm-up. Every packet produces two one-page Documents and makes the same five
model calls. **Both sides include the new Source flush barriers.** The baseline
uses serial encoding and 32-operation worker recycling; the final configuration
overlaps encoding and allows 128 operations.

| Metric | Serial baseline | Final | Final repeat |
| --- | ---: | ---: | ---: |
| Completed Documents/s | 22.03 | **30.54** | **31.03** |
| Full-packet p95 | 22.91 s | 19.94 s | 19.96 s |
| Child lifecycle p95 | 8.12 s | 5.94 s | 6.36 s |
| Peak app process-tree RSS | 2.11 GiB | 2.29 GiB | 2.23 GiB |
| Renderer process starts | 19 | 6 | 6 |
| All completed Documents | 1,128 | 1,338 | 1,318 |

The repeated final results are **38.6–40.9% faster** than the matched baseline.
These are individual shared-host runs, not confidence intervals or a universal
capacity promise. An earlier pre-barrier comparison measured 20.96 → 26.83/s;
it independently supports the direction of the improvement, but should not be
mixed into the final matched calculation.

## Delayed providers and larger packets

| Final configuration | Documents/s | All completed | Peak provider calls |
| --- | ---: | ---: | ---: |
| Image-only split + automatic Template, seven-second responses | **27.00** | 1,992 | 553 |
| Sixteen-page packets, split + automatic Template, zero delay | **28.40** | 1,408 | 10 |
| 1 MiB native-PDF extraction, seven-second responses | **76.75** | 4,660 | See raw evidence |

The delayed rendered run uses 1,500 model slots, backlog 512, 24 submitters and a
60/28-second load/warm-up window. Full-packet p95 is 54.18 seconds, child p95 is
17.41 seconds and process-tree RSS peaks at 2.36 GiB. Its deliberately large
backlog and the three sequential model stages explain why packet latency is much
larger than one seven-second call. The previous report measured about 22/s on
this workload before this iteration and its Source durability fix.

The sixteen-page run uses eight submitters, backlog 24 and 40/10 seconds. It makes
88 split, 1,408 classification and 1,408 extraction calls. Packet p95 is 21.79
seconds, child p95 0.47 seconds, RSS 2.41 GiB, with no rejected uploads. One cache
miss required an extra page render; every accepted Document still completed.
Different page counts and backlog settings make this a workload check rather
than an isolated improvement percentage.

The final inline run uses 48 submitters, backlog 2,000 and 60/20 seconds. Its
**76.75/s includes explicit Source file and directory flushing**. The earlier
approximately 90/s inline result did not have those barriers. This is a material
cost of fixing durability, not an improvement claim. Process-kill recovery alone
had not established protection against host power loss.

## What profiling changed

The first instrumented serial run measured 153.82 seconds of encoding, 81.87 of
rasterization and 13.23 of loading across 1,120 observed pages: approximately
62%, 33% and 5% of measured renderer phase time. It started 19 workers and sampled
a maximum worker RSS below 300 MiB. Recycling at 32 operations, rather than the
384 MiB RSS threshold, was the immediate reuse limit.

The enabled pipeline permits at most two outstanding encodes/canvases per worker.
It preserves order, dimensions, exact lossless pixels, selected-page isolation and
encoded-byte limits. Cancellation and early consumer exit join pending encodes.
Workers now allow 128 operations while retaining the 64 MiB source-input,
384 MiB sampled RSS and five-second idle recycling rules. Overlapped phase times
include scheduling/waiting and **must not be summed as CPU utilization**.

Health diagnostics expose renderer phase times, page counts, process starts,
recycling and RSS, alongside existing queue, model and artifact metrics. A short
whole-device disk sample was bursty; it does not establish a disk throughput
ceiling or justify attributing all remaining cost to disk.

## Go intake and result experiments

Go intake streams authenticated multipart uploads into bounded private staging
files. Bun still owns the public listener, authorization, metadata validation,
PDF inspection and durable acceptance. The extra Bun → Go hop remains, so this
is not a direct Go public ingress replacement.

Go result processing implements the existing normalization rules, with 594 shared
differential fixtures. Dates and escaped UTF-16 sequences retain the original
compatibility parser. Go prepares serialized answers; Bun validates the row
contract/field IDs and binds them directly into SQLite in batches of up to 64.
The existing result/usage transaction remains authoritative. Invalid model output
still records usage and follows the existing retry behavior.

| Pre-Source-barrier experiment | Reference | Go experiment |
| --- | ---: | ---: |
| Ordinary response, initial file handoff + Go intake | 90.00/s | 86.91/s |
| 64 KiB answer, initial file handoff + Go intake | 76.95/s | 74.26/s |
| 64 KiB answer, initial file handoff alone | 76.95/s | 75.25/s |
| 64 KiB answer, revised prepared rows alone | 76.95/s | 76.52/s |
| 64 KiB answer, prepared rows + Go intake | 76.95/s | 73.63/s |
| Ordinary answer, prepared rows alone | 90.00/s | 85.91/s |
| 64 extracted fields, prepared rows alone | 83.15/s | 80.52/s |

The file-backed result design was removed. Its extra filesystem operations and
SQLite JSON access did not help. The prepared-row implementation recovers the
large-answer regression but establishes no material win; the 64-field comparison
also fails to establish a win. **`GO_INTAKE=0` and `GO_RESULTS=0` remain defaults.**
Both prototypes are available explicitly for further evaluation. Merely moving
these operations to Go did not remove the measured bottleneck.

Bun still owns the public API and authoritative SQLite transactions. This work
does not claim that the public ingress/store has been fully ported to Go, or that
the application is now provider-bound. At 1,500 seven-second calls the ideal
ceiling is 214.3 calls/s, or about 85.7 one-page Documents/s for the benchmark's
five-calls-per-two-Documents workflow. The measured rendered path remains below it.

## Alternative renderers

The offline corpus covers color/text, a scan with a visible overlay, crop/rotation,
form appearances, transparency, a large page and the existing JBIG2 fixture.
MuPDF 1.27.0 and Poppler 26.01.0 are compared with PDF.js at matching dimensions.
Each fixture runs four times; the table uses the median of the last three.

| Fixture | PDF.js + current fast PNG | MuPDF | Poppler |
| --- | ---: | ---: | ---: |
| Color/text | 106.0 ms | 77.2 ms | 343.0 ms |
| Scan + overlay | 385.1 ms | 114.1 ms | 464.4 ms |
| Crop/rotation | 219.8 ms | 40.2 ms | 119.3 ms |
| Form appearances | 387.9 ms | 73.7 ms | 173.6 ms |
| Transparency | 57.9 ms | 72.5 ms | 196.7 ms |
| Large page | 670.7 ms | 107.2 ms | 242.1 ms |
| JBIG2 | 450.6 ms | 63.1 ms | 160.3 ms |

These are single-process render/encode/write timings, including CLI startup for
the alternatives, **not application Documents/s forecasts**. All dimensions
match after accounting for rotated Poppler scaling. Every alternative output has
pixel differences from the current renderer. MuPDF is promising, but neither
pixel metrics nor this generated corpus establish real-model extraction accuracy.
No alternative renderer becomes a production dependency or default. No DPI,
annotation handling, context isolation or extraction quality setting is reduced.
The experiment uses the documented [MuPDF draw interface](https://mupdf.readthedocs.io/en/1.28.0/tools/mutool-draw.html)
and the locally installed Poppler CLI's documented options.

## Durability, validation and reproduction

Source publication now flushes file contents and directory entries through every
ancestor before returning a key for database acceptance. Child views flush backing
bytes and their manifest. Directory barriers group concurrent publications for two
milliseconds, deepest first; a later rename cannot join an already-started flush.
Failed publication is not accepted. Ordinary failed publication removes its file.
This applies to both Bun and Go processing. No host power-loss test was performed;
tests verify barrier ordering, failure handling and process-crash recovery.

A supervisor race found during review was also fixed: concurrent requests now
share one restart, including cleanup of the previous process's private directories.

[Raw results and implementation hashes](benchmarks/results/optimization) audit
**18 runs, 63,193 completed Documents and 77,013 simulated model calls**. Expected
stage counts match exactly, all 699,871 expected result rows and their answers are verified in SQLite, all accepted work drains, and there are zero failed
Documents, invalid model requests or client network errors. Saturation rejects
6,966 upload attempts; these are not accepted work or completed Documents.
Earlier experimental records are explicitly separate from final Source-barrier
runs. No paid model calls were made.

Root typecheck, lint and build pass, together with 613 backend tests, the smoke test, 598 frontend tests, Go race tests/vet and 19 dedicated Go integration/group-commit tests. These cover
pixel equality and cancellation, parser compatibility, typed result persistence
and rollback, publication barriers, concurrent processor restart and existing
split/Template/extraction/accounting/recovery contracts. See ADR-0021 for the
execution and durability decisions.

```sh
bun run build:go
GO_PROCESSOR_BINARY=$PWD/.scratch/go-backend/document-extraction \
GO_MODEL_CONCURRENCY=96 GO_INTAKE=0 GO_RESULTS=0 \
LOOPBACK_BENCH_MODES=rendered-pages LOOPBACK_BENCH_SCENARIOS=split-automatic \
LOOPBACK_BENCH_RUNNER_CONCURRENCY=96 LOOPBACK_BENCH_BACKLOG=192 \
LOOPBACK_BENCH_SUBMITTERS=24 LOOPBACK_BENCH_DURATION_SECONDS=40 \
LOOPBACK_BENCH_WARMUP_SECONDS=10 bun run benchmark:loopback-saturation
```

For the matched serial baseline also set `GO_PDF_OVERLAP=0` and
`GO_PDF_WORKER_DOCUMENTS=32`. Go intake/results experiments use their respective
flags set to `1`; `LOOPBACK_BENCH_RESULT_FIELDS=64` tests many extracted fields.
The renderer comparison is `bun backend/benchmarks/pdfRendererComparison.bench.ts
.scratch/renderer-comparison` with the two optional CLI tools installed. It makes
no network/model calls and does not change the production rasterizer.
