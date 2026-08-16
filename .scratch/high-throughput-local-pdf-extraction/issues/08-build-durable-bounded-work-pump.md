# Build the durable bounded Extraction work pump

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Replace immediate unbounded dispatch with a database-reconciled work-pump module. The module owns global count/byte permits, bounded runner and Model gateway stages, Workspace round-robin fairness, incremental due-job discovery, owner-aware atomic claims, durable jittered retries, restart reconciliation, and overload telemetry behind a small wake/shutdown interface.

## Acceptance criteria

- Accepted work remains durable when an in-memory wake is lost or the process restarts.
- Active jobs, prepared bytes, and gateway calls never exceed configured ceilings.
- Multiple Workspaces receive round-robin service without reducing single-Workspace utilization.
- Claims/terminal writes reject stale owner or attempt results.
- Retry classification honors gateway `Retry-After` and persists jittered due time.
- Recovery pages through the active backlog and never materializes all queued jobs.
- Existing lifecycle, cleanup, deletion, and live-update behavior remains correct.

## Blocked by

- Own Workspace SQLite connections for the process lifetime.

## Resolution

Implemented a bounded metadata queue with Workspace round-robin fairness, attempt deduplication, delayed retry scheduling, durable-overflow deferral, batched periodic SQLite reconciliation, atomic attempt claims, and `Retry-After`-aware full-jitter retries. The queue is a wake accelerator; SQLite remains authoritative across restart.
