# PROTOTYPE — local extraction throughput

Question: does bounding multipart admission and active Extraction jobs preserve useful throughput while preventing a remote-gateway backlog from retaining an unbounded number of PDF buffers in the local runtime?

This is disposable benchmark code, not production code. It runs the real multipart API, Workspace SQLite store, Source file store, Extraction runner, lifecycle writes, successful cleanup, and individual job reads against generated PDFs and a controllable in-process fake Model gateway. The client runs in a separate process so its PDF/request memory is not counted as server memory.

Run the quick comparison:

```sh
bun run prototype:throughput
```

Useful overrides:

```sh
PROTOTYPE_WORKERS=1000 PROTOTYPE_GATEWAY_LATENCY_MS=250 bun run prototype:throughput
```

The `baseline` profile uses the current unbounded local extraction queue and no submission admission ceiling. The `bounded` profile permits four simultaneous multipart submissions and eight active Extraction jobs. Both profiles use the same fake gateway ceiling, generated 90/8/2 PDF workload, API key, and per-job polling client.

