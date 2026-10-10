# Pin Bun 1.4 Runtime

The Local Bun Runtime, package manager, developer commands, and CI use Bun 1.4.3. The root `packageManager` declaration controls the version. Setup tools read this declaration instead of keeping a separate workflow version.

## Consequences

- Backend ambient types use `bun-types` 1.4.3 directly. The `@types/bun` wrapper stays on 1.3.14. Node ambient types match the Node 26 interface that Bun reports.
- Typechecks use `bun check`, which implements TypeScript 7.0.2 semantics. The installed `typescript` package stays on 6.0 because `typescript-eslint` supports only TypeScript versions below 6.1. Editors and `tsc` can therefore differ from CI for TypeScript 6/7 differences, so `bun run typecheck` is authoritative.
- Health diagnostics report the active Bun version, full revision, and reported Node version. Support records and benchmark evidence can thus identify the runtime.
- CI verifies the frozen dependency tree on supported Linux and macOS hosts. The full tests include native canvas and PDF coverage.
- The lockfile stays at version 1. Bun 1.4 can read it, and frozen installs are deterministic. Bun 1.3.14 can also read it during rollback of the runtime change.
- Application dependency upgrades and security repairs remain separate changes. This separation helps identify runtime compatibility failures and reverse the related change.

## Rollback

Revert the Bun 1.4 upgrade as one unit:

1. Restore the root runtime declaration and CI setup to Bun 1.3.14.
2. Restore the Bun/Node type declarations and TypeScript type entry.
3. Restore the matching version-1 lockfile changes.
4. Run a frozen install.
5. Run the complete set of repository commands.

This rollback does not require a product database migration or a Workspace product data rollback.
