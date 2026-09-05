# RAM-aware model preparation

This revises ADR-0009's fixed 256 MiB shared preparation budget. Its worst-case
reservation of roughly 208 MiB per rendered PDF admitted only one renderer even
on machines with ample RAM. Retaining that reservation during the gateway call
also serialized requests; reservations now shrink after request preparation.

The shared budget defaults to 90% of the process memory allowance, which is
physical RAM multiplied by `LOCAL_MEMORY_LIMIT_RATIO` (default 0.8). This leaves
10% of that allowance for runtime overhead, uploads, exports and estimation
error. Both the gateway budget and server resource controller use the same
validated startup memory configuration. `MODEL_PREPARATION_MAX_BYTES` can reduce
the budget, but cannot consume the reserved headroom. Invalid limits fail startup.

The budget is accounting, not preallocated memory. Global extraction permits,
Workspace sequential policy, per-document rendered payload limits, sampled RSS,
and OS memory-pressure controls remain in effect. Sampled controls cannot enforce
a strict RSS ceiling, and physical RAM is not the same as currently available
RAM; operators sharing the host with a local model or other large processes can
lower the limits. Waiting work remains cancellable and reservations release on
completion or failure. Health diagnostics report aggregate preparation capacity,
reservations and waiter count so memory waiting is distinguishable from queue
concurrency limits.
