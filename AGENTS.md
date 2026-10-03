# AGENTS

## Repo shape

- The repository is a Bun workspace. `backend` contains the local API and runtime. `frontend` contains the Vite and React SPA.
- `backend/src/server.ts` starts the Bun server. `frontend/src/main.jsx` starts the SPA.
- For normal local use, the Bun server serves `frontend/dist`. It uses SPA fallback for frontend routes.

## Commands that matter

- Install dependencies once from the repository root: `bun install`.
- Initialize local state: `bun run migrate`. Repeated runs are safe.
- Run the complete app from the root: `bun run build && bun run start`.
- Run the Bun server with reload: `bun run dev`.
- Run the Vite UI separately: `bun run dev:frontend`.
- Run the root checks: `bun run typecheck`, `bun run test`, and `bun run build`.

## Local dev wiring and prerequisites

- The frontend development server forwards `/api/auth` and `/v1` to `http://127.0.0.1:8787`. See `frontend/vite.config.js`. Keep the Bun server running for most frontend work.
- Local runtime state uses `.local/` by default. To use another location, set `DOCUMENT_EXTRACTION_STATE_DIR`.
- `bun run migrate` initializes the local control database and Better Auth schema. Workspace product databases initialize on first use. Repeated initialization is safe.

## Auth, API, and routing quirks

- Better Auth routes use `/api/auth/*`. App API routes use `/v1/*`.
- The Bun server serves built assets for `GET` and `HEAD` requests outside `/v1`. It uses SPA fallback when necessary.
- Workspace-scoped API routes require a Better Auth session with `x-workspace-id`, or `Authorization: Bearer <workspace-api-key>`.

## Safety / gotchas

- Treat `.env` files and `LITELLM_KEY` as sensitive local secrets. Never commit them.
- Local state includes SQLite databases, Source files, captured transactional mail, and analytics logs with privacy filters. Never commit `.local/`.
- First, run focused checks for the change. Before finishing broad runtime work, run the root Bun commands.

## Agent skills

### Issue tracker

Issues and PRDs are local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels and `completed`. See `docs/agents/triage-labels.md`.

### Domain docs

`CONTEXT-MAP.md` links to each context's `CONTEXT.md`. ADRs use root or context-specific `docs/adr/` directories. See `docs/agents/domain.md`.
