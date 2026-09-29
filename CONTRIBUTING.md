# Contributing

Thanks for helping out. This guide gets you from a fresh clone to a pull request.

## Set up

You need the Bun version listed in [package.json](package.json) (`packageManager`). Then, from the repository root:

```bash
bun install --frozen-lockfile
cp .env.example .env     # your local settings; never commit this file
bun run migrate          # creates the local databases in .local/
```

You don't need a model or API key to run the app. To try extraction, set up a model for a Workspace in the app (**Workspaces → Model gateway**).

## Run the app for development

| Goal | Command | Open |
| --- | --- | --- |
| Run the complete app, as users get it | `bun run build && bun run start` | http://127.0.0.1:8787 |
| Work on the backend, with auto-restart | `bun run dev` | http://127.0.0.1:8787 |
| Work on the frontend, with hot reload | `bun run dev` and, in a second terminal, `bun run dev:frontend` | http://127.0.0.1:5173 |

The Vite dev server forwards `/api/auth` and `/v1` requests to the Bun server, so keep `bun run dev` running for frontend work.

Local data (databases, uploaded files, captured emails) lives in `.local/`. Delete it to start fresh, or point `DOCUMENT_EXTRACTION_STATE_DIR` somewhere else.

## Find your way around

| Path | What's there |
| --- | --- |
| `backend/src/server.ts` | Bun server entry point: starts everything and routes requests. |
| `backend/src/localApplication.ts` | The `/v1` API routes. |
| `backend/src/consumer/` | Talking to the model gateway and turning its output into results. |
| `backend/src/lib/` | Shared helpers: validation, PDF inspection, email. |
| `frontend/src/App.jsx` | The React app shell; features live in `frontend/src/features/`. |
| `e2e/` | Playwright browser tests. |
| `scripts/` | Installer, release packaging, and dependency checks. |
| `docs/` | User and maintainer documentation. `mkdocs/` holds the API docs site. |

The [backend README](backend/README.md) and [frontend README](frontend/README.md) explain how each side works. `backend/CONTEXT.md`, `frontend/CONTEXT.md`, and the decision records in `backend/docs/adr/` define the domain terms and record past design decisions. `AGENTS.md` is a short brief for AI coding assistants.

## Check your work

Run focused tests while you work, for example:

```bash
bun test backend/src/localJobSearch.bun.test.ts
bun run --cwd frontend test src/features/evaluations
```

Before opening a pull request, run the full set from the repository root:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

If you changed a browser workflow, also run the Playwright tests (see [e2e/README.md](e2e/README.md)):

```bash
bun run test:e2e
```

If you changed the installer or release packaging, run `bun run test:installer`, ideally on both macOS and Linux.

[Testing strategy](docs/testing-strategy.md) explains which kind of test to write for what, and describes the extra test commands.

## Open a pull request

- Keep each pull request to one change, and don't mix in unrelated refactoring.
- Describe what changed and why. List the checks you ran, and say whether they ran locally or in CI. If you tested against a real model provider rather than the test fake, say so.
- If you change a setting, update `.env.example` and [docs/configuration.md](docs/configuration.md) together. The frontend reads public settings from `/v1/config`, so check it still behaves correctly.
- If you change user-facing behaviour, update the docs. If you change a domain rule or API contract, update the relevant `CONTEXT.md` or ADR too.
- Use repository-relative links in documentation, not paths from your own machine.

A few project rules:

- All settings are read in one place, `backend/src/localConfiguration.ts`. Invalid settings should stop the app with a clear message that never prints secret values.
- Model settings belong to each Workspace. Don't add global model credentials or defaults for a particular deployment.

## Keep secrets and data out of Git

Never commit `.env`, credentials, anything in `.local/`, captured emails, or real documents. Use synthetic test files instead.

`.scratch/` is ignored and holds local notes, issues, prototypes, and generated test reports. Keep it out of commits too; CI shares its reports as workflow artifacts.

To report a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

The project uses the [MIT License](LICENSE). By contributing, you agree your contribution is licensed under the same terms. Keep existing copyright and license notices, including those in third-party code.
