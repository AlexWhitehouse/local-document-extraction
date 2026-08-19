# Document Extraction Local Runtime

Document Extraction runs locally on Bun. One server at `http://127.0.0.1:8787` serves the API, Better Auth routes, Workspace live updates, and the built React app.

## Quick Start

From the repository root:

```bash
bun install
bun run migrate
bun run build
bun run start
```

Open `http://127.0.0.1:8787` in a browser. For reload while changing backend code, use `bun run dev`; for Vite UI work in a second terminal, use `bun run dev:frontend` and open `http://127.0.0.1:5173`.

## Local Configuration

The server reads ordinary environment variables. A local `.env` file is suitable for secrets, but do not commit it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Bun server port. |
| `BETTER_AUTH_URL` | `http://127.0.0.1:$PORT` | Public origin used in auth links. |
| `DOCUMENT_EXTRACTION_STATE_DIR` | repo `.local/` | Root directory for all durable local state. |
| `DOCUMENT_EXTRACTION_ADMIN_EMAILS` | empty | Comma-separated local Application admin emails. |
| `MAX_SOURCE_FILE_BYTES` | `10485760` | Maximum accepted Source file size. |
| `MODEL_GATEWAY_URL` | `https://litellm.t3m.uk` | OpenAI-compatible LiteLLM endpoint. |
| `LITELLM_KEY` | unset | Credential sent to LiteLLM; required for real extraction. |
| `AI_MODEL` | `claude-opus-4-7` | LiteLLM model name. |
| `MODEL_GATEWAY_ROUTE_LABEL` | gateway hostname | Stored operational route label. |
| `MODEL_GATEWAY_REQUEST_TIMEOUT_MS` | `300000` | Model request timeout. |
| `MODEL_SUPPORTS_STRUCTURED_OUTPUT` | `true` | Include `response_format` in model requests. |
| `EXTRACTION_RETRY_DELAY_MS` | `0` | Delay before retrying a failed model request. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Optional Google sign-in configuration. |

Signed-in users can override `MODEL_GATEWAY_URL`, `AI_MODEL`, and `LITELLM_KEY`
from **Settings → Model**. UI overrides take effect for new extraction attempts
without a server restart and are stored in
`.local/data/model-gateway.json` (or the configured state directory) with
owner-only file permissions. The saved token is write-only in the UI; removing
it explicitly also overrides any `LITELLM_KEY` environment fallback.

## Local State

`bun run migrate` is idempotent. It creates the control database, Better Auth schema, local secret, and required state directories. Workspace product databases initialize when the Workspace first uses Templates or Documents.

By default `.local/` contains:

- `data/control.sqlite`: accounts, sessions, Workspaces, memberships, invitations, and API-key hashes.
- `data/workspaces/*.sqlite`: one product database per Workspace.
- `source-files/`: temporary uploaded Source file binaries.
- `mail/YYYY-MM-DD.jsonl`: captured verification and password-reset mail.
- `analytics/YYYY-MM-DD.jsonl`: privacy-filtered Workspace product analytics.

To make a backup while the server is stopped:

```bash
cp -a .local ".local-backup-$(date +%F)"
```

To reset all local data while the server is stopped, remove `.local/`, then run `bun run migrate` again.

## Local Mail Sink

Verification and password-reset messages are captured locally instead of being sent. The server logs the action link, and each message is appended to `.local/mail/YYYY-MM-DD.jsonl`. Open the recorded verification link in the local browser to complete account verification.

## Product Analytics

Template changes, document submissions, and terminal extraction outcomes append operational events to `.local/analytics/YYYY-MM-DD.jsonl`. These best-effort logs contain stable product IDs and limited metadata only; they intentionally exclude account emails, API keys, Source file names and bytes, document contents, extracted answers, and evidence.

## Checks

```bash
bun run typecheck
bun run test
bun run build
```

## API Access

Browser requests use a Better Auth session plus `x-workspace-id`. External product clients use a Workspace API key:

```http
Authorization: Bearer <workspace_api_key>
```

API keys can access Template, document-submission, and extraction-job routes. They cannot open live updates or manage account, Workspace, invitation, or admin routes.
