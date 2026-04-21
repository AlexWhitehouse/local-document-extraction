# Dev frontend

Simple React UI for local API testing.

## Run

1. Start backend in `backend`:

```bash
npm run dev
```

2. Start frontend in `frontend`:

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/v1/*` to `http://127.0.0.1:8787`.

## What it can do

- Create dev tenant (`POST /v1/dev/tenants`)
- Create/list/update/delete templates (`/v1/templates`)
- Upload image and create extraction job (`POST /v1/extract`)
- Poll latest job (`GET /v1/jobs/:id`)
- Reset local data and clear R2 objects (`POST /v1/dev/reset`)
