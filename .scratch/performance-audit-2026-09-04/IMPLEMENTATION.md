# Performance implementation

Implemented the audit's measured database, admission, queue, browser, export and analytics improvements. Runtime limits and migration behavior are documented in [docs/performance.md](../../docs/performance.md); [ADR-0009](../../backend/docs/adr/0009-indexed-work-and-resource-admission.md) revises the earlier scheduling decision.

## Measurements

Synthetic temporary databases and filesystem fixtures on Apple M3 Pro, Bun 1.4.1, SQLite 3.51.0. No live databases or model services were used. SQL and reconciliation figures are warm medians; directory measurements are single observations. These measure individual operations, not end-to-end extraction throughput.

| Operation | Before | After |
| --- | ---: | ---: |
| Deep pagination, 1m jobs | 57.82 ms | 0.061 ms |
| No-match substring search, 1m jobs | 462.43 ms | 0.015 ms |
| Exact total, 1m jobs | 6.03 ms | 0.0043 ms |
| Retention, 100 remaining Sources among 1m jobs | 324.09 ms | 0.053 ms |
| Retention, no remaining Sources among 1m jobs | 339.45 ms | 0.020 ms |
| Recover first 1,000 of 1m queued jobs | 155.47 ms | 0.216 ms |
| Upload capacity check, 10k empty directories | 311.32 ms | 0.041 ms |
| Select a Document among 10k reconciled rows | 1.54 ms | 0.035 ms |
| Five-write lifecycle, rollback journal + FULL | 1.35 ms | 1.53 ms |

The scheduling fixture now starts one gateway request from each Workspace immediately. Previously eight serial jobs from Workspace A occupied all eight permits while Workspace B waited. The revised fixture supplies the same per-Workspace concurrency policy as the production server.

Index maintenance adds about 0.18 ms (13%) to this small lifecycle fixture, plus storage and a one-time migration backfill. Status transitions avoid FTS updates because the search index contains stable metadata. Short terms, status terms and broad searches retain the literal scan path. Updating a live row still sorts the visible reconciliation collection; the measured improvement above applies to selection-only updates.

Raw before results: [queries](results.json), [pipeline](pipeline-results.json). Raw after results: [queries](after-results.json), [pipeline](after-pipeline-results.json). In timing objects, `current` calls the checked-out production store and `candidate` calls the standalone proposed SQL. Query plans explicitly distinguish the original and proposed SQL. Run the fixtures with `bun --no-env-file .scratch/performance-audit-2026-09-04/benchmark.ts` and `bun --no-env-file .scratch/performance-audit-2026-09-04/pipeline-benchmark.ts`.

## Verification

- `bun run ci:quality` passed: typecheck, lint, 246 backend tests, the full runtime smoke test, 261 frontend tests, unchanged coverage thresholds, and production build. [Captured output](quality-output.txt).
- `bun run test:e2e` passed all four browser journeys and three evidence-support tests. [Captured output](e2e-output.txt).
- Focused regressions cover migration backfill, literal search and index updates, queue eligibility/refill, owned-attempt recovery, admission sampling, empty-directory cleanup, export limits and real worker output, cancellation and byte budgets, analytics batching, upload concurrency/retries, cache eviction and list windowing/keyboard navigation.

## Remaining opportunities

WAL + FULL measured faster but remains disabled on this runtime's SQLite 3.51.0; automatic opt-in requires at least 3.51.3 because of the WAL-reset fix. PDF rendering and page-count CPU work can still block the main thread; moving them to workers deserves its own decoder-memory and cancellation benchmarks. Gateway-managed files and alternative image formats need compatibility and extraction-quality evidence. Persistent browser caching is now bounded but still synchronous localStorage; IndexedDB remains a possible follow-up. Source-byte telemetry still enumerates storage in the background, outside upload admission. None of these opportunities is ruled out by the existing ADRs.
