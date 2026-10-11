# Connected apps through MCP

Connected apps act as a signed-in user in one explicitly selected Workspace. They do not receive a Workspace API key or Application admin authority. This feature is off by default.

## Qualification status

The intended launch clients are **Claude Desktop and ChatGPT**. Neither client has been qualified against a public installation yet. Local protocol and browser tests are evidence for the server implementation, not proof of interoperability with those products. Keep the feature opt-in until the client checklist below is completed.

The implementation uses Bun 1.4.3, Better Auth / `@better-auth/mcp` / `@better-auth/oauth-provider` 1.7.7, `@modelcontextprotocol/server` 2.3.1, and Zod 4.6.5. Better Auth was already at 1.7.7 before this feature. OAuth and application tables migrate additively; existing accounts are not recreated.

Local qualification on 2026-10-11 passed the OAuth/security suite, both modern JSON and stateless legacy protocol requests, and three browser journeys covering consent/verification, approval/revocation, upload through extraction, and the disabled installation. The migration command also completed twice against the same fresh SQLite state.

The SDK serves the current per-request protocol and its stateless legacy fallback. Legacy requests may receive request-scoped SSE; modern requests normally receive JSON. There is no persistent MCP session, resumable event stream, task API or subscription API. GET and DELETE on `/mcp` return 405. A client must accept both `application/json` and `text/event-stream`.

## Enable an installation

1. Put the single Bun process behind an operator-managed HTTPS reverse proxy. Hosted clients cannot reach the installation's loopback address. There is no managed relay or hosted conversion.
2. Set `BETTER_AUTH_URL` to the canonical public origin, such as `https://documents.example.com`.
3. Set `MCP_ENABLED=true`. Leave `MCP_SENSITIVE_ACTIONS_ENABLED=false` until ordinary reads and submissions have been qualified.
4. Forward `/mcp`, `/.well-known/*`, `/api/auth/*`, `/v1/*`, application assets and the existing live-update WebSocket. Preserve the public Host and bearer Authorization headers. Disable proxy caching for authenticated responses. Allow JSON and request-scoped SSE, uploads up to the installation limit, and requests lasting up to six minutes.
5. Restart and use `https://documents.example.com/mcp` as the connection address. Clients register their callbacks automatically; no operator callback list is required.

`MCP_ALLOWED_REDIRECT_URIS` has been removed. Existing values are ignored and can be deleted from deployment settings. Enabling MCP enables unauthenticated dynamic client registration; Workspace access still requires sign-in and explicit consent.

Only explicitly configured trusted proxy IP headers affect auth rate limiting. The proxy must overwrite those headers. Forwarding headers cannot change the canonical resource, issuer or accepted Origin. HTTP on loopback is available for development; binding the process to a non-loopback interface does not make a loopback URL reachable from a hosted client.

Discovery endpoints are `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/api/auth`. The issuer is the canonical origin plus `/api/auth`; authorization, token and registration endpoints are under `/api/auth/oauth2/`. Check the returned metadata rather than constructing OAuth endpoints in clients. Metadata must be JSON, never the SPA.

Only authorization-code with PKCE and refresh are enabled. Dynamic client registration accepts one to eight HTTPS callbacks per client, with HTTP permitted only for `localhost`, `127.0.0.1` and `[::1]`. Clients using loopback callbacks must register with `application_type: "native"`; web clients use HTTPS on a non-loopback host. Callbacks cannot contain credentials, fragments, wildcards, whitespace or control characters. Authorization must use an exact callback registered to that client; changing a callback requires a new registration. Registration is rate-limited and capped at 1,000 clients per installation. Client-credentials grants and remote client metadata downloads (CIMD) are not supported. No arbitrary URLs are fetched for registration or file import. Client-supplied names and websites are **unverified**, including names that claim to be Claude or ChatGPT.

## Connect, approve and disconnect

The app resumes the signed authorization request through password sign-in, sign-up, email verification and configured Google sign-in. The signed request expires after ten minutes; restart from the client if it expires. Select one accepted Workspace and requested scopes. No Workspace is selected automatically. `workspace:read` is required. Denial does not create a grant.

Each successful authorization creates a separate grant, even for the same client and Workspace. Reconnecting never widens an earlier grant. Browser Workspace switching does not affect it. To add a Workspace or permissions, authorize another connection and disconnect the previous one if it is no longer needed.

Access tokens last five minutes. Grants have a fixed maximum lifetime of 30 days; refresh rotates tokens without extending that ceiling. Refresh-token replay is rejected. **Stay connected** (`offline_access`) is unchecked initially. Without it, access ends with the authorizing browser session. With it, ordinary browser logout preserves the connection. Password reset revokes all that user's grants. Bans, deleted/disabled clients, removed membership, deleted Workspaces and narrowed grants are checked against current state on every operation. An impersonated session cannot grant access, upload files, disconnect apps or approve actions.

Use **Profile settings → Manage connected apps → Disconnect** to revoke one grant. Issued access tokens fail on their next request and refresh stops. Other grants and browser sessions remain intact. Already-admitted Extraction jobs can finish; revocation is not job cancellation. Connection management and disconnection remain available while MCP is disabled.

Sensitive administration is separately controlled by `MCP_SENSITIVE_ACTIONS_ENABLED`. When enabled, all Workspace changes, invitations, member/ownership changes, API-key rotation, Model gateway operations and deletions require an authenticated approval link. The screen identifies the app, Workspace, exact targets, parameters and consequences. An approval expires in ten minutes. Changed targets or revisions require a new request. Current role, grant and session are checked again at commit. The client's own confirmation is not approval.

Model gateway secrets are entered only on the app's approval page. A new Workspace API key is displayed once in the approving browser response; neither MCP output, subsequent approval reads, operation receipts nor security activity contain it. A lost response to key rotation requires a fresh explicit rotation to obtain a new key.

## Tool catalog and scopes

Each account may have at most 100 active grants. Every tool independently checks the token, grant and current Workspace authority. Discovery omits tools lacking their basic scope. Direct calls lacking a scope receive a 403 `insufficient_scope` challenge. Adding a scope requires new consent; it does not grant a role the user lacks.

| Scope | Tools / capabilities |
| --- | --- |
| `workspace:read` | `workspace_context`, `get_operation`, `request_action_approval` (the requested action also needs its own scope) |
| `documents:read` | `list_documents`, `get_document`, `get_packet`, `export_results` |
| `sources:read` | `get_original_download`, authenticated original download; only a derived document's assigned pages |
| `documents:submit` | `request_document_upload`, `submit_document` |
| `documents:review` | `select_document_template`, `confirm_split_plan` |
| `documents:delete` | Approval for document or packet deletion |
| `templates:read` | `list_templates`, `get_template`, `list_template_tags` |
| `templates:write` | `create_template`, `update_template`, `rename_template_tag`, `request_template_sample_upload`, `generate_template_draft`, `assist_template` |
| `templates:delete` | Approval for template or tag deletion |
| `workspace:settings` | Read settings; approve name, retention and processing changes |
| `workspace:costs` | `get_workspace_costs`, `list_document_costs`, `get_document_costs`; current owner/admin only |
| `workspace:members` | List members; approve permitted member changes |
| `workspace:invitations` | List invitations; approve creation/cancellation |
| `workspace:ownership`, `workspace:delete`, `workspace:api-key` | Owner-only transfer, deletion and API-key rotation approvals |
| `workspace:model-gateway` | `get_model_gateway`; approve configuration save/clear or a connection test; current owner/admin only |
| `offline_access` | Continue after browser logout, within the grant lifetime |

Template fields use the existing schema (`name`, `data_type`, `description`). Creating/updating a Template with `tags` creates or assigns the corresponding tags. Edits require `expected_version` and `expected_updated_at` from `get_template`; accepted Documents retain their pinned version. Generated/assisted drafts are proposals: saving is a separate explicit call. Assistance using existing results additionally needs `documents:read`; original evidence needs `sources:read`. Browser Evaluation state is not accepted.

Approvals accept the typed action names advertised by `request_action_approval`: `workspace.rename`, `workspace.retention`, `workspace.processing`, `workspace.invite`, `workspace.cancel_invitation`, `workspace.member`, `workspace.transfer_ownership`, `workspace.rotate_api_key`, `workspace.delete`, `template.delete`, `tag.delete`, `document.delete`, `packet.delete`, and `gateway.save/clear/test`. Member changes preserve domain role rules and the last accepted Workspace constraint. A packet deletion approves its exact set of children; there is no arbitrary bulk-delete endpoint.

Account/profile management, Application admin operations, Evaluation history, remote attachments and general HTTP proxying are outside this catalog.

## Upload and extraction

A file attached to an LLM conversation is not automatically on this server. Call `request_document_upload`, open its app URL in a signed-in browser and upload one PDF, PNG, JPEG or WEBP. The link belongs to its initiating user, client, grant and Workspace. It expires after 15 minutes and accepts one successful upload. Failed uploads can be retried while the request remains valid.

Pass the returned `source_ref` and a stable `operation_id` to `submit_document`. Optional Template, tag and page selections use normal product validation. Submission checks model readiness and uses the same admission budget, resource reservations, store leases, deletion fences, Source retention and Go processing as the application. It returns a durable Document or packet ID. Poll no faster than every two seconds and back off after 429/503. Closing the client does not cancel an already-accepted job.

Sample uploads use `request_template_sample_upload` and cannot be substituted for submission references. Requests are limited to ten unfinished uploads per grant and 500 stored upload requests globally. Abandoned, expired and revoked uploads are swept on startup/request activity. Download URLs require the same live MCP bearer token; they are not public signed links. Originals must still be retained.

## Reliability and operations

Reuse the same `operation_id` and unchanged arguments after a lost response. Keys are scoped to grant, Workspace and action. Changed input with the same key fails. Approval retries return the same request/status even if the target subsequently changes. `get_operation` rechecks the original capability before returning a saved result.

Control mutations and their receipts/audit commit in one control-database transaction. Product mutations store a receipt in their product transaction; a retry/status read repairs a missing control completion and records `recovered_commit`. Submission IDs are deterministic per operation, so an accepted Document/packet is recovered without resubmission. Restarted in-flight operations are marked `mcp_outcome_unknown`; receipts/accepted submissions can reconcile them. An interrupted external gateway test has no atomic remote receipt and is never automatically repeated. Inspect the app before authorizing a new operation when an outcome remains unknown.

The transport allows four concurrent responses and 120 requests/minute per user/client/Workspace, with at most 1,000 tracked combinations. Streams retain a slot until completion/cancellation/deadline. Requests are limited to 256 KiB, results to 256 KiB, document exports to 20 IDs and list pages to at most 50 items. Large results direct the user to the application. The maximum transport duration is six minutes; model calls retain their existing configured timeouts. The shared submission admission also applies to uploads and model-assisted work. Existing queue/cost accounting measures processing, queue delay, failures and model usage; MCP responses include tool duration.

Security activity is stored separately from product analytics in control SQLite. It contains actor/client/grant/Workspace IDs, action, request/approval references, outcome and time. It excludes tokens, passwords, credentials, filenames and Document contents. There is no delegated audit-reader or dashboard; only the installation operator can inspect the private database. Activity, expired grants and operation records are cleaned after 90 days during request-triggered maintenance. Product receipts are cleaned when a product store opens after that retention period. OAuth expiry, revocation and upload cleanup remain effective even when MCP is off. Account deletion cascades grants; missing-grant uploads and operations are removed by maintenance. Workspace deletion immediately removes authority and uses existing durable cleanup.

Back up the complete installation state and matching machine keys together while the server is stopped. Restoring an older backup also restores its old grants and signing keys: start with MCP disabled and disconnect restored grants before reopening access. There is no automatic database downgrade or multi-instance deployment. Do not run two independent servers against the same state.

## Client release checklist

For **each** of Claude Desktop and ChatGPT, record the exact client/version (or hosted test date), public origin/proxy, callback URI, registration behavior and negotiated protocol. Prove login → consent → read → refresh → disconnect; denied/expired consent; reconnect; upload → real extraction → result; exact-action approval and secret exclusion. Confirm metadata is JSON, both JSON/SSE responses work and revoked tokens fail. Test Google continuation separately on an installation with Google configured. Do not mark issue 71 qualified from SDK or browser harness tests alone.

Local automated evidence lives in `backend/src/mcp/authorization.bun.test.ts`, `e2e/delegatedMcpAccessJourney.spec.ts` and the delegation frontend tests. The browser journey uses real DCR, PKCE, cookies, verification, consent, approvals and token revocation against the Bun server. Client product qualification remains a release prerequisite.

## Troubleshooting

- **Connection request expired:** restart connection in the client; the signed login/consent request lasts ten minutes.
- **Registration rejected:** supply one to eight complete HTTPS callbacks (HTTP only on loopback), without credentials, fragments or wildcards. Authorization must use the exact callback supplied during registration. An installation at its registration cap requires operator review of unused client records.
- **401:** supply a current MCP token for this resource and issuer. Workspace API keys and browser cookies do not authenticate `/mcp`.
- **403 / insufficient scope:** reconnect with the capability and check current Workspace membership/role. New scopes do not override roles.
- **Approval changed/expired:** read the latest target and request a new approval with a new operation key.
- **Unknown operation outcome:** inspect current product state; retry the same operation/status lookup for receipt recovery. Never silently repeat a sensitive action under a new key.
- **Array/TEXT migration warnings:** Better Auth 1.7.7 can report these for its OAuth fields on repeated SQLite initialization. The repeated migration check completes successfully; these messages alone do not mean initialization failed.
- **429 / 503:** honor Retry-After and slow polling; check existing runtime admission and resource limits.
