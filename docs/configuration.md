# Configuration

Most people never need to change a setting: the defaults give you a private app on your own machine with email and password accounts. This page explains how to change things when you do.

- [How settings work](#how-settings-work)
- Guides: [access from other machines](#access-from-other-machines) · [Google sign-in](#google-sign-in) · [transactional email](#transactional-email) · [larger uploads](#allow-larger-uploads)
- Reference: [network and access](#network-and-access) · [accounts and sign-in](#accounts-and-sign-in) · [email](#email) · [uploads and extraction](#uploads-and-extraction) · [resources and cleanup](#resources-and-cleanup)
- [Model settings are per Workspace](#model-settings-are-per-workspace)

## How settings work

Settings are environment variables read once when the app starts. **Restart the app after changing them.**

| Setup | Settings file |
| --- | --- |
| Installer | `config.env` in the config folder (`~/.config/document-extraction/` by default). The installer's [setup questions](setup.md#first-time-setup-questions) write this file for you. |
| Source checkout | `.env` in the repository root. Create it by copying `.env.example`. |

A few rules apply to every setting:

- The file uses dotenv syntax. Don't `source` it as a shell script.
- An environment variable already set in your shell overrides the file. If a setting seems to be ignored, check for an exported variable with the same name.
- Leaving an optional value empty is the same as not setting it.
- True/false settings accept `true`/`false`, `1`/`0`, `yes`/`no`, or `on`/`off`. Sizes are whole numbers of bytes; durations are whole numbers of milliseconds.
- Never put secrets in frontend files, source code, issue reports, or Git.

To check your settings without starting the app, run the launcher's `doctor` command, or `bun backend/src/checkConfiguration.ts` from a source checkout. Errors name the setting at fault without printing secret values.

## Access from other machines

By default the app only accepts connections from the machine it runs on. To reach it from elsewhere:

1. Put a reverse proxy with HTTPS in front of the app, and have it forward `/api/auth`, `/v1`, and the Workspace live-update WebSocket.
2. Set `BETTER_AUTH_URL` to the HTTPS address people will use, for example `https://documents.example.com`. Account emails and Google sign-in use this address.
3. Leave `HOST` as `127.0.0.1` if the proxy runs on the same machine. Setting `HOST=0.0.0.0` exposes the app to your network; only do that with firewall rules in place.
4. If the proxy sets a header with the visitor's real IP address, name it in `AUTH_TRUSTED_IP_HEADERS`. Without it, every visitor appears to come from the proxy and shares one sign-in rate limit. Only do this if the proxy always overwrites that header, so visitors can't fake it. For example, `cf-connecting-ip` is only safe when traffic really comes through Cloudflare.

## Google sign-in

1. In the [Google credentials console](https://console.cloud.google.com/apis/credentials), create an OAuth web client, and set up its consent screen and test users as Google requires.
2. Register this redirect address, using your own address and port: `http://127.0.0.1:8787/api/auth/callback/google` for a local install, or `https://documents.example.com/api/auth/callback/google` behind a proxy.
3. Add these settings, restart, and try signing in:

```dotenv
AUTH_GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
BETTER_AUTH_URL=http://127.0.0.1:8787
```

To allow only Google sign-in, set `AUTH_EMAIL_PASSWORD_ENABLED=false` once Google sign-in works. Google is the only supported sign-in provider; OIDC, SAML, and Microsoft Entra ID would need code changes. See [Better Auth's Google guide](https://better-auth.com/docs/authentication/google) for more detail.

## Transactional email

The app sends two kinds of email: account verification and password reset. (Workspace invitations appear inside the app and are never emailed.)

**By default, emails are not sent.** They are saved on this machine instead. The links in them appear in the server log and in `mail/YYYY-MM-DD.jsonl` inside the data folder. Installer users can read them with the launcher's `mail` command. Open each link in the same browser you use for the app. The links give access to accounts, so don't share them or include them in screenshots.

This works well when you are the only user, or when you control the machine. If other people need to receive their own emails, set up Cloudflare delivery.

### Send email with Cloudflare

1. Add a sending domain in Cloudflare Email Service and finish its DNS setup. Cloudflare requires the domain to use Cloudflare DNS. See [Cloudflare's setup guide](https://developers.cloudflare.com/email-service/get-started/send-emails/).
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/), find your account ID (search for **Copy account ID**, or see [where to find it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)).
3. Under [API Tokens](https://dash.cloudflare.com/profile/api-tokens), create a custom token with the **Account → Email Sending → Edit** permission, limited to that account.
4. Add these settings with your own values, then restart:

```dotenv
EMAIL_PROVIDER=cloudflare
EMAIL_FROM_ADDRESS=no-reply@your-domain.example
EMAIL_FROM_NAME="Document Extraction"
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_EMAIL_API_TOKEN=your-send-capable-token
BETTER_AUTH_URL=https://documents.your-domain.example
```

5. Test it by requesting a password reset for an inbox you control.

`BETTER_AUTH_URL` must be an address the person reading the email can open. When Cloudflare is on, links are no longer saved locally. Cloudflare accepting a message doesn't guarantee it arrives, so check Cloudflare's delivery logs if it doesn't. No Cloudflare Worker is needed.

### Require email verification

New accounts can sign in straight away by default. To make people confirm their email address first, set:

```dotenv
AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

With local email, you'll need to pass the verification links on yourself using the `mail` command, so this is most useful with Cloudflare delivery. Once it's on, anyone with an unverified account who tries to sign in is sent a new verification link. People who are already signed in stay signed in.

If you installed v0.1.0, verification may still be switched on from that release's old default. Set it to `false` and restart if you don't want it.

## Allow larger uploads

Uploads are limited to 10 MiB per file by default. To raise the limit, increase both the file limit and the shared upload budget. The budget must fit at least one maximum-size file:

```dotenv
MAX_SOURCE_FILE_BYTES=52428800         # 50 MiB per file
SUBMISSION_MAX_RESERVED_BYTES=268435456 # 256 MiB shared between uploads in progress
```

A higher limit doesn't guarantee a file can be processed:

- PDFs have their own fixed safety limits: 32 MiB per PDF, and bounds on how much they can expand when decoded. A small but heavily compressed PDF can still be rejected with `pdf_source_file_limit_exceeded`.
- Images go through separate memory limits while they're prepared for the model.
- Your model provider may have its own request size limit.

If you use a reverse proxy, raise its upload limit too.

## Keep original documents

By default the app keeps only extraction results: each uploaded file is deleted once its job succeeds, or after seven days if it fails. You can keep originals instead, so people can view a document beside its results and download it. Choose where they're kept:

- `none` (default): originals aren't kept.
- `local`: originals stay in the private state directory, so backups of that directory include them.
- `s3`: originals go to an S3-compatible bucket, such as AWS S3 or a RustFS server you run. While a document is processed, the app also keeps a temporary local copy.

For an installed app, stop it and run the storage command. It asks the storage questions, checks S3 settings by writing, reading and deleting a small test file, and saves nothing if a step fails:

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

Things to know:

- **The bucket must not use object versioning or Object Lock.** The app doesn't check this. It deletes files by key, so on a versioned or locked bucket, earlier copies of deleted originals stay in the bucket. `storage configure` asks you to confirm this; scripted setups pass `--confirm-unversioned-bucket`.
- Workspace owners and admins can switch off **Retain original documents** on the Workspace page. That, and `SOURCE_ORIGINAL_RETENTION_ENABLED=false` for the whole installation, affect new uploads only. Originals already kept stay available until their Document or Workspace is deleted.
- If the bucket can't be reached, the app still starts and existing results stay available, but uploads that need to keep their original fail with a message asking to try again.
- Deleting a Document or Workspace removes access straight away. The original is then deleted from storage in the background, and retried until storage confirms it.
- You can rotate S3 credentials at any time. You can't change the endpoint, bucket, prefix or addressing style while any originals, or deletions still in progress, use the current ones; the app refuses to start if you try. Moving originals to a new location isn't supported yet.

## Reference

### Network and access

| Setting | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address the app listens on. Keep the default for personal use. |
| `PORT` | `8787` | Port the app listens on. |
| `BETTER_AUTH_URL` | The app's own local address | The address people open in their browser. Used in email links and Google sign-in. Must be just an origin: no path, query, or login details. |
| `DOCUMENT_EXTRACTION_STATE_DIR` | `.local/` in a source checkout | Where data is stored. The installer manages this for you. Use an absolute path. |
| `DOCUMENT_EXTRACTION_ASSETS_DIR` | `frontend/dist/` in a source checkout | Where the built web app is. The installer manages this for you. |
| `DOCUMENT_EXTRACTION_ADMIN_EMAILS` | Empty | Comma-separated emails that become Application admins **when their account is created**. Adding an email later doesn't promote an existing account; an existing admin can do that in the app. |
| `AUTH_TRUSTED_ORIGINS` | Empty | Extra comma-separated browser addresses allowed to sign in, such as a development server. The app's own address is always allowed. Wildcards aren't supported. |
| `AUTH_TRUSTED_IP_HEADERS` | Empty | Header names a trusted proxy uses for the visitor's IP address. See [access from other machines](#access-from-other-machines). |
| `DEV_API_ORIGIN` | `http://127.0.0.1:<PORT>` | Development only: where the Vite dev server forwards API requests. |

Notes:

- `localhost` and `127.0.0.1` count as different addresses in a browser, so use the same one consistently. When the app runs on a local address, the usual Vite development addresses on port 5173 are allowed automatically.
- The data folder must be a dedicated, real folder. The app refuses to use the filesystem root, your home folder, the repository root, or a symlink. On startup it makes the folder readable only by you.
- Sign-in rate limits are always on. Too many attempts return HTTP 429 with an `X-Retry-After` header in seconds. Limits reset when the app restarts, and IPv6 visitors are grouped by `/64` network.

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

- At least one sign-in method must be on. Setting only one of the two Google values is an error, even when Google sign-in is off.
- There is no built-in admin account or default password. Set `DOCUMENT_EXTRACTION_ADMIN_EMAILS` and create the accounts you need before turning off signup.
- Passwords need at least eight characters, including an uppercase letter, a number, and a special character. Password reset links expire after one hour, and changing a password signs out the account's other sessions.
- The key that signs sessions is generated automatically in `data/better-auth-secret`. Keep it with your backups. `BETTER_AUTH_SECRET` is not used.

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
| `EXTRACTION_MAX_CONCURRENCY` | `8` | How many documents are extracted at once, to start with. |
| `EXTRACTION_MAX_CONCURRENCY_LIMIT` | `32` | The most documents extracted at once when adaptive concurrency scales up. |
| `EXTRACTION_ADAPTIVE_CONCURRENCY` | `true` | Scale the number of simultaneous extractions up or down with the machine's load. |
| `EXTRACTION_MAX_BUFFERED` | `10000` | How many queued jobs are held in memory. All jobs are also stored in the database. |
| `EXTRACTION_RECONCILE_INTERVAL_MS` | 1 minute (`60000`) | How often the queue is checked against the database to pick up missed work. |

Some limits are fixed in the code rather than configurable:

- Each document gets at most three extraction attempts, with retries at most 60 seconds apart.
- Automatic selection considers at most 100 matching templates and 64 KiB of candidate metadata; narrow the tags if that scope is too large. Smart splitting assesses up to 128 selected PDF pages and creates at most 100 child Documents. Oversize work stops with an actionable outcome; pages and candidates are never silently truncated.
- Split planning and each child classification have separate durable budgets: one initial assessment plus at most two targeted reassessments. Transport retries are separately bounded.
- PDF subsets, previews, and derived files use isolated cancellable processing: one operation at a time, at most four waiting, 20 seconds per operation, 32 MiB per derived PDF, and 64 MiB total derived output. Previews are limited to 16 MiB. Existing parser bounds still apply.
- The **Test connection** button times out after 30 seconds.
- PDF pages sent as images are rendered at up to 2048 pixels on each side, with at most 64 MiB of images per document.
- PDF checking: at most 32 MiB per PDF, 16 MiB per decoded stream, 32 MiB of decoding work in total, 10,000 pages, and five seconds. Two PDFs are checked at once, and up to eight more can wait for up to five seconds. When that queue is full, uploads get `503 pdf_validation_capacity_unavailable`.
- Excel exports: at most 500 documents and 32 MiB of results, with two exports running at a time.

### Resources and cleanup

| Setting | Default | Meaning |
| --- | --- | --- |
| `LOCAL_CPU_LIMIT_RATIO` | `0.85` | CPU usage, as a fraction of the machine's capacity, above which the app slows down new work. |
| `LOCAL_MEMORY_LIMIT_RATIO` | `0.8` | Memory usage, as a fraction of the machine's RAM, above which the app slows down new work. |
| `MODEL_PREPARATION_MAX_BYTES` | 90% of the memory allowance | Memory set aside for preparing documents for the model. Can only be lowered. |
| `MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES` | 4 MiB (`4194304`) | Uploads at least this size are refused while the operating system reports low memory. |
| `LOCAL_DISK_RESERVE_BYTES` | 1 GiB (`1073741824`) | Free disk space to keep; uploads are refused below it. `0` turns this off. |
| `SOURCE_RETENTION_SWEEP_INTERVAL_MS` | 1 hour (`3600000`) | How often uploaded files that aren't kept as originals are cleaned up. |
| `FAILED_SOURCE_RETENTION_MS` | 7 days (`604800000`) | How long to keep the uploaded file of a failed job when originals aren't kept. `0` removes it at the next cleanup. |
| `SOURCE_STORAGE_PROVIDER` | `none` | Where to keep original documents: `none`, `local` or `s3`. See [Keep original documents](#keep-original-documents). |
| `SOURCE_ORIGINAL_RETENTION_ENABLED` | `true` when storage is set | Keep originals of new uploads. `false` stops keeping new ones without removing existing ones. |
| `SOURCE_STORAGE_S3_*` | — | S3 endpoint, region, bucket, prefix (default `document-extraction/`), path-style addressing, access key ID, secret access key and optional session token. |
| `LOCAL_SHUTDOWN_TIMEOUT_MS` | `10000` | How long to wait for work to finish when stopping. |
| `LOCAL_ANALYTICS_ENABLED` | `true` | Write privacy-filtered usage events to local files. Nothing is sent anywhere. |

Notes:

- Ratios must be above 0 and at most 1. Other values must be positive whole numbers, except the disk reserve and failed-file retention, which can be 0.
- With the default settings, the app may use up to 72% of the machine's RAM while preparing documents (90% of the 80% memory allowance). This is a budget, not a hard cap, and other programs, such as a local model server, need memory too. Lower these limits if you share the machine. `/v1/health` shows current usage.
- Unless originals are kept, uploaded files are removed once a job succeeds, and kept for the retention period when it fails. Job records, results, accounts, saved emails, and analytics are never cleaned up automatically. Delete old `mail/` and `analytics/` files yourself if you need to.

## Model settings are per Workspace

The AI model isn't configured here. Each Workspace's owner or admin sets its gateway URL, credential, and models in the app, under **Workspaces → Model gateway**. Until that's done, uploads to the Workspace are refused.

Once saved, the panel shows a summary; select **Edit** to change it. The **Models** table lists which model each use calls, with its declared capabilities (direct PDF input and structured output):

- **Extraction** runs Extraction jobs and Evaluations.
- **Document classification & splitting** chooses among tag-matching Templates and identifies PDF document boundaries, including targeted reassessments. It inherits Extraction unless you choose **Different model**, with its own direct PDF and structured-output settings. It shares the Workspace gateway, credential, and sequential-call policy. A failed custom model does not silently switch back to Extraction.
- **Template assistant** runs the Template assistant, its suggested requests, and Auto generate. It uses the extraction model unless you choose **Different model**, which calls another model on the same gateway, with the same credential and call behavior, and its own capabilities. **Test connection** checks each distinct model.

Model credentials are encrypted with `secrets/model-gateway.key` in the data folder, so keep that file with your backups. Workspace admins can point the model at any address, including private network ones, so only give that role to people you trust.

Choose model routes that support the document input you intend to send. Without Direct PDF input, each assessment sends the selected pages as images in one request. A provider may impose image-count, payload, context, or output limits below the application limits; the app does not automatically batch around them. A successful text-only connection test does not verify these capabilities. Configure a suitable Document classification & splitting model, or narrow the PDF page selection through the API when necessary.

These old global settings are ignored; the app lists any it finds when it starts: `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, `MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_SEQUENTIAL_CALLS`, `MODEL_SUPPORTS_PDF_INPUT`, `MODEL_SUPPORTS_STRUCTURED_OUTPUT`, and `MODEL_GATEWAY_USE_MANAGED_FILES`. Old global credentials aren't imported.

## Workspace document processing

Workspace owners and admins can change **Enable smart splitting** and **Exclude blank pages** under **Workspaces → Document processing**, immediately below Model gateway. Each toggle saves immediately and reports the outcome in a notification; a failed save restores the previous value. Both default to **off** for new and existing Workspaces and apply to every subsequent browser upload and API submission. Each accepted item captures its effective policy; changing settings does not alter already accepted work. There are no per-request or per-upload overrides.

Smart splitting applies to PDFs and identifies logical documents across their pages. Image uploads retain their ordinary one-document behavior. API clients can supply a PDF `pages` selection to limit the source pages before processing; browser uploads use all pages. Page selection does not override Workspace settings. With splitting disabled, the selected pages become one extraction job and no blank pages are removed. With splitting enabled, blank pages remain unless **Exclude blank pages** is also enabled. Nonblank cover pages are retained. When every selected page is independently verified blank and both settings are enabled, the packet completes as **No documents to extract**, with exclusion records and no child jobs.

Automatic template selection has no enable/disable setting. Supply an explicit Template ID or one or more Template tags. Without an ID, templates matching **any** supplied tag form the candidate pool; the classification model sees the document plus candidate IDs, names, and descriptions, never their field definitions or field guidance. An explicit ID wins and pins the same Template version for every child, while splitting still runs. With tags, each child selects independently after splitting. No matching candidates or unresolved ambiguity eventually requires manual selection without another upload.

Held packets and documents keep the working source needed for resolution even when completed-original retention is disabled. Child Documents own independent derived PDFs; deleting a child leaves its siblings and the packet original intact. Deleting a packet removes the whole group. Keeping a packet original means deleting a child does not redact those pages from that original.

The browser displays a single-page upload or an accepted one-document split as a normal Document with its own results, download, and export. Multi-document or unresolved packets retain the packet overview. Deleting a Document presented this way also deletes its hidden parent and original. The API still exposes a packet for every PDF accepted with splitting enabled, including one-child and all-blank outcomes.

The session-only settings endpoint is `GET|PUT /v1/workspaces/:workspaceId/document-processing-settings`. Members may read the effective settings; owners/admins may replace them with `{"enable_smart_splitting":true,"exclude_blank_pages":false}`. Workspace API keys cannot manage these settings. See the [packet API](../mkdocs/docs/api/overview.md#document-packets-and-review) for processing and last-resort resolution.
