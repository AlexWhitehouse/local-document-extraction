# Setup and maintenance

This guide follows the quick installation in the [README](../README.md). It covers installer options, daily commands, source checkouts, backups, updates, and fault correction.

- [Installing](#installing)
- [Everyday commands](#everyday-commands)
- [Running from source](#running-from-source)
- [Backing up and restoring](#backing-up-and-restoring)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

## Installing

### Supported systems

The installer supports **macOS** and **Linux distributions that use glibc**, including most common Linux distributions. Supported processors are Intel/AMD (x64) and ARM (arm64). Installation requires Bash, `curl`, `tar`, and `unzip`. The installer downloads its own Bun runtime. Release archives include the Go document processor and its PDFium renderer; a Go compiler is not needed for release installations. Source builds download a pinned, checksum-verified PDFium library once.

The installer uses your user account. It does not use `sudo` or install a system service. The app does not start automatically at login.

### Where files go

The app separates application files, settings, and data:

| What | Default location | Change with |
| --- | --- | --- |
| App, runtime, and launcher | `~/.local/share/document-extraction` | `--install-dir DIR` |
| Settings (`config.env`) | `~/.config/document-extraction` | `--config-dir DIR` |
| Accounts, documents, results, and secrets | `~/.local/state/document-extraction` | `--state-dir DIR` |

If set, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME` determine the corresponding defaults. Paths can contain spaces.

Keep these three folders separate. Repeated installation and updates preserve existing settings and data.

### First-time setup questions

A new installation asks these questions:

1. **Are you using a reverse proxy?** If yes, enter the browser address, such as `https://documents.example.com`. The app still listens only on your machine. Configure the proxy separately.
2. **Do you want Google sign-in?** If yes, enter the Google client ID and secret. The installer shows the redirect address to register with Google. It then asks whether to keep email and password login.
3. **Do you want to send email through Cloudflare?** If yes, enter the Cloudflare account ID, API token, and sender details. Otherwise, the app saves account email locally without sending it. See [Transactional email](configuration.md#transactional-email).
4. **Require new accounts to verify their email?** This question appears only with Cloudflare email and email/password login enabled.
5. **Keep original documents?** Select `none` (default) for extraction results only, `local` for the data folder, or `s3` for an S3-compatible bucket. For S3, enter the bucket details. The installer tests storage with a small file. Confirm that the bucket has no versioning or Object Lock. See [Keep original documents](configuration.md#keep-original-documents).

Press Enter to accept each default. Google and Cloudflare default to off. The installer hides secrets as you type. It saves answers only after all questions are complete. Ctrl+C cancels without saving answers.

The installer tests S3 settings. It does not validate Google or Cloudflare credentials. After installation, try sign-in or password reset to verify those services.

To change settings later, edit `config.env`. Then restart the app. For document storage, use `storage configure`. See [Configuration](configuration.md).

### Installer options

To pass options through the installation pipe, use `bash -s --`:

```bash
curl -fsSL https://github.com/AlexWhitehouse/local-document-extraction/releases/latest/download/install.sh | bash -s -- --no-start
```

Setup questions still use the terminal when the script is piped into Bash. You can also download `install.sh` from the [releases page](https://github.com/AlexWhitehouse/local-document-extraction/releases). Review the script before running it with these options:

| Option | Function |
| --- | --- |
| `--version vX.Y.Z` | Install the specified release instead of the latest release. |
| `--no-start` | Verify startup, then leave the app stopped. |
| `--install-dir`, `--config-dir`, `--state-dir` | Use different folders. See [Where files go](#where-files-go). |
| `--non-interactive` | Skip questions and use `.env.example` defaults. This is automatic when no terminal is available. |
| `--interactive` | Require setup questions. Installation fails without a terminal. |
| `--repo OWNER/REPO` | Install from a fork with compatible release files. |
| `--archive PATH --sha256 HASH` | Install from a downloaded release archive. |
| `--ref COMMIT --sha256 HASH` | Install from a commit's GitHub source archive. Supply the complete commit ID. |

Examples:

```bash
bash install.sh --version v1.0.0 --no-start

bash install.sh --install-dir "$HOME/Applications/Document Extraction" \
  --config-dir "$HOME/.config/document-extraction" \
  --state-dir "$HOME/.local/state/document-extraction"
```

Additional installation information:

- **Checksums.** `--sha256` verifies that the archive matches a trusted hash. A hash from the same compromised source as the archive does not prove safety.
- **Forks.** `--repo` changes the application download source. Workspace model settings still determine where documents are sent.
- **Unattended installs.** Before installation, place a prepared `config.env` in the configuration folder to use custom settings without questions.
- **What the installer does.** It downloads the release, installs dependencies, and builds the web app. It validates settings and prepares the data folder. It then starts the app and waits for a response. Failure at any step produces an installation error.

## Everyday commands

The installer prints the full launcher path. At the default location, start the app with:

```bash
~/.local/share/document-extraction/document-extraction start
```

| Command | Function |
| --- | --- |
| `start` | Start the app. |
| `stop` | Stop the app. |
| `status` | Show whether the app is running. |
| `doctor` | Validate settings and display installation details. |
| `mail` | Display locally saved verification and password-reset links when Cloudflare delivery is disabled. Keep this output private. These links provide account access. |
| `update [TAG]` | Install the latest or specified release. See [Updating](#updating). |
| `storage configure` | Select original storage, replace S3 credentials, or disable new retention. Stop the app first. See [Keep original documents](configuration.md#keep-original-documents). |

To use `document-extraction start` without the full path, add the launcher folder to `PATH`:

```bash
export PATH="${XDG_DATA_HOME:-$HOME/.local/share}/document-extraction:$PATH"
```

For future terminals, add this line to your shell profile.

The app reads `config.env` at startup. Restart after edits. Run only one app instance against a data folder, even when instances use different ports.

## Running from source

Install the Bun version in [package.json](../package.json) and Go matching [backend-go/go.mod](../backend-go/go.mod). See the [Bun installation guide](https://bun.com/docs/installation). Then run:

```bash
git clone https://github.com/AlexWhitehouse/local-document-extraction.git
cd local-document-extraction
bun install --frozen-lockfile
cp .env.example .env          # first time only; don't overwrite it later
bun backend/src/checkConfiguration.ts
bun run migrate
bun run build
bun run start
```

Open http://127.0.0.1:8787. Startup, account creation, and Template editing do not require a model or API key. Each Workspace requires a configured model before extraction.

Source checkouts store settings in `.env` and data in `.local/`. For development with live reload, see [Contributing](../CONTRIBUTING.md#run-the-app-for-development).

## Backing up and restoring

Backups contain accounts, sessions, documents, results, account-action links, and keys for saved model credentials. Store backups privately, **outside** the app and repository folders.

### Make a backup

1. Stop the app.
2. Make sure no other process uses the data folder.
3. Copy the complete data folder and settings file.

For a default installation:

```bash
umask 077
backup="$HOME/document-extraction-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -R "${XDG_STATE_HOME:-$HOME/.local/state}/document-extraction" "$backup/state"
cp "${XDG_CONFIG_HOME:-$HOME/.config}/document-extraction/config.env" "$backup/config.env"
```

For a source checkout, copy `.local/` or the custom data folder, and `.env`.

S3 originals are **not** part of this backup. Back up the bucket separately with the provider's tools. Local originals are inside the data folder and are included.

Copy the **whole** data folder. Keep `data/better-auth-secret` and `secrets/model-gateway.key` with their matching databases. Without these files, sessions and saved model credentials cannot be read. Exported Workspace jobs are not a backup.

### Restore a backup

1. Stop the app.
2. Move the current data folder to a safe location.
3. Copy the complete backup into the data folder.
4. Restore the matching settings file.
5. Start the app version used for the backup, or a newer version.

Do not combine database files from different backups. An older app might not read a database upgraded by a newer version. Before a downgrade, restore a backup from before the upgrade. If moving to another machine, verify the address settings in `config.env`.

## Updating

### Installer setup

1. Stop the app.
2. Make a backup.
3. Run `document-extraction update` for the latest release, or `document-extraction update v1.0.0` for that release. Alternatively, rerun the installer with `--version` and the original folder options.
4. Run `status`.
5. Open the app and verify operation.

Updates refuse to run while the app is running. They preserve settings and data. Before database migration, they create a backup under `backups/before-*` in the app folder. Before removing the app, copy required backups elsewhere. Old app files alone do not permit a downgrade.

**If an update fails partway**, the launcher writes `upgrade-incomplete.json`. It blocks `start` and `doctor` for the old version until recovery. Correct the problem and rerun the update. Alternatively, stop the app and restore the automatic backup identified in that file. Do not delete the file to bypass recovery. The database might already be upgraded.

### Source checkout

1. Stop the app.
2. Make a backup outside the checkout.
3. Check out the required tag or commit.
4. Run `bun install --frozen-lockfile`.
5. Run `bun backend/src/checkConfiguration.ts`.
6. Run `bun run migrate`.
7. Run `bun run build`.
8. Start the app.

Before each update, read its release notes. Never run `git clean -xfd` in a checkout that contains `.local/` or `.env`.

### Upgrading from the early source-only versions

- Enable Google sign-in explicitly with `AUTH_GOOGLE_ENABLED=true`.
- Set `BETTER_AUTH_URL` and any additional trusted origins. No maintainer address is trusted by default.
- Invalid settings now stop startup. Examples include invalid booleans, incomplete credential pairs, and inconsistent limits. The app no longer ignores them.

## Uninstalling

1. Stop the app.
2. Delete the app folder, which defaults to `~/.local/share/document-extraction`.
3. Delete any shortcut you created.

Settings and data folders remain available for reinstallation. Deleting them permanently removes accounts and documents. If required, back them up before deletion.

Before deleting a source checkout, move `.local/` and `.env` to a safe location.

## Troubleshooting

| Problem | Action |
| --- | --- |
| No verification email | Verification is disabled by default. Without Cloudflare, read saved links with the launcher's `mail` command or server log. |
| Email or Google links use the wrong address | Set `BETTER_AUTH_URL` to the browser address, including its port. Then request a new link. |
| No Google sign-in button | Set `AUTH_GOOGLE_ENABLED=true`. Supply both Google credentials. Restart the app. |
| Account creation fails | Verify `AUTH_SIGNUP_ENABLED`. Create required accounts before disabling signup. |
| Port is already in use | Stop the other app instance, or select another `PORT`. Update addresses that include the port. |
| "Frontend build not found" | Run `bun run build`, or verify `DOCUMENT_EXTRACTION_ASSETS_DIR`. |
| "Workspace model not configured" | Open the Workspace's **Model gateway** settings. Global model environment variables no longer apply. |
| Saved model credentials cannot be read | Restore the matching `secrets/model-gateway.key`, or enter the credential again in Workspace settings. |
| Upload is too large | Verify `MAX_SOURCE_FILE_BYTES`, related [limits](configuration.md#uploads-and-extraction), and the proxy upload limit. |
| Uploads report busy or preparation fails | Inspect free memory, free disk space, other large processes, and PDF size. `/v1/health` shows resource use. |
| Cloudflare email fails | Verify the sending domain, token permissions, sender address, and Cloudflare delivery logs. |

For support, include the app version, operating system, processor type, command, and error code. Remove private information first. Never share `.env`, `config.env`, data folders, saved mail, model credentials, or real documents.
