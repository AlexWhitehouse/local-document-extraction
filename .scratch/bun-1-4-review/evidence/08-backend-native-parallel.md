# Ticket 08 — Backend Bun-native isolation and worker-cap evidence

Recorded 2026-08-20 on macOS arm64 with Bun `1.4.0+34cbb9a40`.

## Worker cap

Run with:

```sh
bun run --cwd backend benchmark:test-parallel
```

The benchmark samples the aggregate RSS of the Bun coordinator and all descendant test workers every 20 ms. Both lanes use file isolation, in-file max concurrency 1, zero retries, orphan cleanup, and exclude the separately serialized real-process smoke.

| Workers | Wall time | Peak aggregate process-tree RSS | Tests | Assertions |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 3878.9 ms | 876.1 MiB | 118 | 583 |
| 4 | 2518.7 ms | 1332.0 MiB | 118 | 583 |

The selected routine cap is **two workers with a 1 GiB aggregate budget**. Four workers were 35% faster in this sample but exceeded the local 1 GiB budget by roughly 300 MiB. CI runs the same benchmark on each supported OS and uploads the Markdown result so the cap can be revisited with runner evidence.

The serial isolated lane reported the same 118 tests and 583 assertions. The separate smoke reported one test and 29 assertions in both serial and capped-parallel compositions.

## Randomized stability

Run with:

```sh
BUN_TEST_SEED=424242 bun run --cwd backend test:bun:flake
```

The lane completed 20 randomized repetitions with isolation, two workers, max concurrency 1, orphan cleanup, and zero retries:

```text
--seed=424242
2360 pass
0 fail
11660 expect() calls
Ran 2360 tests across 42 files. [58.41s]
```
