# Workspace live update fanout baseline

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Scope: current in-memory hub serialization, Workspace lookup, iteration, send-status accounting, and synthetic socket callback.
- This benchmark does not measure Bun native topics, kernel/network delivery, TLS, browser parsing, or reconnect work.

| Subscribers | Events | Attempted sends | Wall time | Per-send cost | Sends/second | RSS growth |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 500 | 500 | 0.37 ms | 0.735 µs | 1,360,855 | 2.59 MiB |
| 10 | 500 | 5000 | 0.29 ms | 0.057 µs | 17,457,125 | 1.02 MiB |
| 100 | 500 | 50000 | 0.49 ms | 0.010 µs | 101,112,235 | 2.59 MiB |
| 1000 | 500 | 500000 | 2.21 ms | 0.004 µs | 225,810,094 | 1.64 MiB |

These are focused local measurements, not a production capacity claim. Use them as the baseline for a separate native-topic prototype, not as evidence to migrate now.
