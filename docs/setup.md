# Setup and maintenance

## Installer layout and options

The release installer targets macOS and glibc-based Linux, x64 and arm64. It uses Bash, curl, tar, and unzip. Dependencies include native canvas support; a successful JavaScript build alone is not enough to qualify a new platform. [Release qualification](releasing.md) records the required checks.

Installation is user-owned and does not use sudo. The default directories are the same on macOS and Linux:

| Purpose | Default | Override |
| --- | --- | --- |
| Releases, Bun, launcher | `${XDG_DATA_HOME:-$HOME/.local/share}/document-extraction` | `--install-dir DIR` |
| Private `config.env` | `${XDG_CONFIG_HOME:-$HOME/.config}/document-extraction` | `--config-dir DIR` |
| Persistent state | `${XDG_STATE_HOME:-$HOME/.local/state}/document-extraction` | `--state-dir DIR` |

Paths may contain spaces. Keep application, configuration, and state directories separate. Do not place secrets or state inside a versioned release directory. The installer retains existing configuration and state on repeat installation.

Download `install.sh` from the chosen repository's release assets. Review it, then:

```bash
bash install.sh --no-start
bash install.sh --version vX.Y.Z
bash install.sh --repo your-account/your-fork --version vX.Y.Z
bash install.sh --install-dir "$HOME/Applications/Document Extraction" \
  --config-dir "$HOME/.config/document-extraction" \
  --state-dir "$HOME/.local/state/document-extraction"
```

Replace `vX.Y.Z` with an existing release tag. Omit `--version` for the latest published release. Forks need to publish compatible release assets; `--repo` never changes where document data is sent. Only per-Workspace gateway settings do that.

For a downloaded source release archive:

```bash
bash install.sh --archive /path/to/release.tar.gz --sha256 EXPECTED_SHA256 --no-start
```

An explicit source bootstrap can use `--ref COMMIT --sha256 EXPECTED_SHA256`; use the full commit and the SHA-256 of its exact GitHub source archive. Obtain hashes from a source you trust. A checksum detects a different archive, but an archive and checksum from the same compromised source are not independent authenticity checks. Offline archive mode still needs cached dependencies and a suitable Bun runtime, or network access to obtain them.

The installer stages a release, installs frozen dependencies, builds assets, validates configuration, and initializes state. It starts the app and waits for health and SPA readiness. `--no-start` stops it again after this check. Failure is reported as failure, not as a successful installation.

## Launcher

Use the absolute launcher path printed by the installer. For default paths:

```bash
~/.local/share/document-extraction/document-extraction start
~/.local/share/document-extraction/document-extraction status
~/.local/share/document-extraction/document-extraction doctor
~/.local/share/document-extraction/document-extraction mail
~/.local/share/document-extraction/document-extraction stop
```

`mail` displays locally captured account action links; keep its output private. It is not a mail inbox for Cloudflare mode. `doctor` validates configuration and reports installation details. The installer does not install a system service or arrange login/reboot startup.

No global command or shell-profile edit is installed. For the short commands used below, add the launcher directory to the current terminal's PATH, or continue using its absolute path:

```bash
export PATH="${XDG_DATA_HOME:-$HOME/.local/share}/document-extraction:$PATH"
```

For a custom install directory, use that directory instead. This affects only the current shell unless you choose to add it to your own shell profile.

Configuration is loaded from `config.env`. Edit it and stop/start the process to apply changes. See [configuration](configuration.md) for optional Google login, Cloudflare email, custom ports, data locations, and limits. Start only one server against a state directory; another process may own its databases or queued work even if it listens on a different port.

## Source checkout

Use the Bun version in root `package.json`. From the repository root:

```bash
bun install --frozen-lockfile
cp .env.example .env
bun backend/src/checkConfiguration.ts
bun run migrate
bun run build
bun run start
```

Copy `.env.example` only on first setup; do not overwrite your existing `.env` during updates. No private endpoint or API key is required to start, create accounts, or manage templates. Extraction requires each Workspace to configure its own gateway/model/credential.

For development, run `bun run dev` and `bun run dev:frontend` in separate terminals. Add `http://127.0.0.1:5173` or the actual Vite origin to `AUTH_TRUSTED_ORIGINS`. The Vite proxy follows root `.env`'s `PORT`, or an explicit `DEV_API_ORIGIN`.

## Backup and restore

Stop the app and ensure no server is using the state directory before copying databases. Store backups **outside the repository and release directories**. Backups contain accounts, active-session data, captured action links, documents, extracted answers, and decryptable credentials.

For default installer paths, after stopping:

```bash
umask 077
document_extraction_backup="$HOME/document-extraction-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$document_extraction_backup"
cp -R "${XDG_STATE_HOME:-$HOME/.local/state}/document-extraction" "$document_extraction_backup/state"
cp "${XDG_CONFIG_HOME:-$HOME/.config}/document-extraction/config.env" "$document_extraction_backup/config.env"
```

For source setup, copy `.local/` (or your configured state path) into that external backup directory and copy `.env` privately. Preserve all of `data/`, `secrets/`, and any retained source files. In particular, keep `data/better-auth-secret` and `secrets/model-gateway.key` alongside the matching databases. A Workspace export is not a full application backup.

Restore with the app stopped: preserve the current state separately, copy the complete backup into the intended state directory, restore the matching private configuration, and start a compatible application version. Recheck path/origin settings if moving machines. Do not merge individual SQLite files from different backups. Never assume an older release can read a migrated database; restore a matching pre-upgrade backup when a downgrade is necessary.

## Updates

For an installer-managed application:

1. Stop it with the launcher and make an external backup.
2. Run `document-extraction update` (latest release) or `document-extraction update TAG` with the same launcher, or rerun the installer with the desired `--version TAG` and original directory options.
3. Check `status` and open the UI. Start it if you chose `--no-start`.

The installer refuses to upgrade a running managed process. It stages the new release, preserves the private configuration/state, and keeps a pre-migration state backup. It does not promise automatic database rollback. Retaining old application files alone is not enough to downgrade safely.

Automatic pre-migration backups live under the application directory at `backups/before-*`; copy important backups elsewhere before removing the application. If migration or subsequent startup fails, `upgrade-incomplete.json` records the candidate, state, and backup paths. The launcher refuses `start`/`doctor` against the previous release while that marker exists. Resolve the failure and rerun installation, or deliberately restore the matching pre-migration state/configuration with the app stopped. Do not delete the marker to bypass a database-version mismatch.

For source checkouts: stop, back up outside the checkout, select the intended tag/commit, run `bun install --frozen-lockfile`, validate config, run `bun run migrate`, build, and start. Read release notes before every update. Do not run `git clean -xfd` on a checkout containing local data or secrets.

## Uninstall

Stop the app first. Remove the installer-managed application directory and any launcher shortcut you created. Leave the separate configuration and state directories in place to preserve your accounts and documents for reinstalling later. Deleting those directories is a separate, irreversible data-removal choice; back them up first if you may need them.

For a source checkout, keep or move `.local/` and `.env` before deleting the checkout. The installer does not register a system service to remove.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No verification email in your inbox | `EMAIL_PROVIDER=local` captures links; use `mail` or the private server log. Cloudflare requires its separate configuration. |
| Verification/OAuth link opens the wrong site | Set `BETTER_AUTH_URL` to the browser-facing origin, including the chosen port, and request a fresh link. |
| Google button is absent | Enable `AUTH_GOOGLE_ENABLED` and supply both credentials; restart. |
| Registration is unavailable | Check `AUTH_SIGNUP_ENABLED`; create initial accounts before disabling signup. |
| Port already in use | Stop the existing application or choose a different `PORT`; update explicit auth and development origins too. |
| Frontend build not found | Run `bun run build`, or check `DOCUMENT_EXTRACTION_ASSETS_DIR`. |
| Workspace model not configured | Open that Workspace's Model gateway settings; global model environment variables do not configure it. |
| Saved model credentials unavailable | Restore the matching machine secret, or enter a replacement credential in Workspace settings. |
| Upload too large | Check `MAX_SOURCE_FILE_BYTES`, the submission budget, JSON limits, and any reverse proxy's body limit. |
| Admission busy or preparation rejected | Check RAM/disk availability, competing model processes, PDF expansion, and `/v1/health` diagnostics. |
| External email fails | Verify domain onboarding, account entitlement, token scope, sender identity, and provider logs. |

Support reports should contain versions, OS/architecture, the command used, and redacted error codes. Do not attach `.env`, `config.env`, local state, captured mail, gateway credentials, or real documents.
