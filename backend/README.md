# imageextraction MVP (Cloudflare Workers)

Template-driven asynchronous document extraction API.

## Included in this MVP

- API key auth (tenant lookup in D1)
- Template CRUD with tenant ownership checks
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

5. Seed one tenant with a hashed API key.

Generate SHA-256 for your API key value and insert tenant:

```bash
wrangler d1 execute imageextraction-db --local --command "INSERT INTO tenants (id, api_key_hash, name, created_at, max_image_bytes) VALUES ('tenant_demo', '<sha256>', 'Demo Tenant', datetime('now'), 10485760);"
```

6. Configure local secrets:

```bash
cp .dev.vars.example .dev.vars
```

## Local development (Wrangler)

```bash
npm run dev
```

This starts the Worker locally with D1/R2/Queue bindings via Wrangler.

## API quickstart

Use `Authorization: Bearer <api-key>` for all endpoints except health.

- `POST /v1/templates`
- `GET /v1/templates`
- `GET /v1/templates/:id`
- `PATCH /v1/templates/:id`
- `DELETE /v1/templates/:id`
- `POST /v1/extract` (`multipart/form-data` with `template_id`, one file field as `image`/`file`/`document`, optional JSON `options`)
- `GET /v1/jobs/:id`

## Local dev helpers

These routes are intended for local testing only:

- `POST /v1/dev/tenants` creates a tenant and returns a usable API key
- `POST /v1/dev/reset` clears D1 data and deletes all objects in the image bucket
