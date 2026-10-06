# Contributing

This guide describes repository setup, local development, and pull requests.

## Set up

Use the Bun version in the `packageManager` field of [package.json](package.json). Run these commands from the repository root:

```bash
bun install --frozen-lockfile
cp .env.example .env     # your local settings; never commit this file
bun run migrate          # creates the local databases in .local/
```

The app can start without a model or API key. Before extraction, configure a Workspace model under **Workspaces → Model gateway**.

## Run the app for development

| Goal | Command | Open |
| --- | --- | --- |
| Run the complete app | `bun run build && bun run start` | http://127.0.0.1:8787 |
| Develop the backend with automatic restart | `bun run dev` | http://127.0.0.1:8787 |
| Develop the frontend with hot reload | `bun run dev` and, in a second terminal, `bun run dev:frontend` | http://127.0.0.1:5173 |

The Vite development server forwards `/api/auth` and `/v1` to the Bun server. Keep `bun run dev` running during frontend work.

By default, `.local/` contains local databases, uploads, and captured email. To start with empty state, delete this directory. To use another state directory, set `DOCUMENT_EXTRACTION_STATE_DIR`.

## Find your way around

| Path | Contents |
| --- | --- |
| `backend/src/server.ts` | Bun server entry point. Starts services and routes requests. |
| `backend/src/localApplication.ts` | Routes for the `/v1` API. |
| `backend/src/consumer/` | Model gateway calls and result processing. |
| `backend/src/lib/` | Shared validation, PDF inspection, and email functions. |
| `frontend/src/App.jsx` | React app shell. Features use `frontend/src/features/`. |
| `e2e/` | Playwright browser tests. |
| `scripts/` | Installation, release packaging, and dependency checks. |
| `docs/` | User and maintainer guides. `mkdocs/` contains the API documentation site. |

The [backend README](backend/README.md) and [frontend README](frontend/README.md) describe each component. `backend/CONTEXT.md` and `frontend/CONTEXT.md` define domain terms. `backend/docs/adr/` records design decisions. `AGENTS.md` gives instructions to AI coding assistants.

## Check your work

During development, run focused tests. For example:

```bash
bun test backend/src/localJobSearch.bun.test.ts
bun run --cwd frontend test src/features/evaluations
```

Before opening a pull request, run these checks from the repository root:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

If a browser workflow changed, also run the Playwright tests. See [e2e/README.md](e2e/README.md).

```bash
bun run test:e2e
```

If installation or release packaging changed, run `bun run test:installer`. If possible, run it on both macOS and Linux.

[Testing strategy](docs/testing-strategy.md) describes test selection and additional commands.

## Open a pull request

- Keep each pull request focused on one change. Exclude unrelated refactoring.
- Describe the change and its purpose. List the checks and where they ran: locally or in CI. State whether model tests used a real provider or the test fake.
- If a setting changes, update `.env.example` and [docs/configuration.md](docs/configuration.md) together. Verify frontend behavior with the public settings from `/v1/config`.
- If user behavior changes, update the documentation. If a domain rule or API contract changes, update the applicable `CONTEXT.md` or ADR.
- Use repository-relative documentation links. Do not use paths from your machine.

The project has two configuration rules:

- `backend/src/localConfiguration.ts` reads all settings. Invalid settings must stop the app with a clear message. The message must not expose secret values.
- Each Workspace owns its model settings. Do not add global model credentials or defaults for a specific deployment.

## Keep secrets and data out of Git

Never commit `.env`, credentials, `.local/` content, captured email, or real documents. Use synthetic test files.

`.scratch/` contains local notes, issues, prototypes, and generated test reports. Git ignores this directory. Keep these files out of commits. CI shares reports as workflow artifacts.

To report a security vulnerability, use [SECURITY.md](SECURITY.md). Do not open a public issue with vulnerability details.

## License

The project uses the [MIT License](LICENSE). Contributions use the same license terms. Keep existing copyright and license notices, including notices in third-party code.

Background document processing requires Go matching `backend-go/go.mod`. Run `bun run build` before starting the app; `bun run dev` rebuilds the Go binary before starting Bun watch mode. After editing Go while developing, restart `bun run dev`. See [the processor guide](backend-go/README.md).
