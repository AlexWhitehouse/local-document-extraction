# Static asset concurrency comparison

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Workload: same 8.00 MiB asset, concurrency 12, 2 rounds (24 measured requests per mode)
- Server RSS is sampled in an isolated child process; client buffering occurs in the coordinator process.

| Implementation | P50 request | P95 request | Measured wall time | Peak server RSS | Settled server RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Legacy `readFile()` buffer | 18.29 ms | 45.74 ms | 64.84 ms | 180.45 MiB | 180.45 MiB |
| Lazy `Bun.file()` response | 10.14 ms | 16.93 ms | 34.77 ms | 20.03 MiB | 20.03 MiB |

- RSS reduction (legacy minus lazy): 160.42 MiB (88.9%).
- P95 latency reduction (legacy minus lazy): 28.81 ms.
- These are focused local measurements, not a production capacity claim; repeat on CI hardware before setting a budget.
