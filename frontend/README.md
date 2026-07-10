# Document Extraction Frontend

The production-like local path is the Bun server at `http://127.0.0.1:8787`, which serves the built frontend together with the API and live updates.

```bash
bun run build
bun run start
```

For frontend iteration, run the Bun server in one terminal and Vite in another:

```bash
bun run dev
bun run dev:frontend
```

Vite serves `http://127.0.0.1:5173` and proxies `/api/auth` and `/v1` to the Bun server.
