# Vendored anti-slop

- Source: https://github.com/dmmulroy/anti-slop
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied from: `skills/install-anti-slop/assets/anti-slop/`, the bundled production snapshot of `src/` at that commit.
- Installed path: `tools/oxlint/anti-slop/`; generic entry point: `index.ts`.
- The Effect plugin is retained in the snapshot but is not enabled because this workspace does not depend on Effect.
- Rule source is unmodified. The root MIT license and nested ESLint Stylistic license/provenance are retained.

`oxlint.config.ts` enables all generic rules and `oxc/no-accumulating-spread` as errors. The documented `allowInTypeGuards` option is enabled for `no-runtime-typeof`: this project uses typed boundary predicates rather than a schema library. Other runtime `typeof` checks remain prohibited, apart from upstream's binding-existence exception.

`oxlint` and `@oxlint/plugins` are pinned together at `1.86.0`. `bun run lint` runs the existing ESLint checks and this plugin under Bun, including in CI. Vendored source, installed agent assets, generated output and local runtime state are excluded from application linting.

For future updates, stage the incoming snapshot separately and compare it against this exact upstream commit before merging local changes. Do not overwrite this directory blindly.
