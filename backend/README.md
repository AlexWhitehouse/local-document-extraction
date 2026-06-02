# Document Extraction API (Cloudflare Workers)

Template-driven asynchronous document extraction API.

## Included in this MVP

- Better Auth user accounts (email/password)
- Workspace membership model (owner/admin/member)
- Workspace API key auth (for non-frontend API clients)
- Workspace invitations (invite + accept)
- Template CRUD with workspace ownership checks
- `POST /v1/extract` with required `template_id` and `document` multipart field
- Queue-based async processing
- AI Gateway call to OpenAI-compatible chat completions endpoint
- Job polling via `GET /v1/jobs/:id`
- Temporary Source file storage in R2 with delete-after-success behavior

## Prerequisites

- Node.js 20+
- Cloudflare account
- Wrangler auth (`wrangler login`)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Confirm cloud resources:

```bash
wrangler d1 create document-extraction-db
wrangler r2 bucket create document-extraction-source-files
wrangler queues create document-extraction-jobs
```

The production D1 database `document-extraction-db` and R2 bucket `document-extraction-source-files` have already been provisioned. If you are creating a fresh environment, copy the D1 database ID into `wrangler.jsonc`.

3. Provision or confirm the `document-extraction-jobs` queue and `document-processing-workflow` Workflow before deploying the renamed Worker service `document-extraction-api`.

4. Apply local migration:

```bash
npm run db:migrate:local
```

5. Configure secrets using Wrangler (`wrangler secret put ...`) or your deployment environment.

### Stripe billing setup

Workspace billing uses Stripe Checkout, hosted invoices, signed webhooks, and Billing reconciliation. Keep Stripe test mode and live mode resources separate.

Non-secret Stripe recurring Price IDs are configured in `wrangler.jsonc`:

- `STRIPE_PRO_MONTHLY_PRICE_ID` / `STRIPE_MAX_MONTHLY_PRICE_ID`

Credit pack Checkout prices are generated from the in-code Workspace billing catalog. Checkout return URLs are derived from the current request origin.

Secret Stripe values must stay in local/deployment secret storage and must not be committed:

- `STRIPE_API_KEY` - restricted Stripe API key for backend billing operations.
- `STRIPE_WEBHOOK_SECRET` - webhook signing secret for `/v1/billing/stripe/webhook`.

For local development, add the secrets to `backend/.dev.vars` or the equivalent local secret store. Do not commit `backend/.dev.vars`.

Use Stripe CLI forwarding when manually testing webhook-backed billing flows:

```bash
stripe listen --forward-to http://localhost:8787/v1/billing/stripe/webhook
```

Copy the printed webhook signing secret into the local `STRIPE_WEBHOOK_SECRET` value for the running Worker process. In production, configure an endpoint for `https://extract.t3m.uk/v1/billing/stripe/webhook` and store the live webhook signing secret through Wrangler or deployment secret management.

Operator rollout notes:

- The Worker uses the `SOURCE_FILES_BUCKET`, `EXTRACTION_JOBS_QUEUE`, and `DOCUMENT_PROCESSING_WORKFLOW` bindings in `wrangler.jsonc`.
- Existing Source files must be copied from any old R2 bucket into `document-extraction-source-files` before traffic is switched if outstanding Extraction jobs still reference those object keys.
- Deploy queue and Workflow renames in the same rollout as the Worker binding rename, then retire old Cloudflare resources after the queue is drained and no in-flight Workflow instances depend on them.

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
wrangler secret put STRIPE_API_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
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
- `POST /v1/extract` (`multipart/form-data` with `template_id`, required `document` field, optional JSON `options`)
- `GET /v1/jobs/:id`

## Profile routes (session required)

- `GET /v1/profile`
- `PATCH /v1/profile`
