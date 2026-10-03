# RAM-aware model preparation

This decision replaces the fixed 256 MiB shared preparation budget in ADR-0009. A rendered PDF could reserve approximately 208 MiB. This estimate permitted only one renderer, even on machines with much more RAM. Keeping the reservation during the gateway call also forced requests to run sequentially. Reservations now decrease after request preparation.

The shared budget defaults to 90% of the process memory allowance. This allowance is physical RAM multiplied by `LOCAL_MEMORY_LIMIT_RATIO`, which defaults to 0.8. The remaining 10% supports runtime overhead, uploads, exports, and estimation errors. The gateway budget and server resource controller use the same validated memory configuration at startup.

`MODEL_PREPARATION_MAX_BYTES` can decrease the budget. It cannot consume the reserved allowance. Invalid limits stop startup.

The budget tracks estimated use; it does not allocate memory in advance. Global extraction permits, the Workspace sequential policy, and rendered payload limits still apply. Sampled RSS and operating-system memory-pressure controls also remain active. Sampled controls cannot enforce a strict RSS ceiling.

Physical RAM differs from currently available RAM. Operators can decrease limits when a local model or other large process shares the host. Waiting work can be canceled. Completion or failure releases its reservations.

Health diagnostics report aggregate preparation capacity, reservations, and the number of waiting requests. These values distinguish memory waits from queue concurrency limits.
