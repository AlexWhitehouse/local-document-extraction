# Bounded extraction: Bun 1.3.14 versus 1.4.0

- Generated: 2026-08-20T18:12:01.884Z
- Repository: `457bec19e764` (dirty working tree)
- Host: darwin/arm64; 12 × Apple M3 Pro; 18432.00 MiB memory.
- Reproduce: `bunx bun@1.4.0 run --cwd backend benchmark:bun-runtime`
- Verdict: **PASS** against the project-local acceptable-regression policy below.

This is project-local capacity evidence for one synthetic bounded extraction workload. It is not a production capacity claim and is distinct from Bun's published framework and microbenchmark results.

## Workload identity and controls

Both runtimes reuse the exact files below, run 1 discarded warm-up repetition(s), then 3 fresh-state steady repetition(s). Model gateway latency and concurrency are synthetic and fixed; polling jitter is disabled.

| Fixture | Pages | Bytes | SHA-256 |
| ---: | ---: | ---: | --- |
| 1 | 2 | 1889720 | `e92572dbd7c91181f43eea6ef44212a8ddfa29da5150c7f154d467bf7a04ce6a` |
| 2 | 4 | 5036644 | `16808db012da419f79f88c13072b4fc2af4c9331b0651c4d948183880fd8736e` |
| 3 | 8 | 9966929 | `8b872d5986e2cfd183fb01221cb7063062fdf52883ff0346d15be761c0df035b` |

| Control | Value |
| --- | ---: |
| External workers | 40 |
| Admission permits | 4 |
| Runner permits | 4 |
| Model gateway concurrency | 4 |
| Model gateway latency | 30 ms |
| Polling interval | 10 ms |

## Runtime and aggregate results

| Runtime | Revision | Completed | Failed | Jobs/s mean (CV) | Lifecycle p50 mean | Lifecycle p95 mean | Peak RSS mean | CPU mean | Max lag mean | SQLite busy/retry |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bun 1.3.14 | `0d9b296af33f2b851fcbf4df3e9ec89751734ba4` | 120 | 0 | 3.01 (0.07%) | 9027.82 ms | 12943.16 ms | 393.95 MiB | 0.80% | 9.43 ms | 0/0 |
| Bun 1.4.0 | `34cbb9a40b4bd1bd767d134a7065e66c2432a676` | 120 | 0 | 2.79 (0.09%) | 9194.18 ms | 13626.06 ms | 366.41 MiB | 0.73% | 9.82 ms | 0/0 |

Coefficient of variation (CV) is population standard deviation divided by the mean across steady repetitions. Min/max and each individual result remain below so agents can see noisy or bimodal runs rather than relying on one average.

| Runtime | Rep | Completed/failed | Jobs/s | Lifecycle p50/p95 | Peak/baseline RSS | CPU | Max lag | Admission rejected/retried | Runner/queue/gateway peak | SQLite busy/retry |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bun 1.3.14 | 1 | 40/0 | 3.01 | 8683.36/12272.70 ms | 409.58 MiB/216.05 MiB | 0.84% | 9.37 ms | 147/147 | 4/4/4 | 0/0 |
| Bun 1.3.14 | 2 | 40/0 | 3.01 | 9209.28/13283.70 ms | 396.23 MiB/216.83 MiB | 0.77% | 9.43 ms | 160/160 | 4/4/4 | 0/0 |
| Bun 1.3.14 | 3 | 40/0 | 3.01 | 9190.81/13273.07 ms | 376.03 MiB/217.27 MiB | 0.80% | 9.49 ms | 152/152 | 4/3/4 | 0/0 |
| Bun 1.4.0 | 1 | 40/0 | 2.79 | 9183.89/14302.52 ms | 357.77 MiB/216.13 MiB | 0.71% | 9.07 ms | 172/172 | 4/1/4 | 0/0 |
| Bun 1.4.0 | 2 | 40/0 | 2.80 | 9198.89/13284.01 ms | 391.13 MiB/209.25 MiB | 0.70% | 10.39 ms | 153/153 | 4/3/4 | 0/0 |
| Bun 1.4.0 | 3 | 40/0 | 2.79 | 9199.75/13291.66 ms | 350.34 MiB/203.94 MiB | 0.77% | 9.99 ms | 162/162 | 4/2/4 | 0/0 |

### Aggregate range and variance

| Runtime | Metric | Min | Mean | Max | Coefficient of variation |
| --- | --- | ---: | ---: | ---: | ---: |
| Bun 1.3.14 | Jobs/s | 3.01 | 3.01 | 3.01 | 0.07% |
| Bun 1.3.14 | Lifecycle p50 | 8683.36 ms | 9027.82 ms | 9209.28 ms | 2.70% |
| Bun 1.3.14 | Lifecycle p95 | 12272.70 ms | 12943.16 ms | 13283.70 ms | 3.66% |
| Bun 1.3.14 | Peak RSS | 376.03 MiB | 393.95 MiB | 409.58 MiB | 3.50% |
| Bun 1.3.14 | Normalized CPU | 0.77% | 0.80% | 0.84% | 3.70% |
| Bun 1.3.14 | Maximum event-loop lag | 9.37 ms | 9.43 ms | 9.49 ms | 0.52% |
| Bun 1.4.0 | Jobs/s | 2.79 | 2.79 | 2.80 | 0.09% |
| Bun 1.4.0 | Lifecycle p50 | 9183.89 ms | 9194.18 ms | 9199.75 ms | 0.08% |
| Bun 1.4.0 | Lifecycle p95 | 13284.01 ms | 13626.06 ms | 14302.52 ms | 3.51% |
| Bun 1.4.0 | Peak RSS | 350.34 MiB | 366.41 MiB | 391.13 MiB | 4.84% |
| Bun 1.4.0 | Normalized CPU | 0.70% | 0.73% | 0.77% | 3.75% |
| Bun 1.4.0 | Maximum event-loop lag | 9.07 ms | 9.82 ms | 10.39 ms | 5.65% |

## Acceptable-regression policy

Throughput may fall by at most 10%. Mean lifecycle p95 may grow by at most 15%. Peak RSS, normalized CPU, and event-loop lag may grow by at most 15%, with 32 MiB, two normalized-CPU percentage points, and 10 ms practical noise floors respectively. Candidate runs must complete every job without an observed SQLite busy outcome.

| Check | Actual | Threshold | Result |
| --- | --- | --- | --- |
| Throughput | 2.79 jobs/s | Bun 1.4 mean must be at least 90% of Bun 1.3.14 (≥ 2.71 jobs/s) | PASS |
| Lifecycle p95 | 13626.06 ms | Bun 1.4 mean must be no more than 115% of Bun 1.3.14 (≤ 14884.63 ms) | PASS |
| Peak RSS | 384210261.33 bytes | Bun 1.4 mean must be within +15% or a 32 MiB noise floor (≤ 475046980.27 bytes) | PASS |
| Normalized CPU | 0.01 | Bun 1.4 mean must be within +15 percentage-relative or a 2-point noise floor (≤ 0.03) | PASS |
| Maximum event-loop lag | 9.82 ms | Bun 1.4 mean must be within +15% or a 10 ms noise floor (≤ 19.43 ms) | PASS |
| Completion and SQLite integrity | 0 failed, 0 SQLite busy outcomes | No failed jobs and no observed SQLITE_BUSY outcome | PASS |

## Bun 1.4 native Markdown profiles

The profiling repetition uses the same synthetic fixtures and bounded settings. Bun's raw Markdown profiles stay under ignored `raw/` scratch state. Shareable copies are path- and credential-scrubbed at [`19-bun-runtime-profiles/cpu.md`](19-bun-runtime-profiles/cpu.md) and [`19-bun-runtime-profiles/heap.md`](19-bun-runtime-profiles/heap.md). Profiles help explain an observed comparison; they are not added to the timed steady repetitions.

### CPU profile findings

- | 69.0% | 10.21s | 69.0% | 10.21s | `rss` | `[native code]` |
- | 9.0% | 1.33s | 9.0% | 1.33s | `get` | `[native code]` |
- | 3.5% | 518.4ms | 3.5% | 518.4ms | `all` | `[native code]` |
- | 3.3% | 503.3ms | 3.3% | 503.3ms | `async (anonymous)` | `<repo>/.scratch/high-throughput-local-pdf-extraction/prototype/throughput.ts:486` |
- | 2.1% | 319.6ms | 2.1% | 319.6ms | `run` | `[native code]` |

### Largest retained objects

- | 1 | 0 | `<root>` | 0 B | 23.8 MB | 8360 | 0 |
- | 2 | 114239 | `ModuleRecord` | 848 B | 1.2 MB | 2 | 5 |
- | 3 | 114292 | `JSModuleEnvironment` | 160 B | 1.2 MB | 23 | 1 |
- | 4 | 8538 | `ModuleRecord` | 952.2 KB | 952.2 KB | 2 | 5 |
- | 5 | 32145 | `JSModuleEnvironment` | 2.6 KB | 850.7 KB | 627 | 2 |

### Heap retention paths

- 1. Object #0 - `<root>` (23.8 MB retained): (no path to GC root found)
- 2. Object #114239 - `ModuleRecord` (1.2 MB retained): GlobalObject#42 [ROOT] (10.4 KB) JSModuleEnvironment#31525 (224 B) -> ModuleRecord#31643 (25.2 KB) -> ModuleRecord#31695 (49.1 KB) -> ModuleRecord#114218 (18.3 KB) -> ModuleRecord#114239 (848 B)
- 3. Object #114292 - `JSModuleEnvironment` (1.2 MB retained): GlobalObject#42 [ROOT] (10.4 KB) JSModuleEnvironment#31525 (224 B) -> ModuleRecord#31643 (25.2 KB) -> ModuleRecord#31695 (49.1 KB) -> ModuleRecord#114218 (18.3 KB) -> ModuleRecord#114239 (848 B) -> JSModuleEnvironment#114292 (160 B)
- 4. Object #8538 - `ModuleRecord` (952.2 KB retained): GlobalObject#42 [ROOT] (10.4 KB) FunctionCodeBlock#8461 (74.3 KB) -> JSModuleEnvironment#8483 (432 B) -> ModuleRecord#8504 (20.2 KB) -> ModuleRecord#8517 (3.0 KB) -> ModuleRecord#8538 (952.2 KB)
- 5. Object #32145 - `JSModuleEnvironment` (850.7 KB retained): FunctionCodeBlock#227206 [ROOT] (2.6 KB) FunctionRareData#31838 (80 B) -> FunctionExecutable#31857 (128 B) -> FunctionCodeBlock#31882 (2.5 KB) -> FunctionExecutable#31928 (128 B) -> FunctionCodeBlock#32000 (2.7 KB) -> JSModuleEnvironment#32145 (2.6 KB)

## Reproduction and safety

```bash
bunx bun@1.4.0 run --cwd backend benchmark:bun-runtime
```

The command launches both exact Bun versions with `--no-env-file` and a minimal environment, creates only synthetic PDF attachments, uses a loopback fake Model gateway, resets application state for every repetition, keeps raw artifacts in ignored scratch state, and sanitizes the Markdown copies before publishing them. No Source file content, account identity, session/auth value, or Model gateway credential is intentionally read.
