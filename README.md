# Document Extraction

Turn PDFs and images into structured data using your choice of an OpenAI-compatible model gateway. Document Extraction runs on your own machine: define reusable templates, upload documents, review extracted fields and evidence, and export results to Excel.

- **Reusable templates:** typed fields, extraction instructions, and table-shaped results.
- **Workspaces:** separate templates, documents, model settings, members, and API keys.
- **Background processing:** queued jobs, bounded retries, live progress, and restart recovery.
- **Browser and API access:** a React interface and a Workspace-scoped HTTP API.
- **Local storage:** SQLite databases and source files under a directory you control.

The app runs locally; document input is sent to the model gateway you configure. A local model server can keep inference on your machine. A remote gateway receives the document and extraction instructions. Model accuracy, availability, and charges depend on that provider.

## Install on macOS or Linux

The installer targets macOS and Linux with glibc, on x64 or arm64. It needs Bash, `curl`, `tar`, and `unzip`; it installs an application-owned copy of the pinned Bun runtime when needed. No sudo, Node.js, database server, Cloudflare account, or Google account is required for the default local setup. See [release qualification](docs/releasing.md) for the distinction between target platforms and completed testing.

**Before the first GitHub release is published, use the source setup below.** Once release assets are available, this single command downloads the installer completely before running it:

```bash
(installer=$(mktemp) && trap 'rm -f "$installer"' EXIT && curl -fsSL https://github.com/AlexWhitehouse/local-document-extraction/releases/latest/download/install.sh -o "$installer" && bash "$installer")
```

To inspect it first, download `install.sh` from the [release page](https://github.com/AlexWhitehouse/local-document-extraction/releases), read it, and run `bash install.sh`. Pass `--version TAG` to select a release, `--no-start` to leave the application stopped after its startup check, or `--repo OWNER/REPO` to use a fork's release assets. Directory overrides and offline archive installation are described in [setup and maintenance](docs/setup.md).

The installer prints the application URL and launcher path. With default paths:

```bash
~/.local/share/document-extraction/document-extraction status
~/.local/share/document-extraction/document-extraction start
~/.local/share/document-extraction/document-extraction stop
```

The installer does not edit your shell profile or add a global command. To use the short `document-extraction` command in the current terminal:

```bash
export PATH="${XDG_DATA_HOME:-$HOME/.local/share}/document-extraction:$PATH"
```

Open **http://127.0.0.1:8787**. The process runs as your user and listens only on your machine by default. It does not install a system service or start automatically after a reboot.

### Run from source

Install the Bun version declared in [package.json](package.json) using the [Bun installation guide](https://bun.com/docs/installation), then:

```bash
git clone https://github.com/AlexWhitehouse/local-document-extraction.git
cd local-document-extraction
bun install --frozen-lockfile
cp .env.example .env
bun run migrate
bun run build
bun run start
```

The default configuration requires no secrets. Run these commands from the repository root. Press `Ctrl+C` to stop. Source installations keep state in `.local/` unless `DOCUMENT_EXTRACTION_STATE_DIR` is set.

## Your first extraction

1. Create an account. By default, verification email is **captured locally**, not delivered to an inbox. Open the verification URL printed in the server log. Installer users can run `document-extraction mail` using the launcher path above; source users can read `.local/mail/YYYY-MM-DD.jsonl`. Treat these links as credentials.
2. Open **Workspaces → Model gateway → Set up**. Enter your gateway base URL, model name, and gateway credential. A Workspace starts unconfigured; no maintainer endpoint or model is inherited.
3. Enable direct PDF input or structured output only when your model supports it. Otherwise PDFs are rendered as images; use a model that supports image input. The optional connection test sends a short text prompt and does not certify those capabilities.
4. Choose the starter invoice template or create a template with the fields you want.
5. Upload a PNG, JPEG, WebP, or PDF, up to **10 MiB by default**. Follow progress in **Documents**, review completed results, and export selected jobs to Excel.

The outbound gateway credential is different from a Workspace API key. API keys are generated in Workspace settings for external clients; they do not configure the extraction model. See the [API overview](mkdocs/docs/api/overview.md) and [Postman collection](postman/local-api.postman_collection.json).

## Configure your installation

Edit `.env` for source setup or the installer-created `config.env`, then restart. The [complete configuration reference](docs/configuration.md) covers every application setting, defaults, validation, and examples.

| Need | Settings |
| --- | --- |
| Change address or port | `HOST`, `PORT`, `BETTER_AUTH_URL` |
| Enable Google sign-in | `AUTH_GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Control registration/password login | `AUTH_SIGNUP_ENABLED`, `AUTH_EMAIL_PASSWORD_ENABLED`, `AUTH_REQUIRE_EMAIL_VERIFICATION` |
| Deliver email through Cloudflare | `EMAIL_PROVIDER`, sender settings, Cloudflare account ID and API token |
| Accept larger files | `MAX_SOURCE_FILE_BYTES`, `SUBMISSION_MAX_RESERVED_BYTES` |
| Limit CPU/memory/concurrency | `LOCAL_CPU_LIMIT_RATIO`, `LOCAL_MEMORY_LIMIT_RATIO`, extraction and submission limits |
| Choose storage or disable local analytics | `DOCUMENT_EXTRACTION_STATE_DIR`, `LOCAL_ANALYTICS_ENABLED` |

Optional SSO currently means **Google OAuth**. Generic OIDC and SAML are not implemented. A Google-only deployment can disable email/password login after Google is configured. Keep registration enabled until the accounts you need exist. [Google and Cloudflare setup](docs/configuration.md#google-sign-in) includes callback URLs and provider requirements.

Gateway URL, model, credentials, and capability switches belong to each Workspace in the UI. Old global model environment variables are ignored. Authentication and credential-encryption secrets are generated per installation and stored with the local state.

## Data, backups, and updates

Installer defaults on both macOS and Linux:

| Purpose | Default location |
| --- | --- |
| Application and launcher | `~/.local/share/document-extraction/` |
| Configuration | `~/.config/document-extraction/config.env` |
| Databases, secrets, sources, captured mail, analytics | `~/.local/state/document-extraction/` |

The corresponding `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME` values override these defaults. Installer options can choose explicit directories.

Stop the application before copying a complete state backup **outside the checkout**. Back up configuration separately, restrict access to both, and keep database files with their matching authentication and encryption secrets. A database-only copy cannot recover encrypted gateway credentials. See [backup, restore, and update instructions](docs/setup.md#backup-and-restore).

Completed source binaries are deleted after successful cleanup; failed source binaries are retained for seven days by default. Templates, results, and job records remain until deleted. Local mail and analytics files persist until you remove them. Browser sessions may cache completed results; signing out clears application session/workspace caches. Cloudflare receives transactional email content only when explicitly enabled. Local analytics do not send remote telemetry.

## Development

This is a Bun workspace with `backend/` (Bun server, SQLite, auth, extraction) and `frontend/` (Vite and React). The Bun server serves the built frontend and API together.

```bash
bun run dev             # Backend reload
bun run dev:frontend    # Vite, in another terminal
bun run typecheck
bun run lint
bun run test
bun run build
```

See [contribution guidance](CONTRIBUTING.md), [backend details](backend/README.md), [testing strategy](docs/testing-strategy.md), and [security reporting](SECURITY.md).

## License and release status

Licensed under the [MIT License](LICENSE). You may use, modify, redistribute, and sell the software, including in proprietary projects, provided you retain the copyright and license notices. Third-party dependencies retain their own licenses.

The installer download command becomes available after the first GitHub release is published. See the [release checklist](docs/releasing.md) for qualification evidence and publication steps.
