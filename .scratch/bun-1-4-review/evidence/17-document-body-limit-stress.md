# Document transport body-limit stress

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Source limit: 256.00 KiB; logical request limit: 288.00 KiB; Bun emergency cap: 320.00 KiB.
- Requests: 12 known-length oversize, 12 chunked oversize, 4 client-aborted partial uploads.
- The workload runs in an isolated child process against a real loopback Bun server and uses bounded payloads.

| Metric | Result |
| --- | ---: |
| Structured oversize responses | 24 |
| Unexpected responses | 0 |
| P50 response latency | 4.91 ms |
| P95 response latency | 16.84 ms |
| Peak RSS | 58.92 MiB |
| Peak RSS growth | 34.47 MiB |
| Aborted connections settled | 4 |
| Pending handlers after settlement | 0 |
| Temporary files retained | 0 |
| Promoted Source files | 0 |
| Extraction jobs created | 0 |
| Measured wall time | 42.04 ms |

All oversize outcomes are expected to be retry-safe and side-effect free. This is focused local evidence, not a production capacity claim.
