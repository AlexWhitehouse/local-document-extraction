# Bun 1.4 global isolated-store worktree benchmark

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Host: darwin arm64
- Shape: two clean dependency worktrees reuse one pre-warmed package cache; worktree A populates global-store entries and worktree B reuses them with the registry denied.
- Scope: local install/link/disk evidence for this repository, not Bun's published 7× benchmark.

| Worktree | Frozen install | Registry | Lockfile | Git state | Global-store links | Native canvas PNG | node_modules disk |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: |
| worktree-a | 349.95 ms | available | unchanged | clean | 359 | 97 bytes | 95 KiB |
| worktree-b | 59.45 ms | registry denied | unchanged | clean | 359 | 97 bytes | 95 KiB |

Shared cache plus global store: 641,964 KiB on disk after both installs.

The unmeasured seed install warms package tarballs with the global store disabled. Both measured directories are dependency-only Git worktrees committed inside a disposable temporary repository, ignore only `node_modules/`, begin clean, and must remain clean. The second install points the npm registry at a closed loopback port, so success demonstrates frozen/offline reuse rather than a hidden network fetch.
