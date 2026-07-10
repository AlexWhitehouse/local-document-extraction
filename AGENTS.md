# AGENTS

## Repo shape
- Bun workspace with a local API/runtime in `backend` and a Vite + React SPA in `frontend`.
- Runtime entrypoints are `backend/src/server.ts` (Bun server) and `frontend/src/main.jsx` (SPA bootstrap).
- The Bun server serves `frontend/dist` with SPA fallback for normal local use.

## Commands that matter
- Install dependencies once at repo root: `bun install`.
- Initialize idempotent local state: `bun run migrate`.
- Run the complete app locally from root: `bun run build && bun run start`.
- Run the Bun server with reload: `bun run dev`.
- Run the Vite UI separately for frontend work: `bun run dev:frontend`.
- Run checks from root: `bun run typecheck`, `bun run test`, and `bun run build`.

## Local dev wiring and prerequisites
- Frontend dev server proxies `/api/auth` and `/v1` to `http://127.0.0.1:8787` (see `frontend/vite.config.js`), so the Bun server should be running for most frontend work.
- Local runtime state lives in `.local/` by default. Set `DOCUMENT_EXTRACTION_STATE_DIR` to use a different location.
- `bun run migrate` initializes the local control database and Better Auth schema; workspace product databases initialize idempotently when first used.

## Auth, API, and routing quirks
- Better Auth endpoints are under `/api/auth/*`; app API endpoints are under `/v1/*`.
- `GET`/`HEAD` non-`/v1` requests are served from built assets by the Bun server with SPA fallback.
- Workspace-scoped API routes require either Better Auth session + `x-workspace-id` header or `Authorization: Bearer <workspace-api-key>`.

## Safety / gotchas
- Treat `.env` files and `LITELLM_KEY` as sensitive local secrets; never commit them.
- Local state includes SQLite databases, Source files, captured transactional mail, and privacy-filtered analytics logs. Never commit `.local/`.
- Use focused checks appropriate to the change, then run the root Bun command surface before finishing broad runtime work.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default canonical triage labels are used, plus `completed`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: `CONTEXT-MAP.md` points to per-context `CONTEXT.md` files, with ADRs in root or context-specific `docs/adr/` directories. See `docs/agents/domain.md`.
