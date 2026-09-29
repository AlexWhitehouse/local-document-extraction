# Dependency hygiene

How dependencies are installed, checked, and upgraded.

## Installing

The repository uses Bun's isolated linker with a global package store. CI installs with `bun ci`, and the install must leave `bun.lock` exactly as it was. Locally, use `bun install --frozen-lockfile` for the same guarantee.

## Checking dependencies

```bash
bun run package:hygiene
```

This runs the same read-only checks as CI:

- `bun audit --prod --json` for known vulnerabilities in production dependencies
- `bun dedupe --check` for duplicate package versions
- `bun pm licenses --prod --json` for a license inventory

Reports are written to `.scratch/ci/package-hygiene/`. The command never changes anything: it doesn't run `bun audit fix`, `bun dedupe`, or any upgrade.

The license report is an inventory, not a legal decision. There's no automatic allow or deny list.

## Upgrading sensitive dependencies

Upgrades to dependencies that handle authentication, document parsing, native binaries, networking, builds, or spreadsheets need a closer look. Generate a diff of what changed in the packages themselves:

```bash
bun run package:diff-evidence
```

This compares the published packages without installing or updating anything. Review:

- files that were added or deleted
- install scripts, entry points, and executable bits
- new imports of sensitive built-in modules, and newly imported packages
- the normalised patch

## New releases have to wait three days

`bunfig.toml` refuses package versions published less than three days (259,200 seconds) ago, which gives the community time to spot malicious releases. The one permanent exception is `bun-types`, which is pinned to match the exact Bun version the project uses.

For an urgent security fix, you can skip the wait for that one change with `--minimum-release-age=0`. The change still needs the package diff, a production audit, focused tests, and the full set of checks. Don't add broad or transitive exceptions just to speed up ordinary upgrades.

## Measuring the global store

```bash
bun run benchmark:global-store
```

This measures how the global package store performs for this repository, rather than relying on Bun's published benchmarks. It creates throwaway Git worktrees and warms a private package cache. Then it measures filling and reusing the global store, running the second install with registry access blocked. It checks symlinks and that the lockfile and Git stay clean, and runs `@napi-rs/canvas` in both worktrees. It never clears or changes your own Bun cache.
