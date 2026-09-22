# Contributing

Start with the [README](README.md), [AGENTS.md](AGENTS.md), and [context map](CONTEXT-MAP.md). Use the Bun version declared in `package.json` and install from the repository root with `bun install --frozen-lockfile`.

Copy `.env.example` to `.env` only for your own local setup. Never commit credentials, state, captured email, or private document samples. Prefer synthetic fixtures. `.scratch/` includes intentional Markdown issue tracking; generated `.scratch/ci/` reports are ignored and belong in CI artifacts.

## Work on a change

1. Describe the concrete behavior being changed in an issue or pull request. Keep unrelated refactors separate.
2. Read the relevant context and ADRs. Update them if the public contract or domain behavior changes.
3. Use focused tests while developing, then run the appropriate root checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

For browser flows, follow [e2e/README.md](e2e/README.md) and run the relevant Playwright coverage. For setup or distribution changes, also run installer smoke coverage on the supported operating systems. [Testing strategy](docs/testing-strategy.md) explains the lanes and evidence.

## Configuration and documentation

Deployment configuration belongs in the shared backend configuration loader. Keep `.env.example`, `docs/configuration.md`, and any public frontend capabilities synchronized. Invalid configuration should fail clearly without printing secrets. Model settings remain per Workspace; do not restore global model credentials or maintainer-specific defaults.

Explain what changed, why, and which checks ran in the pull request. Distinguish local results from CI results, and mock-provider tests from real external-provider verification. Add setup instructions when a user-visible setting changes. Use repository-relative links in checked-in documentation rather than local machine paths.

Security vulnerabilities should follow [SECURITY.md](SECURITY.md), rather than a normal public bug report. The project license is still a publication gate; do not assume a license that has not been selected by the maintainer.
