# Pin Bun 1.4 Runtime

The Local Bun Runtime, package manager, developer command surface, and CI use Bun 1.4.0. The root `packageManager` declaration is the authoritative version; setup tooling reads that declaration rather than maintaining a separate workflow pin.

## Consequences

- Backend ambient types use `bun-types` 1.4.0 directly while the `@types/bun` wrapper remains on 1.3.14, and Node ambient types align with Bun's reported Node 26 surface.
- Health diagnostics report the active Bun version, full revision, and reported Node version so support and benchmark evidence identifies the actual runtime.
- CI qualifies the frozen dependency tree on supported Linux and macOS hosts, including native canvas and PDF coverage already present in the complete test surface.
- The existing lockfile version 1 is intentionally retained. Bun 1.4 reads it, frozen installs are deterministic, and retaining it keeps the runtime-only change directly readable by Bun 1.3.14 during rollback.
- Application dependency upgrades and security repairs remain separate changes so runtime compatibility failures are attributable and reversible.

## Rollback

Revert the Bun 1.4 upgrade as one unit: restore the root runtime declaration and CI setup to Bun 1.3.14, restore the Bun/Node type declarations and TypeScript type entry, and restore the matching version-1 lockfile diff. No product database migration or Workspace product data rollback is required. Run a frozen install and the complete command surface after the revert.
