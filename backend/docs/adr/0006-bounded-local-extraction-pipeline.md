# Bounded Local Extraction Pipeline

Each Workspace's SQLite database is the durable work queue for the single-machine runtime. Bounded structures in memory only make scheduling faster. Multipart admission, active extraction, database ownership, polling, source retention, and resource control share explicit local capacity limits.

[ADR-0009](0009-indexed-work-and-resource-admission.md) revises scheduling, indexed reads, and storage admission.

## Consequences

- Multipart Documents stream through bounded parser buffers into unique temporary files. After metadata and page-count validation, the runtime promotes each file in one atomic operation.
- The process owns one SQLite connection per active Workspace and tracks its leases. It removes only idle connections. Writes use short rollback-journal transactions. WAL stays disabled while Bun contains an affected SQLite version.
- The extraction queue limits active handlers and buffered metadata. It prevents duplicate attempts and rotates Workspaces. Periodic SQLite reconciliation recovers overflow and work interrupted by a restart.
- Gateway retries separate deterministic failures from retryable `408`, `429`, and `5xx` responses. Retries obey `Retry-After` and use bounded full jitter.
- Job polling uses `ETag`, `If-None-Match`, `304`, and `Retry-After`. Reads of unchanged or nonterminal jobs do not load result rows.
- The runtime deletes completed Source binaries immediately. It keeps failed Source binaries for seven days by default. Job metadata, error details, and results remain in durable storage indefinitely. [ADR-0013](0013-retained-source-files.md) exempts retained originals from both cleanup rules.
- A local controller monitors queue depth, completed throughput, gateway outcomes, CPU, RSS/external memory, and event-loop delay. It also monitors free disk space, Source bytes, SQLite bytes, and WAL bytes. It can pause or adjust extraction permits to enforce the 85% CPU and 80% memory limits.
- `/v1/health` provides aggregate local diagnostics. Environment variables configure capacity and retention on macOS and Linux hosts that Bun supports.
