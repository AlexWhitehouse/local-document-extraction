# Document processing throughput

> Historical experiment record. ADR-0022 makes Go mandatory and removes the intake/result prototypes and Bun engine. Commands referring to those paths describe the measured revision, not the current runtime.


For the subsequent provider-wait and PNG-encoding improvements, see
[the stage-capacity follow-up](STAGE-BENCHMARKS.md). The measurements below describe
the first architecture, before that follow-up.

Measured on the development host using synthetic documents and a loopback model
provider. No paid model calls were made. The public `POST /v1/extract` API,
authentication, multipart uploads, PDF validation, SQLite persistence, smart
splitting, template selection, extraction result normalization and live updates
all participate. This is an end-to-end workload, not a Go-only microbenchmark.

## Bottlenecks and changes

The question was which work could be removed or overlapped without changing the
model inputs, validators, results or durable acceptance contract.

| Observed work | Decision |
| --- | --- |
| Automatic selection and extraction each render the same PDF | Keep task-scoped rendered artifacts and reuse them. No cache spans unrelated Documents. |
| Renderer imports/startup repeated as worker RSS exceeded the old retirement threshold | Use a separate warm renderer pool with its own retirement threshold; tune 2, 4, then 6 workers on this host. |
| Render worker parsed an admitted PDF through pdf-lib before PDF.js, without using the first result | Remove that redundant parse. Public upload inspection and materialization validation remain. |
| Complete base64 strings and complete model request JSON allocated before sending | Stream source files through Go base64 encoders with bounded buffers and exact Content-Length. |
| Concurrent SQLite operations each paid for a separate durable commit | Batch concurrent acceptance and processing writes by Workspace. Each operation has a savepoint; acknowledgements follow the outer FULL-synchronous commit. |
| Initial Go adapter sent full model content again solely for accounting | Forward only the original usage/cost/currency/request-ID fields to accounting. Normalize and persist the extraction content separately. |
| Preparing the next document can leave a provider slot idle | Separate active Document runs from the model-call limit; test additional preparation concurrency at the same model-call limit. |

A 15-second diagnostic profile of the original inline path attributed 37% of
sampled time to native `run` calls (including SQLite), 13.1% to JSON stringification,
and 6.6% to string conversion. The Go path's Bun profile removed stringification
and conversion from the leading costs. Native database and file operations remain
important. These profiles include waiting in native calls and profiling overhead;
they locate work, not provide capacity measurements. Capacity runs disable profiling.

## Method

The host has six reported CPUs (Intel Haswell virtual CPU), 11.4 GiB RAM and an
ext4 filesystem on `/dev/sda1`. The physical disk medium is not identified.
Bun is 1.4.2 and Go is 1.27.1. Each comparison runs sequentially on the same host,
without test/build workloads running alongside it.

The main comparison uses 60 seconds of load per scenario, excluding the first
10 seconds from throughput, 24 active Document permits, 24 submitters and a backlog
of 24 uploads. Both versions receive identical fixture bytes: a two-page PDF with
1 MiB of deterministic incompressible attachment data in inline mode, and a
two-page text/vector PDF in rendered mode. Split workloads produce two extracted
Documents per upload. Templates and model replies are deterministic.

The shared Bun preparation memory setting is 512 MiB. The Go processor instead
bounds preparation through separate worker pools and artifact limits; its memory
budget is not identical. Reported RSS sums the complete application process tree,
including PDF workers, and can double-count shared pages. Higher throughput must
be assessed alongside this memory tradeoff. The six-renderer setting was selected
for this host, not asserted as an optimal setting for every machine.

Completed Documents/second is calculated from persisted completion timestamps
inside the measurement window. A `202` alone never counts as completed work. All
accepted work must drain, and model-stage counts must match the workload. Expected
`503` capacity responses are counted separately; they are not lost accepted work.
Successful admission response times cover upload transfer through reading the
`202` response body, exclude rejected requests, and are separate from lifecycle
latency. Backlog-limited acceptance rate is not an admission-only capacity claim.

## Main comparison

| PDF mode / scenario | Bun Documents/s | Go Documents/s | Speedup | p95 ms, Bun → Go | Peak tree MiB, Bun → Go |
| --- | ---: | ---: | ---: | ---: | ---: |
| inline-pdf / explicit | 45.42 | 66.13 | 1.46× | 172 → 519 | 798 → 770 |
| inline-pdf / automatic | 31.31 | 45.45 | 1.45× | 285 → 792 | 803 → 791 |
| inline-pdf / split-explicit | 38.86 | 45.74 | 1.18× | 1,731 → 1,759 | 949 → 1005 |
| inline-pdf / split-automatic | 23.05 | 35.24 | 1.53× | 6,543 → 2,229 | 944 → 1045 |
| rendered-pages / explicit | 4.40 | 8.30 | 1.89× | 8,964 → 5,262 | 723 → 1603 |
| rendered-pages / automatic | 2.08 | 7.88 | 3.79× | 20,966 → 5,416 | 700 → 1610 |
| rendered-pages / split-explicit | 4.00 | 7.12 | 1.78× | 22,041 → 12,723 | 802 → 1781 |
| rendered-pages / split-automatic | 2.64 | 7.18 | 2.72× | 32,626 → 12,162 | 799 → 1793 |

All 22,521 accepted Documents across these two runs completed successfully.
There were no missing Documents, unexpected model-stage counts, invalid gateway
requests, network errors or drain failures. Expected admission backpressure did
occur. [The complete comparison](benchmarks/COMPARISON.md) includes its counts and
Go admission timing. Raw aggregate evidence is checked in under
[benchmarks/results](benchmarks/results).

Throughput improves in every scenario, but latency does not uniformly improve:
explicit and automatic inline Documents have higher lifecycle p95 in the Go run.
This is a saturation/queueing tradeoff, not evidence of lower latency at all loads.
Rendered workloads benefit most from parallel preparation and reuse, while also
using more memory. The figures are single long passes, supported by shorter tuning
runs; they are not confidence intervals or universal capacity guarantees.

## Tuning history

Initial Go measurements did not beat Bun consistently. A first rendered run also
failed its drain deadline and is excluded from successful comparisons. Investigation
found repeated renderer retirement, inefficient small streaming writes, and a
watchdog race that could kill a worker after returning it to the pool. Fixes were
validated before collecting the main comparison.

In exploratory 15-second runs (3-second warm-up, 24 permits/submitters/backlog),
increasing renderer workers from two to four changed explicit rendered throughput
from 4.25 to 7.66 Documents/s, and split+automatic from 2.17 to 5.91. Six workers
subsequently measured 8.50 and 7.00. These short runs guided configuration; the
60-second comparison above is the reported capacity evidence. Other changes
include buffered streaming, durable batching, callback connection reuse, and the
redundant-work removals described above. Individual gains are not claimed as
independent additive effects.

## Larger provider responses

A matched 30-second inline explicit run, excluding five warm-up seconds, used
64 KiB extraction answers (the actual field value, not unused padding). Bun
completed **42.36 Documents/s** and Go **60.27 Documents/s**: **1.42×** throughput.
Successful upload response p95 fell from **686 ms to 428 ms**. Both runs drained
without failed or missing work. A separate integration test asserts that the
entire 64 KiB answer and its model cost are persisted correctly.

Raw evidence: [Bun](benchmarks/results/bun-response.json) and
[Go](benchmarks/results/go-response.json).

## Provider-delay tests

The ideal steady-state Document rate is `model concurrency / (provider delay ×
model calls per Document)`: one call for explicit extraction and 2.5 calls per
Document for split+automatic. The model-call limit remains **24** in every row.
Increasing active Documents to 48 allows preparation to run ahead without sending
more than 24 simultaneous model calls. Peak gateway concurrency was 24.

| Engine / mode / scenario | Active Documents | Model delay | Documents/s | Ideal ceiling | Rate / ceiling | Admission p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bun / inline-pdf / explicit | 24 | 1 s | 22.60 | 24.00 | 94.2% | 448 |
| bun / inline-pdf / split-automatic | 24 | 1 s | 9.20 | 9.60 | 95.8% | 678 |
| go / inline-pdf / explicit | 24 | 1 s | 21.87 | 24.00 | 91.1% | 312 |
| go / inline-pdf / split-automatic | 24 | 1 s | 9.20 | 9.60 | 95.8% | 711 |
| go / inline-pdf / explicit | 48 | 1 s | 23.23 | 24.00 | 96.8% | 301 |
| go / inline-pdf / split-automatic | 48 | 1 s | 9.13 | 9.60 | 95.1% | 715 |
| go / rendered-pages / explicit | 48 | 5 s | 4.73 | 4.80 | 98.6% | 739 |
| go / rendered-pages / split-automatic | 48 | 5 s | 1.77 | 1.92 | 92.0% | 672 |

The 1-second tests use 40 seconds of load with 10 seconds excluded. The 48-Document
configuration also increases backlog from 24 to 96 so it can keep preparation
supplied. This is an explicit configuration experiment, not a same-settings
language comparison. The matched 24-permit Go test was slightly slower for
explicit extraction and tied for split+automatic; a Go rewrite alone does not
remove preparation gaps.

The 5-second explicit test uses the same 40/10-second window. Split+automatic was
rerun for **120 seconds with a 60-second warm-up and backlog 48**: the initial
40-second run's 1.00 Documents/s was dominated by filling a multi-stage pipeline
and its backlog. That earlier run remains in the evidence and completed all work;
it is not presented as a steady-state capacity result. This rerun demonstrates why
short runs against slow providers can give misleading completion rates.

With preparation run-ahead, measured rates are approximately **92–99% of the
ideal provider ceiling** for these workloads. The ceiling is an arithmetic bound,
not a direct utilization sample; finite windows, pipeline boundaries, transfers
and backend work account for the gap. This supports provider-limited operation
under the tested delays, not a claim that no workload or faster provider can
bottleneck the host. The zero-delay matrix quantifies the backend's own capacity.

## Reproduce and verify

```sh
bun run build:go
LOOPBACK_BENCH_DURATION_SECONDS=60 LOOPBACK_BENCH_WARMUP_SECONDS=10 \
LOOPBACK_BENCH_BACKLOG=24 LOOPBACK_BENCH_SUBMITTERS=24 \
bun run benchmark:loopback-saturation

GO_PROCESSOR_BINARY=$PWD/.scratch/go-backend/document-extraction GO_PDF_WORKERS=6 \
LOOPBACK_BENCH_DURATION_SECONDS=60 LOOPBACK_BENCH_WARMUP_SECONDS=10 \
LOOPBACK_BENCH_BACKLOG=24 LOOPBACK_BENCH_SUBMITTERS=24 \
bun run benchmark:loopback-saturation

python3 backend-go/benchmarks/compare.py <bun-result.json> <go-result.json>
bun run test:go
```

Each raw result includes its benchmark command/settings and fixture SHA-256.
Prefix the recorded command with `GO_PROCESSOR_BINARY` for Go runs; for the
run-ahead probes also set `GO_MODEL_CONCURRENCY=24`, since their Document limit is
48. The comparison script rejects mismatched fixtures/settings or incomplete,
failed, invalid or unexpected work. [Implementation evidence](benchmarks/results/implementation.json)
records the measured source hashes, base revision and binary hash. After capacity
measurements, an observer-failure guard was added to keep failed live-update or
diagnostic callbacks from changing durable outcomes; it has its own regression test.

Across all nine recorded runs, 30,487 Documents completed and passed the aggregate
validation checks.

Validation includes the root Bun typecheck, lint, backend/frontend tests and
frontend build; Go race tests and vet; and real-process integration tests for
smart selection/splitting, accounting, invalid-plan reassessment, throttling,
terminal errors, rendered-image equivalence/reuse, large answers, source cleanup,
forced process termination/recovery, and failed observers. Durable batching is
tested for independent rollback, cancellation and visibility after reopening.

The remaining local limits are public API/admission and authoritative SQLite work
on the Bun event loop, CPU-heavy rendering when the model cannot consume PDFs,
and filesystem/network bandwidth. Authentication and product rules were retained
because removing them is not an acceptable throughput optimization. No rendering
resolution, prompt, validator or durability relaxation was used to obtain these
results. No real-provider extraction-quality evaluation was performed; model
behavior is simulated and the existing quality-sensitive implementation is reused.
