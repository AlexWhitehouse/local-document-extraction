# Indexed work and resource admission

Large job histories made list searches, recovery, retention, and upload admission do work unrelated to the current request. Each Workspace's SQLite database remains the source of truth. Search and count indexes update within transactions. Gateway eligibility is determined before source preparation. Thus, sequential Workspace calls cannot consume all global extraction permits.

This decision revises ADR-0006. Workspaces with empty memory queues refill directly. Buffer overflow requests reconciliation. A repair sweep runs every 60 seconds for missed hints and abandoned work. Queued work sorts by retry due time or initial update time, then ID. Stale recovery excludes attempts that the current runner owns.

Free-space admission does not require a diagnostic scan of the filesystem. WAL with FULL durability requires SQLite 3.51.3 or newer. The current SQLite 3.51.0 runtime keeps rollback journaling.

Search uses bounded FTS5 trigram candidates. The original literal predicate determines the final matches. Broad terms use the date-ordered path. Short terms and terms containing NUL use literal scans. The migration fills indexes and exact totals once. Later job changes update them in the same transaction.

These indexes require more writes and disk space. In return, common reads do not depend on the volume of historical data.

Model preparation originally used an estimated shared budget of 256 MiB. [ADR-0010](0010-ram-aware-model-preparation.md) replaces this fixed budget with an allowance based on RAM. Reservations decrease after preparation. Rendered PNGs remain limited to 64 MiB in total. Rendering quality and inline transport remain unchanged.

Exports permit at most two workers. Each request permits at most 500 Documents and 32 MiB of stored answer/evidence data. These limits protect the local runtime. Gateway-managed files and lossy image conversion still require evidence of compatibility and extraction quality before adoption.
