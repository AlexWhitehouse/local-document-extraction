# Local Bun Runtime

The application runs locally on Bun. One server exposes API routes, auth routes, Workspace live updates, and built frontend assets.

## Consequences

- Bun is the package manager and runtime entrypoint; local scripts use `bun` and `bunx`.
- All durable state lives below `.local/` by default: control and Workspace SQLite databases, temporary Source files, captured mail, and analytics logs.
- `bun run migrate` is idempotent and initializes the local control schema. Workspace product stores initialize on first use.
- Email/password authentication, account verification, password reset, Workspaces, invitations, Application admin, and Workspace API keys remain in scope.
- Verification and reset email is captured in the local mail sink by default; [ADR-0011](0011-portable-local-installation-configuration.md) adds configurable account policy and optional Cloudflare REST delivery for public local installations.
- The local extraction runner resumes accepted work, and the local live update hub broadcasts persisted lifecycle changes.
- Daily JSONL analytics are best-effort, privacy-filtered operational logs rather than product authority.
