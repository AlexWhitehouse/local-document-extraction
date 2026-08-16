# Does the researched design meet the target-machine acceptance envelope?

Category: prototype
Status: completed
Labels: wayfinder:prototype, completed
Assignee: root

## Parent

../PRD.md

## Decision question

When exercised with the agreed workload mix and 1,000 independent submit-and-poll clients, does the combined recommended design maximize stable completed-job throughput while keeping the server responsive and below 85% CPU and 80% memory on the target machine?

## Prototype brief

- Build a disposable, reproducible load harness around the real local HTTP, persistence, queue/recovery, PDF, lifecycle, and polling paths.
- Use generated representative PDFs matching the 90/8/2 size and page distribution, without committing large binary fixtures.
- Use a controllable fake Model gateway with configurable latency, concurrency, throttling, transient failures, and response sizes so local behavior is deterministic.
- Establish a baseline from the current implementation, then test the researched processing, SQLite, PDF-data-path, and polling recommendations independently and together.
- Capture completed jobs per minute, submission and polling latency distributions, queue depth/age, event-loop responsiveness, CPU, RSS/heap/external memory, SQLite busy/checkpoint behavior, Model gateway in-flight work, retries, and errors.
- Test sustained load, a burst, remote slowdown/throttling, process restart with a backlog, failed-Source-file cleanup, and retrieval of older terminal results.
- Include a reduced deterministic smoke profile suitable for the normal test suite and a longer operator-run capacity profile for the target host.
- Stop and report evidence if any recommended refactor adds complexity without a material throughput or stability benefit.

## Resolution criteria

- Baseline and candidate results are reproducible and stored as a concise Markdown benchmark report plus machine-readable raw summaries.
- The winning design stays below the agreed resource ceilings during steady state; overload behavior is bounded and recoverable during bursts.
- The API remains responsive to 1,000 concurrent workers and accepted jobs survive restart.
- One-million-job persistence behavior is represented by a seeded-store read/write benchmark even if a million real model calls are not executed.
- The report recommends which candidate changes to implement, revise, or reject and provides evidence for each decision.
- The map can be expanded into implementation tickets without unresolved architectural assumptions.

## Blocked by

None - all four research decisions are complete.

## Comments

Unblocked after resolving the processing-control, SQLite/retention, PDF data-path, and individual-polling research tickets. Prototype before expanding the production implementation frontier.

Resolved by [`../prototype/RESULTS.md`](../prototype/RESULTS.md). Bounded admission/execution preserved throughput while halving RSS growth and reducing event-loop lag, but the 1,000-worker run completed only 992 jobs: eight concurrent submissions failed through the current per-request SQLite connection path. Proceed with the evidence-ranked implementation frontier; the final acceptance benchmark remains a separate downstream ticket.
