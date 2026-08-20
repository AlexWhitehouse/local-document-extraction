# Dependency hygiene

The repository installs with Bun's isolated linker and global virtual store.
Clean and CI installs use `bun ci`; a successful CI install must leave
`bun.lock` byte-for-byte unchanged.

## Non-mutating checks

Run the same production checks as CI with:

```bash
bun run package:hygiene
```

The command runs `bun audit --prod --json`, `bun dedupe --check`, and
`bun pm licenses --prod --json`. It writes portable audit, dedupe, license, and
summary artifacts under `.scratch/ci/package-hygiene/`. It never runs
`bun audit fix`, `bun dedupe`, `--latest`, or another automatic update.

License output is an inventory, not a legal allow/deny decision. Any future
license policy needs explicit product/legal ownership.

## Sensitive dependency review

Authentication, document parsing, native-binary, networking, build-tool, and
spreadsheet dependency upgrades require `bun pm diff --json` evidence. Generate
the review set for the current Bun migration with:

```bash
bun run package:diff-evidence
```

Review new/deleted files, lifecycle scripts, entry points, executable bits,
sensitive built-in imports, new package imports, and the normalized patch. The
command only compares registry packages; it does not install or update them.

## Release cooling period

`bunfig.toml` rejects newly resolved versions published less than three days
(259,200 seconds) ago. The only permanent exclusion is `bun-types`, because the
type package is qualified and pinned with the exact Bun runtime release.

An urgent security repair may explicitly override the window for that reviewed
operation with `--minimum-release-age=0`. The dependency change must still carry
package-diff evidence, a production audit, focused tests, and the frozen full
gate. Do not add a broad or transitive exclusion to make ordinary upgrades land
faster.

## Global store qualification

Measure this repository rather than assuming Bun's published benchmark:

```bash
bun run benchmark:global-store
```

The benchmark creates disposable dependency-only Git worktrees, warms one
private package cache, measures global-store population and reuse, denies
registry access for the second frozen install, checks global-store symlinks and
lock/Git cleanliness, and executes `@napi-rs/canvas` in both worktrees. It never
clears or modifies the user's Bun cache.
