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

## Workspace model setup

Each Workspace starts unconfigured. Owners/admins use the expandable **Model gateway**
section on the Workspace page; its status is in the section header, with no separate
readiness banner. Gateway URL, model, and write-only credential are separate from
external-client Workspace API keys. All capability switches start off.

The optional connection test applies only to the current draft and never saves it.
Saving does not contact the gateway. Editing a field clears prior test feedback.
Leave a usable saved credential blank to preserve it; enter a replacement to rotate
or repair it. Clearing requires confirmation. Members see presence only.

The editor clears sensitive draft state on Workspace/session changes, ignores late
responses, and reloads authoritative configuration after live invalidation. Concurrent
edits require reload rather than silently overwriting another session's change.
