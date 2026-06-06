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

Stripe recurring Price IDs are environment-specific deployment values because Stripe test mode and live mode use different objects. Keep test-mode values in local development only, and keep live-mode values in the operator-managed production deployment file:

- `STRIPE_PRO_MONTHLY_PRICE_ID` / `STRIPE_MAX_MONTHLY_PRICE_ID`

Price IDs do not reveal test mode or live mode by prefix. Before production deploy, the preflight reads each configured Stripe Price and requires `livemode: true`, `active: true`, GBP currency, monthly recurring billing, and an amount that matches the code-owned Workspace billing catalog.

Credit pack Checkout prices are generated from the in-code Workspace billing catalog. Checkout return URLs are derived from the current request origin.

Secret Stripe values must stay in local/deployment secret storage and must not be committed:

- `STRIPE_API_KEY` - restricted Stripe API key for backend billing operations.
- `STRIPE_WEBHOOK_SECRET` - webhook signing secret for `/v1/billing/stripe/webhook`.
- `STRIPE_WEBHOOK_SECRET_NEXT` - optional temporary webhook signing secret used only during Stripe endpoint secret rotation.

For local development, add test-mode values to `backend/.dev.vars` or the equivalent local secret store. Do not commit `backend/.dev.vars`.

For production deploys, use the repo-root `.vars` file. This is a dotenv file consumed from the backend deploy command with `wrangler deploy --secrets-file ../.vars`. Wrangler uploads the listed values as Cloudflare Worker secrets for the deployed version. The `.vars` file is gitignored and must never be printed, pasted into issue comments, or committed.

The repo-root `.vars` file must define these production keys:

- `AI_GATEWAY_TOKEN`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `STRIPE_API_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `STRIPE_MAX_MONTHLY_PRICE_ID`

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are required while Google sign-in is enabled. `STRIPE_WEBHOOK_SECRET_NEXT` is optional and should be present only during Stripe endpoint secret rotation.

Use Stripe CLI forwarding when manually testing webhook-backed billing flows:

```bash
stripe listen --forward-to http://localhost:8787/v1/billing/stripe/webhook
```

Copy the printed webhook signing secret into the local `STRIPE_WEBHOOK_SECRET` value for the running Worker process. In production, configure an endpoint for `https://extract.t3m.uk/v1/billing/stripe/webhook` and store the live webhook signing secret through Wrangler or deployment secret management.

Production webhook security:

- Configure the live webhook as an account-scoped endpoint, not an organization-wide or Connect endpoint.
- The production-readiness launch allowlist is `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.finalized`, `invoice.finalization_failed`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.voided`, `invoice.marked_uncollectible`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, and `customer.subscription.resumed`.
- Do not subscribe the live endpoint to all events. Keep launch blocked until each allowlisted event has an explicit Workspace billing route from the completed production-readiness issues.
- The Worker verifies Stripe signatures from the raw request body, accepts only `v1` signature schemes, and rejects signatures outside a five-minute timestamp tolerance.
- The live webhook endpoint event API version must be pinned to or verified against `2026-05-27.dahlia`, matching the Worker's outbound Stripe REST API version and the payload fields covered by backend webhook tests.
- During Stripe endpoint secret rotation with delayed expiration, put the newly revealed signing secret in `STRIPE_WEBHOOK_SECRET_NEXT` before Stripe starts sending signatures for both active secrets. After the previous secret has expired and deliveries are healthy, promote the new value to `STRIPE_WEBHOOK_SECRET` and remove `STRIPE_WEBHOOK_SECRET_NEXT`.

Stripe restricted API key permissions:

- Customers: read and write, for Workspace-scoped Customer creation and default payment method checks.
- Checkout Sessions: create, read, and list, for owner Checkout creation and Billing reconciliation reads.
- Subscriptions: read, update, and cancel, for self-service Plan upgrades, Plan downgrades, Subscription cancellation, and reconciliation of app-owned subscription state.
- Invoices: create, read, list, and finalize, for payment-required Plan overrides, Enterprise invoices, hosted invoice state, and Billing reconciliation reads.
- Invoice Items: create, for payment-required Plan override and Enterprise invoice line items.
- Prices: read, for the production preflight to verify live Pro and Max monthly Price IDs against the code-owned Workspace billing catalog.
- Webhook Endpoints: read, for the production preflight to verify the live billing webhook URL and narrow subscribed event allowlist.
- Billing reconciliation reads: allow the read permissions needed to list Customer Checkout Sessions and Invoices, including expanded invoice and line data used by the reconciliation checks.

Validate the restricted key in Stripe test mode before creating the equivalent live key:

1. Run the owner Checkout, self-service subscription, payment-required Plan override, Enterprise invoice, and Billing reconciliation flows with a test-mode restricted key.
2. Review Stripe request logs in Workbench or Dashboard for any denied request, unexpected endpoint, or permission that is broader than the observed code path requires.
3. Adjust the test restricted key until all required flows pass with only the permissions above, then create the live restricted key with the same permission set.

If a restricted key cannot be used temporarily, record an operator exception outside source control with owner, expiry date, reason, and rotation plan. The exception should also name the compensating controls and the planned move back to a restricted key.

### Production scheduled billing

Production scheduled billing runs through the Worker's `scheduled()` handler. The production Cron Trigger is configured in `wrangler.jsonc` as `17 * * * *`, which runs at minute 17 of every hour in UTC.

Before live billing launch, verify the Cron Trigger in Cloudflare Dashboard under Workers & Pages > `document-extraction-api` > Settings > Triggers > Cron Triggers. After deploy, confirm scheduled billing execution by checking Workers Logs for structured non-secret scheduled billing logs such as `billing.scheduled.workspace_failed`, and by reviewing Application admin billing state for recent Billing reconciliation checks and any open drift records.

To test the handler locally, run Wrangler with scheduled testing enabled and call the scheduled route:

```bash
wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=17+*+*+*+*"
```

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

2. Create or verify the repo-root `.vars` file.

```bash
cd ..
test -f .vars
cd backend
```

The `.vars` file uses dotenv syntax, stays outside git, and contains the required production keys listed in Stripe billing setup. Do not print the file contents.

3. Apply D1 migrations to remote:

```bash
npm run db:migrate:remote
```

4. Run production preflight from `backend`:

```bash
npm run preflight:prod
```

The preflight checks production configuration, required deployment values, remote prerequisites, live Stripe Price IDs, the live webhook setup, Cron Trigger setup, custom-domain health, and frontend production build without printing secret values.

5. Deploy Worker from `backend`:

```bash
npm run deploy:prod
```

`npm run deploy:prod` runs the same preflight and then deploys with `wrangler deploy --secrets-file ../.vars`.

6. In Cloudflare Dashboard, verify the Worker route/custom domain shows `extract.t3m.uk` and is active.

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
