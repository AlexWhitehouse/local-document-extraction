# AGENTS

## Repo shape
- Monorepo with two apps: `backend` (Cloudflare Worker API) and `frontend` (Vite + React SPA).
- Runtime entrypoints are `backend/src/index.ts` (all API routing + queue handler) and `frontend/src/main.jsx` (SPA bootstrap).
- Worker serves built frontend assets in production via `backend/wrangler.jsonc` (`assets.directory: ../frontend/dist`), so frontend build output is part of backend deploy.

## Commands that matter
- Install deps once at repo root: `npm install`.
- Run both apps locally from root: `npm run dev` (starts backend + frontend concurrently).
- Run backend only: `npm run start --prefix backend`.
- Run frontend only: `npm run start --prefix frontend`.
- Backend typecheck (only typecheck script in repo): `npm run typecheck --prefix backend`.
- Frontend production build: `npm run build --prefix frontend`.
- Production deploy from root: `npm run deploy` (delegates to backend `deploy:prod`, which builds frontend first, then deploys Worker).

## Local dev wiring and prerequisites
- Frontend dev server proxies `/api/auth` and `/v1` to `http://localhost:8787` (see `frontend/vite.config.js`), so backend should be running for most frontend work.
- Backend local runtime is Wrangler with persisted local state (`wrangler dev --persist-to ./.wrangler/state`), so D1/R2/Queue state is reused between runs.
- Apply local D1 migrations before backend work that touches DB schema: `npm run db:migrate:local --prefix backend`.

## Auth, API, and routing quirks
- Better Auth endpoints are under `/api/auth/*`; app API endpoints are under `/v1/*`.
- `GET`/`HEAD` non-`/v1` requests are served from Worker assets (SPA fallback behavior is configured in `wrangler.jsonc`).
- Workspace-scoped API routes require either Better Auth session + `x-workspace-id` header or `Authorization: Bearer <workspace-api-key>`.

## Safety / gotchas
- Treat `backend/.dev.vars` as sensitive local secrets; never commit its contents.
- No test or lint scripts are currently defined; do not invent them. Use focused checks (`backend` typecheck, frontend build, and/or manual endpoint verification) depending on the change.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default canonical triage labels are used. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: `CONTEXT-MAP.md` points to per-context `CONTEXT.md` files, with ADRs in root or context-specific `docs/adr/` directories. See `docs/agents/domain.md`.
