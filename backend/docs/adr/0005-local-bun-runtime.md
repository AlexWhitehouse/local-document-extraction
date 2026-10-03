# Local Bun Runtime

The application runs locally on Bun. One server provides API routes, authentication routes, Workspace live updates, and built frontend assets.

## Consequences

- Bun is the package manager and runtime entry point. Local scripts use `bun` and `bunx`.
- By default, `.local/` contains all durable state. This includes control and Workspace SQLite databases, temporary Source files, captured mail, and analytics logs.
- `bun run migrate` initializes the local control schema. Repeated runs are safe. Workspace product stores initialize on first use.
- The application supports email/password authentication, account verification, and password reset. It also supports Workspaces, invitations, Application admin, and Workspace API keys.
- The local mail sink captures verification and reset email by default. [ADR-0011](0011-portable-local-installation-configuration.md) adds account policy settings and optional Cloudflare REST delivery for public local installations.
- The local extraction runner resumes accepted work. The local live update hub broadcasts lifecycle changes after storage.
- Daily JSONL analytics are operational logs with privacy filters. Delivery is best effort. These logs are not the source of truth for product state.
