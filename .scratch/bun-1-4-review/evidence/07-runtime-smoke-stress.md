# Ticket 07 — Local Runtime smoke stress evidence

Recorded 2026-08-20 on macOS arm64 with Bun `1.4.0+34cbb9a40`. Run with:

```sh
bun run --cwd backend stress:runtime-smoke
```

The harness launched 100 complete Local Bun Runtime child processes at concurrency 10. Every child received `PORT=0`, reported its actual structured origin, passed a bounded `/v1/health` check, and exited cleanly. The stress script force-cleans partial runs and compares its prefixed temporary-directory set before and after execution.

```text
Local Runtime smoke stress passed: 100 runs
concurrency=10
elapsed_ms=5983.4
address_in_use=0
startup_failures=0
child_processes_remaining=0
listeners_remaining=0
temporary_directories_leaked=0
```
