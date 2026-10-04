# Configuration

The default settings provide a private app on your machine, with email and password accounts. Use this guide when you need to change a setting.

- [How settings work](#how-settings-work)
- Guides: [access from other machines](#access-from-other-machines) · [Google sign-in](#google-sign-in) · [transactional email](#transactional-email) · [larger uploads](#allow-larger-uploads)
- Reference: [network and access](#network-and-access) · [accounts and sign-in](#accounts-and-sign-in) · [email](#email) · [uploads and extraction](#uploads-and-extraction) · [resources and cleanup](#resources-and-cleanup)
- [Model settings are per Workspace](#model-settings-are-per-workspace)

## How settings work

The app reads environment variables once during startup. **Restart the app after you change these settings.**

| Setup | Settings file |
| --- | --- |
| Installer | `config.env` in the config folder (`~/.config/document-extraction/` by default). The installer's [setup questions](setup.md#first-time-setup-questions) write this file for you. |
| Source checkout | `.env` in the repository root. Create it by copying `.env.example`. |

Use these rules for all settings:

- The file uses dotenv syntax. Do not `source` it as a shell script.
- A shell environment variable overrides the settings file. If the app ignores a file value, look for an exported variable with the same name.
- An empty optional value has the same effect as an unset value.
- Boolean settings accept `true`/`false`, `1`/`0`, `yes`/`no`, or `on`/`off`. Give sizes as whole numbers of bytes. Give durations as whole numbers of milliseconds.
- Never put secrets in frontend files, source code, issue reports, or Git.

To validate settings without starting the app, run the launcher’s `doctor` command. For a source checkout, run `bun backend/src/checkConfiguration.ts`. Errors identify the incorrect setting and do not show secret values.

## Access from other machines

By default, the app accepts connections only from its own machine. To allow access from other machines, use this procedure:

1. Put an HTTPS reverse proxy in front of the app.
2. Configure the proxy to forward `/api/auth`, `/v1`, and the Workspace live-update WebSocket.
3. Set `BETTER_AUTH_URL` to the public HTTPS address, for example `https://documents.example.com`. Account emails and Google sign-in use this address.
4. Keep `HOST` at `127.0.0.1` if the proxy runs on the same machine. Use `HOST=0.0.0.0` only with firewall rules that control network access.
5. If the proxy supplies the visitor’s IP address, specify its header in `AUTH_TRUSTED_IP_HEADERS`. The proxy must always overwrite this header to prevent forged addresses. Without a trusted header, all visitors share the proxy’s sign-in rate limit. Use `cf-connecting-ip` only when traffic comes through Cloudflare.

## Google sign-in

1. Create an OAuth web client in the [Google credentials console](https://console.cloud.google.com/apis/credentials).
2. Configure its consent screen and test users as Google requires.
3. Register the redirect address with your host and port. Use `http://127.0.0.1:8787/api/auth/callback/google` locally, or `https://documents.example.com/api/auth/callback/google` behind a proxy.
4. Add these settings.

```dotenv
AUTH_GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
BETTER_AUTH_URL=http://127.0.0.1:8787
```

5. Restart the app.
6. Verify that Google sign-in works.

To permit only Google sign-in, set `AUTH_EMAIL_PASSWORD_ENABLED=false` after you verify Google sign-in. Google is the only supported sign-in provider. OIDC, SAML, and Microsoft Entra ID require code changes. See [Better Auth’s Google guide](https://better-auth.com/docs/authentication/google).

## Transactional email

The app sends account verification and password reset emails. Workspace invitations appear in the app. The app does not email invitations.

**By default, the app does not send emails.** It saves them on this machine. Email links appear in the server log and in `mail/YYYY-MM-DD.jsonl` inside the data folder. Installer users can read them with the launcher’s `mail` command.

Open each link in the browser you use for the app. These links give access to accounts. Do not share them or include them in screenshots.

Local email is suitable for a single user or a machine you control. Configure Cloudflare delivery when other users need to receive their own emails.

### Send email with Cloudflare

1. Add a sending domain in Cloudflare Email Service.
2. Complete its DNS configuration. The domain must use Cloudflare DNS. See [Cloudflare’s setup guide](https://developers.cloudflare.com/email-service/get-started/send-emails/).
3. Find your account ID in the [Cloudflare dashboard](https://dash.cloudflare.com/). Search for **Copy account ID**, or see [where to find it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).
4. Under [API Tokens](https://dash.cloudflare.com/profile/api-tokens), create a custom token. Give it **Account → Email Sending → Edit** permission for that account only.
5. Add these settings with your values.

```dotenv
EMAIL_PROVIDER=cloudflare
EMAIL_FROM_ADDRESS=no-reply@your-domain.example
EMAIL_FROM_NAME="Document Extraction"
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_EMAIL_API_TOKEN=your-send-capable-token
BETTER_AUTH_URL=https://documents.your-domain.example
```

6. Restart the app.
7. Request a password reset for an inbox you control.
8. Verify that the email arrives.

`BETTER_AUTH_URL` must be accessible to the email recipient. With Cloudflare enabled, the app does not save email links locally. Cloudflare acceptance does not guarantee delivery. Examine Cloudflare’s delivery logs if an email does not arrive. This configuration does not need a Cloudflare Worker.

### Require email verification

By default, new accounts can sign in immediately. To require email verification before sign-in, set:

```dotenv
AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

With local email, use the `mail` command to retrieve verification links and give them to the account owners. Cloudflare delivery sends these links directly. An unverified account receives a new link when its owner tries to sign in. Existing signed-in sessions remain active.

An installation from v0.1.0 can retain that release’s enabled verification default. To disable verification, set the value to `false` and restart.

## Allow larger uploads

The default upload limit is 10 MiB per file. To permit larger files, increase the file limit and the shared upload budget. The budget must hold at least one maximum-size file:

```dotenv
MAX_SOURCE_FILE_BYTES=52428800         # 50 MiB per file
SUBMISSION_MAX_RESERVED_BYTES=268435456 # 256 MiB shared between uploads in progress
```

A higher limit does not guarantee a file can be processed:

- PDF limits are fixed at 32 MiB per file, with additional limits on decoded content. A small, heavily compressed PDF can fail with `pdf_source_file_limit_exceeded`.
- Separate memory limits apply when the app prepares images for the model.
- Your model provider may have its own request size limit.

If you use a reverse proxy, raise its upload limit too.

## Keep original documents

By default, the app keeps extraction results and deletes successful working files. It keeps failed working files for seven days. Enable original retention to let users view documents beside their results and download them. Select a storage provider:

- `none` (default): originals are not kept.
- `local`: originals stay in the private state directory, so backups of that directory include them.
- `s3`: originals are stored in an S3-compatible bucket, such as AWS S3 or your RustFS server. The app also keeps a temporary local copy during processing.

For an installed app, run these commands. The storage command asks for settings and tests S3 with a small file. It writes, reads, and deletes the test file. If a step fails, it saves no settings.

```sh
document-extraction stop
document-extraction storage configure
document-extraction start
```

For a source install, set the same values in `.env`:

```dotenv
SOURCE_STORAGE_PROVIDER=s3
SOURCE_STORAGE_S3_ENDPOINT=http://rustfs.internal:9000   # leave unset for AWS S3
SOURCE_STORAGE_S3_REGION=us-east-1
SOURCE_STORAGE_S3_BUCKET=document-extraction
SOURCE_STORAGE_S3_PREFIX=document-extraction/
SOURCE_STORAGE_S3_FORCE_PATH_STYLE=true
SOURCE_STORAGE_S3_ACCESS_KEY_ID=...
SOURCE_STORAGE_S3_SECRET_ACCESS_KEY=...
```

Apply these storage requirements:

- **The bucket must not use object versioning or Object Lock.** The app does not verify these settings. It deletes objects by key. Earlier copies can remain in a versioned or locked bucket. Confirm the bucket settings during `storage configure`. For scripted setup, supply `--confirm-unversioned-bucket`.
- Workspace owners and admins can disable **Retain original documents** on the Workspace page. This setting and the installation setting `SOURCE_ORIGINAL_RETENTION_ENABLED=false` affect new uploads only. Existing originals remain available until you delete their Document or Workspace.
- If the bucket is unavailable, the app starts and existing results remain available. Uploads that require original retention fail with a message to try again.
- Document or Workspace deletion removes access immediately. The app then deletes the original in the background. It retries until storage confirms deletion.
- You can rotate S3 credentials at any time. Keep the endpoint, bucket, prefix, and addressing style unchanged while originals or pending deletions depend on them. The app refuses startup if these values change. It cannot move originals to another location.

## Reference

### Network and access

| Setting | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address the app listens on. Keep the default for personal use. |
| `PORT` | `8787` | Port the app listens on. |
| `BETTER_AUTH_URL` | The app's own local address | The address people open in their browser. Used in email links and Google sign-in. Must be just an origin: no path, query, or login details. |
| `DOCUMENT_EXTRACTION_STATE_DIR` | `.local/` in a source checkout | Where data is stored. The installer manages this for you. Use an absolute path. |
| `DOCUMENT_EXTRACTION_ASSETS_DIR` | `frontend/dist/` in a source checkout | Where the built web app is. The installer manages this for you. |
| `DOCUMENT_EXTRACTION_ADMIN_EMAILS` | Empty | Comma-separated emails that become Application admins **when their account is created**. Adding an email later does not promote an existing account; an existing admin can do that in the app. |
| `AUTH_TRUSTED_ORIGINS` | Empty | Extra comma-separated browser addresses allowed to sign in, such as a development server. The app's own address is always allowed. Wildcards are not supported. |
| `AUTH_TRUSTED_IP_HEADERS` | Empty | Header names a trusted proxy uses for the visitor's IP address. See [access from other machines](#access-from-other-machines). |
| `DEV_API_ORIGIN` | `http://127.0.0.1:<PORT>` | Development only: where the Vite dev server forwards API requests. |

Notes:

- Browsers treat `localhost` and `127.0.0.1` as different addresses. Use one address consistently. Local installations automatically permit the usual Vite development addresses on port 5173.
- Use a dedicated, real data folder. The app rejects the filesystem root, home folder, repository root, and symlinks. During startup, it restricts folder access to the owner.
- Sign-in rate limits are always enabled. Too many attempts return HTTP 429 with `X-Retry-After` in seconds. Restarting the app resets these limits. IPv6 visitors share a limit within each `/64` network.

### Accounts and sign-in

| Setting | Default | Meaning |
| --- | --- | --- |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` | Allow email and password sign-in. |
| `AUTH_GOOGLE_ENABLED` | `false` | Allow Google sign-in. Needs both Google settings below. |
| `AUTH_SIGNUP_ENABLED` | `true` | Allow new accounts, including new Google accounts. Existing accounts can still sign in when this is off. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `false` | Require people to confirm their email before signing in. |
| `GOOGLE_CLIENT_ID` | Not set | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Not set | Google OAuth client secret. Never sent to the browser. |

Notes:

- Enable at least one sign-in method. Supply both Google values or neither, even when Google sign-in is disabled.
- The app has no built-in admin account or default password. Set `DOCUMENT_EXTRACTION_ADMIN_EMAILS` and create the required accounts before you disable signup.
- Passwords require at least eight characters, including an uppercase letter, a number, and a special character. Password reset links expire after one hour. A password change signs out the account’s other sessions.
- The app generates its session signing key in `data/better-auth-secret`. Include this file in backups. The app does not use `BETTER_AUTH_SECRET`.

### Email

| Setting | Default | Meaning |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `local` | `local` saves emails on this machine; `cloudflare` sends them. |
| `EMAIL_FROM_ADDRESS` | `no-reply@example.com` (local only) | Sender address. With Cloudflare, it must be on your sending domain. |
| `EMAIL_FROM_NAME` | `Document Extraction` | Sender name. |
| `CLOUDFLARE_ACCOUNT_ID` | Not set | 32-character Cloudflare account ID. Required for Cloudflare. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Not set | Cloudflare API token that can send email. Required for Cloudflare. |

Set both Cloudflare values or neither, even with local email.

### Uploads and extraction

| Setting | Default | Meaning |
| --- | --- | --- |
| `MAX_SOURCE_FILE_BYTES` | 10 MiB (`10485760`) | Largest PDF, PNG, JPEG, or WebP file that can be uploaded. |
| `MAX_JSON_REQUEST_BYTES` | 1 MiB (`1048576`) | Largest JSON request body (everything except file uploads). |
| `SUBMISSION_MAX_CONCURRENCY` | `8` | How many uploads can be received at once. |
| `SUBMISSION_MAX_RESERVED_BYTES` | 128 MiB (`134217728`) | Total space shared by uploads in progress. Must be at least `MAX_SOURCE_FILE_BYTES + 40960` (40 KiB of multipart overhead). |
| `MODEL_GATEWAY_REQUEST_TIMEOUT_MS` | 5 minutes (`300000`) | How long to wait for the model to answer. |
| `EXTRACTION_RETRY_DELAY_MS` | `1000` | Wait before retrying after a temporary model failure. |
| `EXTRACTION_MAX_CONCURRENCY` | `16` | How many documents are extracted at once, to start with. |
| `EXTRACTION_MAX_CONCURRENCY_LIMIT` | `32` | The most documents extracted at once when adaptive concurrency scales up. |
| `EXTRACTION_ADAPTIVE_CONCURRENCY` | `true` | Scale the number of simultaneous extractions up or down with the machine's load. |
| `EXTRACTION_MAX_BUFFERED` | `10000` | How many queued jobs are held in memory. All jobs are also stored in the database. |
| `EXTRACTION_RECONCILE_INTERVAL_MS` | 1 minute (`60000`) | How often the queue is checked against the database to pick up missed work. |

Some limits are fixed in the code rather than configurable:

- Each document has at most three extraction attempts. Retry delays cannot exceed 60 seconds.
- Automatic selection permits at most 100 matching templates and 64 KiB of candidate metadata. Narrow the tags if the scope exceeds these limits. Smart splitting assesses at most 128 selected PDF pages and creates at most 100 child Documents. Work above these limits stops with an actionable result. The app never silently truncates pages or candidates.
- Split planning and each child classification have separate durable budgets. Each permits one initial assessment and at most two targeted reassessments. Separate bounds apply to transport retries.
- PDF subsets, previews, and derived files use isolated, cancellable processing. Limits are four active operations, eight waiting operations, and 20 seconds per operation. Isolated workers recycle after 32 operations, 64 MiB of input, 128 MiB sampled RSS, or five seconds idle. Derived PDFs are limited to 32 MiB each and 64 MiB in total. Previews are limited to 16 MiB. Parser bounds also apply.
- The **Test connection** button times out after 30 seconds.
- PDF pages sent as images are rendered at up to 2048 pixels on each side, with at most 64 MiB of images per document.
- PDF validation permits 32 MiB per PDF, 16 MiB per decoded stream, and 32 MiB of total decoding work. Other limits are 10,000 pages and five seconds per validation. Eight PDFs can be validated concurrently. Validation workers use the same bounded recycling policy. Eight more can wait for up to five seconds. A full queue rejects uploads with `503 pdf_validation_capacity_unavailable`.
- Excel exports: at most 500 documents and 32 MiB of results, with two exports running at a time.

### Resources and cleanup

| Setting | Default | Meaning |
| --- | --- | --- |
| `LOCAL_CPU_LIMIT_RATIO` | `0.85` | CPU usage, as a fraction of the machine's capacity, above which the app slows down new work. |
| `LOCAL_MEMORY_LIMIT_RATIO` | `0.8` | Memory usage, as a fraction of the machine's RAM, above which the app slows down new work. |
| `MODEL_PREPARATION_MAX_BYTES` | 90% of the memory allowance | Memory set aside for preparing documents for the model. Can only be lowered. |
| `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES` | 4 MiB (`4194304`) | Uploads at least this size are refused while the operating system reports low memory. |
| `LOCAL_DISK_RESERVE_BYTES` | 1 GiB (`1073741824`) | Free disk space to keep; uploads are refused below it. `0` turns this off. |
| `SOURCE_RETENTION_SWEEP_INTERVAL_MS` | 1 hour (`3600000`) | How often uploaded files that are not kept as originals are cleaned up. |
| `FAILED_SOURCE_RETENTION_MS` | 7 days (`604800000`) | How long to keep the uploaded file of a failed job when originals are not kept. `0` removes it at the next cleanup. |
| `SOURCE_STORAGE_PROVIDER` | `none` | Where to keep original documents: `none`, `local` or `s3`. See [Keep original documents](#keep-original-documents). |
| `SOURCE_ORIGINAL_RETENTION_ENABLED` | `true` when storage is set | Keep originals of new uploads. `false` stops keeping new ones without removing existing ones. |
| `SOURCE_STORAGE_S3_*` | — | S3 endpoint, region, bucket, prefix (default `document-extraction/`), path-style addressing, access key ID, secret access key and optional session token. |
| `LOCAL_SHUTDOWN_TIMEOUT_MS` | `10000` | How long to wait for work to finish when stopping. |
| `LOCAL_ANALYTICS_ENABLED` | `true` | Write privacy-filtered usage events to local files. Nothing is sent anywhere. |

Notes:

- Ratios must be greater than 0 and no greater than 1. Other values must be positive whole numbers. The disk reserve and failed-file retention also permit 0.
- Default document preparation can use up to 72% of machine RAM: 90% of the 80% memory allowance. This budget is an estimate, not a hard limit. Other programs, including a local model server, also need memory. Lower the limits on a shared machine. `/v1/health` shows current usage.
- Without original retention, successful jobs lose their working files immediately. Failed jobs keep them for the retention period. The app does not automatically remove job records, results, accounts, saved emails, or analytics. Delete old `mail/` and `analytics/` files manually when necessary.

## Model settings are per Workspace

Configure the AI model separately for each Workspace. An owner or admin sets its gateway URL, credential, and models under **Workspaces → Model gateway**. The Workspace rejects uploads until this configuration is complete.

After you save, the panel shows a summary. Select **Edit** to change the settings. The **Models** table shows each role’s model and declared capabilities: direct PDF input and structured output.

- **Extraction** runs Extraction jobs and Evaluations.
- **Document classification & splitting** selects tag-matching Templates and identifies PDF boundaries, including targeted reassessments. It inherits Extraction settings unless you select **Different model**. A different model has its own direct PDF and structured-output settings. It shares the Workspace gateway, credential, and sequential-call policy. Failure of a custom model does not cause a fallback to Extraction.
- **Template assistant** supplies assistance, suggested requests, and Auto generate. It inherits the extraction model unless you select **Different model**. A different model shares the gateway, credential, and call behavior, with its own capabilities. **Test connection** tests each distinct model.

The app encrypts model credentials with `secrets/model-gateway.key` in the data folder. Include this file in backups. Workspace admins can select any gateway address, including private network addresses. Give this role only to people you trust.

Select model routes that support the required document input. Without Direct PDF input, each assessment sends selected pages as images in one request. Provider limits on image count, payload, context, or output can be lower than application limits. The app does not automatically batch requests to meet provider limits.

A successful text-only connection test does not verify document capabilities. Configure a suitable Document classification & splitting model. If necessary, narrow the PDF page selection through the API.

The app ignores these old global settings and lists their names during startup: `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, `MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_SEQUENTIAL_CALLS`, `MODEL_SUPPORTS_PDF_INPUT`, `MODEL_SUPPORTS_STRUCTURED_OUTPUT`, and `MODEL_GATEWAY_USE_MANAGED_FILES`. It does not import old global credentials.

## Workspace document processing

Workspace owners and admins can change **Enable smart splitting** and **Exclude blank pages** under **Workspaces → Document processing**. These controls are immediately below Model gateway. Each toggle saves immediately and shows a notification. A failed save restores the previous value.

Both settings default to **off** for new and existing Workspaces. They apply to later browser uploads and API submissions. Each accepted item records its effective policy. Later changes do not alter accepted work. Uploads and requests cannot override the policy.

Smart splitting identifies logical documents within PDFs. Image uploads continue to produce one document. API clients can supply PDF `pages` to limit source pages before processing. Browser uploads use all pages. Page selection does not override Workspace settings.

With splitting disabled, the selected pages produce one extraction job. No blank pages are removed. With splitting enabled, blank pages remain unless **Exclude blank pages** is also enabled. Nonblank cover pages remain.

With both settings enabled, a packet can complete as **No documents to extract**. This requires independent verification that every selected page is blank. The packet records exclusions and creates no child jobs.

Automatic template selection has no enable/disable setting. Supply an explicit Template ID or one or more Template tags. Without an ID, the candidate pool includes templates that match **any** supplied tag. The classification model receives the document and candidate IDs, names, and descriptions. It does not receive field definitions or field guidance.

An explicit ID takes priority and fixes the same Template version for all children. Splitting still runs. With tags, each child selects a template independently after splitting. No candidates or unresolved ambiguity eventually requires manual selection. You do not need to upload the file again.

Held packets and documents keep the working source necessary for resolution, even with completed-original retention disabled. Each child Document owns a separate derived PDF. Deleting a child keeps its siblings and the packet original. Deleting a packet removes the group. Deleting a child does not redact its pages from a retained packet original.

The browser shows a single-page upload or an accepted one-document split as a normal Document. It has its own results, download, and export. Multiple documents or unresolved packets use the packet overview. Deleting a Document shown this way also deletes its hidden parent and original.

The API exposes a packet for every PDF accepted with splitting enabled. This includes one-child and all-blank results.

Members can view effective settings under **Workspaces → Document processing**. Owners and admins can change the toggles. To resolve a held document, open it in **Documents**. Select a Template or confirm its page groups. See [Reviewing documents](../mkdocs/docs/usage/document-extraction.md#progress-and-review) for browser steps. See the [packet API](../mkdocs/docs/api/overview.md#document-packets-and-review) to poll progress from an integration.
