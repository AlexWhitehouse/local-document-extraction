# Persisted packet completion and targeted reconciliation

Status: implemented. Revises ADR-0009 (reconciliation and search) and ADR-0016 (packet completion).

Grouped listing, packet reads, the scheduler and reconciliation did work proportional to page size, packet size or Workspace count. Some reads also wrote. SQLite remains the source of truth for every decision below.

## Packet completion is written, not derived on read

A **Document packet** in `processing_children` becomes `completed` or `failed` in the transaction that completes, fails, exhausts or deletes its last remaining child. This also applies when materialization finishes after every child has already finished. The same write sets `updated_at`. Packet reads never change packet state and take no write lock.

One rule, `finishedPacketStatus` in `documentPacketCompletion.ts`, decides completion for the packet store and the Workspace cost projection. Deleted children neither block nor fail a packet. If every child was deleted, the packet completes. A remaining failed child fails the packet. The packet store also counts a child slot whose job row is missing as deleted. This matches the earlier read path. The cost projection keeps such a slot pending. That state cannot occur in practice, because deleting a job marks its slot deleted in the same transaction.

Schema version 16 reconciles packets left in `processing_children` after all their remaining children had finished. Before this change, only a read persisted that transition.

Observable change: a finished packet's `updated_at` now records when it finished. Failed-source retention for a failed packet therefore starts at failure, not at the end of materialization.

## Batched hydration

A grouped page loads job summaries, routing, costs, packet rows, child slots and source flags with a fixed number of queries, whatever the page or packet size. ID lists are bound as one JSON array through `json_each(?)`, so the statement cache never holds a separate statement for each list length. Single-entity reads use the same code path, so their output is identical.

## Grouped search and cursors

Grouped search uses the same bounded trigram candidate step as the job list. Schema version 15 adds `packet_search` over `document_packets(source_name, id)`, kept in step by triggers. The literal `LIKE` predicate still determines every match. Status terms, short terms, terms containing NUL and broad terms use the literal path. A packet matches by its own metadata or through any child Document. Matching packet IDs are collected first, so indexed lookups drive the query.

The grouped cursor still orders by `(created_at, '<kind>:' || id)`. It now resolves the cursor against each kind's prefix. Each kind's boundary compares indexed columns directly, `created_at <= ? AND (created_at < ? OR id < ?)`, instead of comparing a row value over a concatenated expression. Ordering and results are unchanged.

## Opening a store

Opening a database that records every known schema version runs no DDL. Any other database runs every idempotent initializer, and each one applies only its missing steps. A new versioned step must be added to the known version list.

## Scheduler and reconciliation

- The scheduler reads each Workspace's concurrency limit from an in-memory cache. A committed model-configuration save or clear invalidates the cache, as do Workspace access revocation, erasure and the startup global-configuration retirement. A failed or missing read is not cached. The conservative limit of one applies until a later pass reads the configuration.
- Each Workspace queue keeps packet and Document work in separate FIFOs, so alternating between them is O(1). Deferred retries stay sorted by binary insertion.
- The first recovery in a process sweeps every Workspace. It re-queues every unowned `processing` job and packet at once, because nothing can be in flight before that pass. Later passes keep the five-minute stale threshold.
- Periodic reconciliation visits only Workspaces that may have pending work. Every admission path records its Workspace before it hands the job to the memory queue, which may defer or drop the job. A visit drops a Workspace once it has no queued, retrying, processing or packet-analysis work and no running attempts. That check and the removal run synchronously, after the admitting row has committed. A full sweep runs every 15 minutes as a safety net for work written outside the admission paths. No work is lost across a restart, because the in-memory set is rebuilt by the startup sweep.

## Storage telemetry

The diagnostic Source byte total is sampled from a walk of the Source tree every 15 minutes, not every minute. Database file sizes come from one flat directory and are still read every minute. Incremental tracking was rejected because the Go processor and several Bun paths create and remove Sources. Admission never depends on this total.
