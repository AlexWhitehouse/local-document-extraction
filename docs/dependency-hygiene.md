# Dependency hygiene

This guide describes dependency installation, checks, and upgrades.

## Installing

The repository uses Bun's isolated linker and global package store. CI uses `bun ci`. Installation must not change `bun.lock`. For local installation with the same restriction, use `bun install --frozen-lockfile`.

## Checking dependencies

```bash
bun run package:hygiene
```

This command runs the same read-only checks as CI:

- `bun audit --prod --json` lists known vulnerabilities in production dependencies.
- `bun dedupe --check` identifies duplicate package versions.
- `bun pm licenses --prod --json` creates a license inventory.

Reports use `.scratch/ci/package-hygiene/`. The command does not change dependencies. It does not run `bun audit fix`, `bun dedupe`, or upgrades.

The license inventory does not make legal decisions. There is no automatic allow or deny list.

## Upgrading sensitive dependencies

Review dependency upgrades carefully when they affect authentication, document parsing, native binaries, networking, builds, or spreadsheets. Generate the package changes:

```bash
bun run package:diff-evidence
```

This command compares published packages without installing or updating them. Review these items:

- Added and deleted files.
- Install scripts, entry points, and executable permissions.
- New imports of sensitive built-in modules and other packages.
- The normalized patch.

## New releases have to wait three days

`bunfig.toml` rejects package versions published less than three days (259,200 seconds) earlier. This delay gives the community time to identify malicious releases. The only permanent exception is `bun-types`. Its version must match the repository's Bun version exactly.

For an urgent security fix, `--minimum-release-age=0` can bypass the delay for that change. The change still requires a package diff, production audit, focused tests, and the complete checks. Do not add broad or transitive exceptions for routine upgrades.

## Measuring the global store

```bash
bun run benchmark:global-store
```

This benchmark measures the global store with this repository. It does not depend on Bun's published benchmark results. It creates temporary Git worktrees and prepares a private package cache. It measures initial storage and reuse, with registry access blocked for the second install.

The benchmark verifies symlinks and confirms that the lockfile and Git remain unchanged. It runs `@napi-rs/canvas` in both worktrees. It does not clear or change your Bun cache.
