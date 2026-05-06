# Frontend

React UI for the Document Extraction workspace experience.

## Run

1. Start backend in `backend`:

```bash
npm run start
```

2. Start frontend in `frontend`:

```bash
npm install
npm run start
```

The frontend runs on `http://localhost:5173` and proxies `/v1/*` to `http://127.0.0.1:8787`.

## What it can do

- Create/list/update/delete templates (`/v1/templates`)
- Upload a Document Source file and create an Extraction job (`POST /v1/extract`)
- Poll latest job (`GET /v1/jobs/:id`)
- View and update user profile (`GET/PATCH /v1/profile`)
