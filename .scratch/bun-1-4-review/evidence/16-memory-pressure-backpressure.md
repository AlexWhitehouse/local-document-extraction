# OS memory-pressure backpressure comparison

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Workload: same 12 queued 8.00 MiB Document simulations, concurrency 4.
- Pressure window: 32.00 MiB touched host-pressure allocation held for 40 ms.
- Each mode runs in a fresh child process; OS pressure is injected through the controller seam rather than by exhausting host memory.

| Mode | Peak RSS | P50 queue latency | P95 queue latency | Pause duration | Recovery time | Completed | Failed | Rejected admissions | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Policy disabled | 121.52 MiB | 28.67 ms | 54.83 ms | 0.11 ms | 0.00 ms | 12 | 0 | 0 | 78.31 ms |
| Policy enabled | 105.55 MiB | 69.95 ms | 96.86 ms | 41.68 ms | 42.86 ms | 12 | 0 | 4 | 120.48 ms |

- Peak RSS difference (disabled minus enabled): 15.97 MiB.
- P95 queue-latency difference (enabled minus disabled): 42.02 ms.
- Rejected admissions are retryable pressure-window probes; completed/failed counts describe the pre-existing durable queue.
- These are focused local measurements, not a production capacity claim; repeat on deployment-class hardware before setting budgets.
