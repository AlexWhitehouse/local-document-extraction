# Configuration

The server reads environment variables at startup. For a source checkout, copy `.env.example` to `.env` at the repository root and run Bun commands from that root. The installer writes a private `config.env` outside the application release directory and its launcher loads that file. Existing process environment overrides Bun's file-loaded values. Restart after changes; the frontend discovers public capabilities at runtime through `GET /v1/config`.

The installer offers a [first-time setup wizard](setup.md#first-time-setup-questions) for the public URL, login methods, and Cloudflare email settings below. It preserves existing configuration during upgrades. `config.env` uses Bun dotenv syntax; do not execute or source it as a shell script.

Use the installed launcher's `doctor` command (its printed absolute path, or `document-extraction doctor` after the [PATH setup](setup.md#launcher)), or `bun backend/src/checkConfiguration.ts` from source, to validate settings without starting the server. Validation errors identify the setting without printing secret values. Empty optional values mean unset. Use `true` or `false` for booleans (case-insensitive aliases `1`/`0`, `yes`/`no`, and `on`/`off` are also accepted); byte counts and durations are integers. Do not put secrets in frontend variables, source files, issue reports, or Git.

## Network, paths, and access

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address on which the server listens. Keep loopback for personal local use. |
| `PORT` | `8787` | Server TCP port; `0` is available for tests using an ephemeral port. |
| `BETTER_AUTH_URL` | Local server origin | Browser-facing HTTP(S) origin used in account links and OAuth callbacks. Set an explicit reachable origin behind a proxy. |
| `DOCUMENT_EXTRACTION_STATE_DIR` | Checkout `.local/` | Persistent data root. Installer controls this through its saved `--state-dir`; its launcher overrides file-loaded values. Prefer an absolute path for source setup. |
| `DOCUMENT_EXTRACTION_ASSETS_DIR` | Checkout `frontend/dist/` | Built frontend directory. Installer selects the current release's build and overrides file-loaded values. |
| `DOCUMENT_EXTRACTION_ADMIN_EMAILS` | Empty | Comma-separated emails granted Application admin role when their accounts are created. Does not promote existing accounts on restart. |
| `AUTH_TRUSTED_ORIGINS` | Empty | Additional comma-separated exact HTTP(S) origins allowed by auth. The configured application origin is trusted automatically. No wildcard or maintainer domain is included. |
| `AUTH_TRUSTED_IP_HEADERS` | Empty | Comma-separated client-IP headers to trust. Header-derived IP tracking is disabled by default. |
| `DEV_API_ORIGIN` | `http://127.0.0.1:<PORT or 8787>` | Development-only Vite proxy target for `/api/auth` and `/v1`. Has no effect on the built SPA. |

Auth URLs must be origins, without credentials, paths, query parameters, or fragments. Use the same hostname consistently: `localhost` and `127.0.0.1` are different browser origins. For a loopback application origin, standard localhost/127.0.0.1 Vite origins on port 5173 and loopback aliases at the application port are trusted automatically. For other development origins, add the exact Vite origin to `AUTH_TRUSTED_ORIGINS`.

Use a dedicated real directory for state. The filesystem root, home root, and repository root are rejected as state locations; symlink state roots and child directories are refused before permission changes. Startup repairs owner-only permissions on existing state without erasing its contents.

For remote access, set a browser-facing HTTPS `BETTER_AUTH_URL` and place a TLS proxy in front of the app. Forward `/api/auth`, `/v1`, and the Workspace WebSocket route. Changing `HOST` to `0.0.0.0` exposes the listener to other machines; use firewall rules and a trusted proxy appropriate to your environment. Only set `AUTH_TRUSTED_IP_HEADERS` when that proxy overwrites the selected header and clients cannot bypass it. `cf-connecting-ip` is appropriate only for an actual trusted Cloudflare path; it is not enabled by default.

## Authentication

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` | Allow email/password authentication. |
| `AUTH_GOOGLE_ENABLED` | `false` | Enable Google OAuth explicitly. Requires both Google credential values. |
| `AUTH_SIGNUP_ENABLED` | `true` | Permit new account registration, including new Google accounts. Existing users can still sign in when disabled. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `false` | Set `true` to require verification before email/password account access. |
| `GOOGLE_CLIENT_ID` | Unset | Google OAuth web-client ID. |
| `GOOGLE_CLIENT_SECRET` | Unset | Google OAuth client secret. Never exposed to the browser. |

At least one login method must remain enabled. An incomplete Google ID/secret pair is rejected even if Google login is disabled. Configure administrator emails and create required accounts (and verify them if verification is enabled) before disabling signup. There is no automatic precreated administrator or default password. Changing the administrator list does not retroactively change persisted roles; use Application admin while an existing administrator is signed in.

The auth signing secret is generated in `data/better-auth-secret`. This application supplies that disk secret explicitly; `BETTER_AUTH_SECRET` is not a supported override. Preserve it in backups. Password policy requires at least eight characters, an ASCII uppercase letter, a number, and a special character. Reset links expire after one hour and successful password changes revoke existing sessions.

### Optional email verification

Accounts can sign up and sign in immediately by default. To require proof of email ownership, set this in your `.env` or installer `config.env`, then restart:

```dotenv
AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

With the default `EMAIL_PROVIDER=local`, verification links are saved on the host; run the installed launcher's `mail` command to read them. For inbox delivery, configure [Cloudflare email](#cloudflare-email-setup). New accounts must then verify before signing in, and sign-in attempts by existing unverified accounts request a verification link. Existing sessions are not forcibly signed out.

Updates preserve your configuration. Installations created with v0.1.0 may still have `AUTH_REQUIRE_EMAIL_VERIFICATION=true`; change it to `false` and restart to use the new default behavior.

### Google sign-in

1. Create an OAuth web client in your [Google credentials console](https://console.cloud.google.com/apis/credentials) and configure its consent screen and permitted test users as required by Google.
2. Add the exact application callback: `http://127.0.0.1:8787/api/auth/callback/google` for the default local origin, or `https://app.example.com/api/auth/callback/google` for your HTTPS deployment. Use your actual configured origin and port.
3. Set these values in the private configuration, restart, and test login. See [Better Auth's Google setup reference](https://better-auth.com/docs/authentication/google) for the callback contract:

```dotenv
AUTH_GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
BETTER_AUTH_URL=http://127.0.0.1:8787
```

For Google-only login, set `AUTH_EMAIL_PASSWORD_ENABLED=false` after verifying the Google setup. Google is the only implemented social provider. Generic OIDC, SAML, Microsoft Entra ID, and other enterprise identity providers need additional integration; changing environment variables cannot enable them.

## Transactional email

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `local` | `local` captures messages on disk; `cloudflare` sends through the Cloudflare Email REST API. |
| `EMAIL_FROM_ADDRESS` | `no-reply@example.com` in local mode | Sender email. Cloudflare mode requires an explicit address on your onboarded sending domain. |
| `EMAIL_FROM_NAME` | `Document Extraction` | Display name for verification and password-reset mail. |
| `CLOUDFLARE_ACCOUNT_ID` | Unset | 32-character hexadecimal sending account identifier; required in Cloudflare mode. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Unset | Send-capable account API token; required in Cloudflare mode. |

Cloudflare account ID and token must either both be absent or both be set, even in local mode.

Local mode is the zero-credential default. Account verification and password-reset URLs appear in the private server log and `mail/YYYY-MM-DD.jsonl` under the state directory. Installer users can run `document-extraction mail`; source users can open the current day's file or the server output. Open the link in the same browser/origin as the app. When verification is enabled, a sign-in attempt for an unverified account requests another verification message. These local links grant account access and should not be shared in screenshots or support reports.

Local capture is suitable when the person operating the machine can read the logs. For other users to verify their own mailboxes, configure actual delivery. Workspace invitations remain in-app invitations; this email transport handles account verification and password reset.

### Cloudflare email setup

Onboard a sending domain in Cloudflare Email Service and complete its DNS setup. Cloudflare currently requires Cloudflare DNS for Email Service. Use the account that owns that domain and an API token permitted to send email. Follow [Cloudflare's domain onboarding instructions](https://developers.cloudflare.com/email-service/get-started/send-emails/) and [REST authentication reference](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/).

In the [Cloudflare dashboard](https://dash.cloudflare.com/), select your account and search for **Copy account ID** ([account ID help](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)). Create a custom token under [API Tokens](https://dash.cloudflare.com/profile/api-tokens) with **Account → Email Sending → Edit**, restricted to that account. Use the resulting token as `CLOUDFLARE_EMAIL_API_TOKEN`.

```dotenv
EMAIL_PROVIDER=cloudflare
EMAIL_FROM_ADDRESS=no-reply@your-domain.example
EMAIL_FROM_NAME="Document Extraction"
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_EMAIL_API_TOKEN=your-send-capable-token
BETTER_AUTH_URL=https://app.your-domain.example
```

Replace every example with your real configuration. `BETTER_AUTH_URL` must be reachable by the person opening the message. The Bun application uses HTTPS REST requests; deploying a Cloudflare Worker or adding a Workers email binding is unnecessary. Cloudflare mode does not also record usable verification/reset links through local capture. Restart and test password reset (and signup if verification is enabled) with an inbox you control; a successful queued API response is not proof of inbox delivery. Consult provider delivery logs for bounces, account entitlement, or sender-domain errors. Live delivery requires your account and is a separate release verification step.

## Payload, model, and extraction limits

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_SOURCE_FILE_BYTES` | `10485760` (10 MiB) | Maximum PNG, JPEG, WebP, or PDF upload size. |
| `MAX_JSON_REQUEST_BYTES` | `1048576` (1 MiB) | Maximum non-document JSON request body. |
| `SUBMISSION_MAX_CONCURRENCY` | `8` | Maximum concurrent admitted uploads. |
| `SUBMISSION_MAX_RESERVED_BYTES` | `134217728` (128 MiB) | Shared upload reservation budget. Must fit one maximum-sized source plus 32 KiB multipart envelope. |
| `MODEL_GATEWAY_REQUEST_TIMEOUT_MS` | `300000` (5 minutes) | Timeout for extraction model calls. |
| `EXTRACTION_RETRY_DELAY_MS` | `1000` | Initial delay before retrying a transient model failure. |
| `EXTRACTION_MAX_CONCURRENCY` | `8` | Initial concurrent extraction permits. Must not exceed the configured maximum. |
| `EXTRACTION_MAX_BUFFERED` | `10000` | Bound on queued in-memory job metadata; authoritative jobs remain in SQLite. |
| `EXTRACTION_RECONCILE_INTERVAL_MS` | `60000` | Durable queue reconciliation interval. |
| `EXTRACTION_ADAPTIVE_CONCURRENCY` | `true` | Adjust processing permits in response to resource pressure. |
| `EXTRACTION_MAX_CONCURRENCY_LIMIT` | `32` | Maximum adaptive extraction concurrency. |

The logical document request cap is the source limit plus 32 KiB. The transport cap includes another 32 KiB envelope; raising the upload limit also requires enough submission reservation space. For example:

```dotenv
MAX_SOURCE_FILE_BYTES=52428800
SUBMISSION_MAX_RESERVED_BYTES=268435456
```

This accepts a 50 MiB source within a 256 MiB shared upload budget. It does not guarantee that every PDF can be rendered within the preparation limit or sent within your model provider's limits. PDFs can expand substantially during decoding and image/base64 preparation.

Gateway URL, model name, outbound credential, direct-PDF support, structured-output support, and sequential-call preference are configured **per Workspace in the UI**. They are not deployment environment variables. All capability switches start off. An unconfigured Workspace rejects upload before storing the source. A credential is encrypted using `secrets/model-gateway.key`; preserve that key with the databases. Local/private HTTP gateways are supported, so Workspace owners/admins should be trusted to choose reachable endpoints.

Retired variables are ignored and reported by name only at startup: `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, `MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_SEQUENTIAL_CALLS`, `MODEL_SUPPORTS_PDF_INPUT`, `MODEL_SUPPORTS_STRUCTURED_OUTPUT`, and `MODEL_GATEWAY_USE_MANAGED_FILES`. Old global credentials are not imported. Managed-file uploads are not supported.

Some safety and protocol limits deliberately remain internal: three processing attempts, a 60-second retry-delay ceiling, a 30-second connection-test timeout, rendered PDF images at up to 2048 pixels per dimension with a 64 MiB aggregate budget, and two concurrent exports with a 32 MiB selected-results budget. Template shape limits and multipart/WebSocket protocol limits are also fixed. These are not hidden environment variables; changes require code changes and matching memory/protocol validation.

## Resources, retention, and shutdown

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOCAL_CPU_LIMIT_RATIO` | `0.85` | CPU pressure threshold as a fraction of host capacity. |
| `LOCAL_MEMORY_LIMIT_RATIO` | `0.8` | Process RSS threshold as a fraction of physical host RAM. |
| `MODEL_PREPARATION_MAX_BYTES` | 90% of the process memory allowance | Optional lower shared preparation reservation budget. Cannot exceed the RAM-derived maximum. |
| `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES` | `4194304` (4 MiB) | Reservation size considered large under OS warning pressure. |
| `LOCAL_DISK_RESERVE_BYTES` | `1073741824` (1 GiB) | Free disk space reserved from admission. Zero disables this reserve. |
| `SOURCE_RETENTION_SWEEP_INTERVAL_MS` | `3600000` (1 hour) | Interval for restart-safe source cleanup. |
| `FAILED_SOURCE_RETENTION_MS` | `604800000` (7 days) | Failed source-binary retention; zero makes failed sources immediately eligible for cleanup. |
| `LOCAL_SHUTDOWN_TIMEOUT_MS` | `10000` | Time allowed for graceful shutdown before forced completion. |
| `LOCAL_ANALYTICS_ENABLED` | `true` | Write privacy-filtered operational events locally. No remote analytics service is used. |

Ratios are greater than zero and at most one. Most counts, bytes, and intervals must be positive safe integers; disk reserve and failed-source retention also accept zero. Timer intervals are additionally capped at 2,147,483,647 ms; failed-source retention is capped at 8,640,000,000,000,000 ms. Limits are validated together at startup.

Default preparation reservations can total 72% of physical host RAM. These estimates do not preallocate memory or impose an OS memory cap. Other processes, including a local model server, consume separate memory; lower the limits when sharing a machine. `/v1/health` exposes aggregate runtime diagnostics. Do not treat a successful health response as proof that a model or email provider is configured correctly.

Successful jobs remove their source binaries after cleanup; failed sources follow retention. Job records, extracted results, accounts, mail capture, and analytics are not deleted by that source sweep. Remove old mail/analytics files deliberately if you need a retention policy, and stop the server before backing up SQLite state.
