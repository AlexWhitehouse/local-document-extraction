# Ticket 06 — Model payload base64 evidence

Recorded 2026-08-20 on macOS arm64 with Bun `1.4.0+34cbb9a40`. Run with:

```sh
bun run --cwd backend benchmark:model-payload-base64
```

Each encoder received the same deterministic input, one warm-up, and nine measured iterations. Duration is the median. Peak RSS delta is the maximum sampled post-encoding RSS minus the forced-GC baseline; allocator reuse makes it a coarse process-level measurement rather than an allocation count.

| Input | Encoder | Median | Peak RSS delta |
| ---: | --- | ---: | ---: |
| 2 MiB | legacy JS + `btoa` | 15.92 ms | 0.61 MiB |
| 2 MiB | native `Buffer` | 0.10 ms | 0.13 MiB |
| 5 MiB | legacy JS + `btoa` | 40.03 ms | 13.16 MiB |
| 5 MiB | native `Buffer` | 0.24 ms | 0.05 MiB |
| 10 MiB | legacy JS + `btoa` | 79.66 ms | 6.08 MiB |
| 10 MiB | native `Buffer` | 0.47 ms | 0.00 MiB |

The native path was approximately 159–170× faster across these sizes. RSS deltas were lower in every measured case, though the absolute values are allocator-sensitive.

## Gateway preparation fixture

Four concurrent 2 MiB rendered-page-equivalent `image/png` payloads were sent through the real `runExtraction` request-preparation path and an in-process successful Fetch fixture. The batch completed in **3.02 ms** with a **0.77 MiB** sampled RSS delta. The fixture exercises base64, data-URL construction, chat request assembly, JSON serialization, Fetch invocation, and response parsing without network latency.
