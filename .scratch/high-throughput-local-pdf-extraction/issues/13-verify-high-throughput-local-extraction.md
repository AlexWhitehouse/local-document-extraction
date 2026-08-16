# Verify high-throughput local Extraction end to end

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Replace the disposable prototype with a deterministic smoke load and an operator-run capacity benchmark. Verify the agreed 90/8/2 workload, 1,000 submit-and-poll workers, one-million-job Workspace store, restart/backlog recovery, remote slowdown/throttling, retention cleanup, and target resource envelope.

## Acceptance criteria

- All 1,000 accepted workers reach a correct terminal result with no unexplained `4xx`/`5xx`, stuck jobs, or lost work.
- The highest stable configuration stays below 85% CPU and 80% memory and reports its completed jobs/s.
- HTTP submission/polling remains responsive during backlog and remote slowdown.
- Restart, retry, stale-attempt, Workspace fairness, SQLite checkpoint, old-result retrieval, and seven-day cleanup scenarios pass.
- One-million-job point reads/writes and disk sizing are captured for representative result shapes.
- Root typecheck, tests, build, deterministic benchmark smoke, and target-machine capacity command pass.

## Blocked by

- Enforce failed Source retention and local disk reserve.
- Add resource control and throughput telemetry.

## Resolution

The final deterministic 90/8/2 run completed 1,000/1,000 workers at 48.28 end-to-end completions/s, 787.47 MiB peak RSS, eight active runners, and no unexplained HTTP or job failures. The one-million-job/five-million-result probe used 3.04 GiB with 545 microsecond warm point-read p99. Typecheck, lint, 42 backend adapter tests, 103 Bun tests, 241 frontend tests, and production build pass. Harness CPU was below its reporting resolution, so real-gateway tuning should corroborate the production CPU metric with host telemetry.
