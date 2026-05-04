# imageextraction MVP (Cloudflare Workers)

Template-driven asynchronous document extraction API.

## Included in this MVP

- Better Auth user accounts (email/password)
- Workspace membership model (owner/admin/member)
- Workspace API key auth (for non-frontend API clients)
- Workspace invitations (invite + accept)
- Template CRUD with workspace ownership checks
- `POST /v1/extract` with required `template_id` (multipart image/PDF upload)
- Queue-based async processing
- AI Gateway call to OpenAI-compatible chat completions endpoint
- Job polling via `GET /v1/jobs/:id`
- Temporary R2 storage with delete-after-success behavior

## Prerequisites

- Node.js 20+
- Cloudflare account
- Wrangler auth (`wrangler login`)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create cloud resources:

```bash
wrangler d1 create imageextraction-db
wrangler r2 bucket create imageextraction-images
wrangler queues create imageextraction-jobs
```

3. Copy IDs into `wrangler.jsonc` (`database_id`, account/gateway vars).

4. Apply local migration:

```bash
npm run db:migrate:local
```

5. Configure secrets using Wrangler (`wrangler secret put ...`) or your deployment environment.

## Local runtime (Wrangler)

```bash
npm run start
```

This starts the Worker locally with D1/R2/Queue bindings via Wrangler.

## Production deploy (`extract.t3m.uk`)

The Worker is configured for a Cloudflare custom domain route:

- `extract.t3m.uk` (`custom_domain: true`)
- static frontend assets served from `../frontend/dist`

Deploy steps:

1. Authenticate and confirm account:

```bash
wrangler login
wrangler whoami
```

2. Set required Worker secrets (production values):

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_SECRET
```

`GOOGLE_CLIENT_SECRET` is only required if Google sign-in is enabled.

3. Apply D1 migrations to remote:

```bash
npm run db:migrate:remote
```

4. Build frontend and deploy Worker from `backend`:

```bash
npm run deploy:prod
```

5. In Cloudflare Dashboard, verify the Worker route/custom domain shows `extract.t3m.uk` and is active.

Notes:

- The DNS zone `t3m.uk` must be in the same Cloudflare account as this Worker.
- If `extract.t3m.uk` already has an existing DNS record, remove/replace it before attaching as a Worker custom domain.
- Add `https://extract.t3m.uk/api/auth/callback/google` to your Google OAuth redirect URIs if Google login is enabled.

## API quickstart

Auth routes:

- `POST/GET /api/auth/*` (Better Auth handler)

App routes use either:

- Better Auth session cookie + `x-workspace-id` header, or
- `Authorization: Bearer <workspace-api-key>` for API clients.

Workspace management routes (session required):

- `GET /v1/workspaces`
- `POST /v1/workspaces`
- `PATCH /v1/workspaces/:id`
- `DELETE /v1/workspaces/:id`
- `POST /v1/workspaces/:id/api-key`
- `POST /v1/workspaces/:id/invitations`
- `GET /v1/workspaces/:id/invitations`
- `GET /v1/invitations`
- `POST /v1/invitations/:id/accept`

Core extraction routes:

- `POST /v1/templates`
- `GET /v1/templates`
- `GET /v1/templates/:id`
- `PATCH /v1/templates/:id`
- `DELETE /v1/templates/:id`
- `POST /v1/extract` (`multipart/form-data` with `template_id`, one file field as `image`/`file`/`document`, optional JSON `options`)
- `GET /v1/jobs/:id`

## Profile routes (session required)

- `GET /v1/profile`
- `PATCH /v1/profile`
