# Bounded Local Extraction Pipeline

The single-machine runtime treats per-Workspace SQLite as the durable work queue and keeps bounded in-memory structures only as scheduling accelerators. Multipart admission, active extraction, database ownership, polling, source retention, and resource control share explicit local capacity limits.

Scheduling, indexed reads, and storage-admission details are revised by [ADR-0009](0009-indexed-work-and-resource-admission.md).

## Consequences

- Multipart Documents stream through bounded parser buffers into unique temporary files and are atomically promoted after metadata and page-count validation.
- The process owns one lease-aware SQLite connection per active Workspace, evicts only idle owners, and uses short rollback-journal writes. WAL remains gated while Bun embeds an affected SQLite version.
- The extraction queue bounds active handlers and buffered metadata, deduplicates attempts, rotates Workspaces, and relies on periodic SQLite reconciliation for overflow and restart recovery.
- Gateway retries distinguish deterministic failures from retryable `408`, `429`, and `5xx` responses, honor `Retry-After`, and use bounded full jitter.
- Individual job polling uses `ETag`, `If-None-Match`, `304`, and `Retry-After`; nonterminal and unchanged reads do not hydrate result rows.
- Completed Source binaries delete immediately. Failed Source binaries remain for seven days by default, while job metadata, error details, and results remain durable indefinitely.
- A local controller observes queue depth, completed throughput, gateway outcomes, CPU, RSS/external memory, event-loop lag, free disk, Source bytes, SQLite bytes, and WAL bytes. It can pause or adjust extraction permits while enforcing the 85% CPU and 80% memory limits.
- `/v1/health` exposes aggregate local diagnostics. Capacity and retention settings remain configurable through environment variables for Bun-supported macOS and Linux hosts.
