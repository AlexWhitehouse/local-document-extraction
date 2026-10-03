# Setup and maintenance

This guide covers everything after the quick install in the [README](../README.md): installer options, day-to-day commands, running from source, backups, updates, and troubleshooting.

- [Installing](#installing)
- [Everyday commands](#everyday-commands)
- [Running from source](#running-from-source)
- [Backing up and restoring](#backing-up-and-restoring)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

## Installing

### Supported systems

The installer supports **macOS** and **Linux distributions that use glibc** (most mainstream ones), on both Intel/AMD (x64) and ARM (arm64). It needs Bash, `curl`, `tar`, and `unzip`, and downloads its own copy of the Bun runtime.

It installs everything under your user account and never uses `sudo`. It does not install a system service, so the app won't start automatically at login.

### Where files go

The app keeps three kinds of files in separate folders:

| What | Default location | Change with |
| --- | --- | --- |
| The app itself, its runtime, and the launcher | `~/.local/share/document-extraction` | `--install-dir DIR` |
| Your settings (`config.env`) | `~/.config/document-extraction` | `--config-dir DIR` |
| Your data: accounts, documents, results, secrets | `~/.local/state/document-extraction` | `--state-dir DIR` |

If you set the `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, or `XDG_STATE_HOME` environment variables, the defaults follow them. Paths may contain spaces.

Keep these three folders separate. Running the installer again, or updating, keeps your existing settings and data.

### First-time setup questions

On a fresh install, the installer asks:

1. **Are you using a reverse proxy?** If yes, enter the address people will use in their browser, for example `https://documents.example.com`. The app still listens only on your machine; you set up the proxy yourself.
2. **Do you want Google sign-in?** If yes, enter your Google client ID and secret. The installer shows the redirect address to register with Google, then asks whether to keep email and password login as well.
3. **Do you want to send email through Cloudflare?** If yes, enter your Cloudflare account ID, API token, and sender details. Without it, account emails are saved on this machine instead of being sent (see [Transactional email](configuration.md#transactional-email)).
4. **Require new accounts to verify their email?** This question only appears if you set up Cloudflare email and kept email and password login.
5. **Keep original documents?** Answer `none` (the default) to keep only extraction results, `local` to keep originals in the data folder, or `s3` to keep them in an S3-compatible bucket. For S3, the installer asks for the bucket details, checks them with a small test file, and asks you to confirm the bucket doesn't use versioning or Object Lock. See [Keep original documents](configuration.md#keep-original-documents).

Press Enter to accept the default for each question. Google and Cloudflare are off by default. Secrets are hidden as you type, and nothing is saved until you have answered every question, so Ctrl+C cancels safely.

The installer does not check your Google or Cloudflare credentials. It does check S3 storage settings. Try signing in, or sending a password reset, afterwards to confirm they work.

To change your answers later, edit `config.env` and restart the app, or use `storage configure` for document storage. See [Configuration](configuration.md).

### Installer options

To pass options to the one-line installer, use `bash -s --`:

```bash
curl -fsSL https://github.com/AlexWhitehouse/local-document-extraction/releases/latest/download/install.sh | bash -s -- --no-start
```

Setup questions still use your terminal when the script is piped into Bash. You can also download `install.sh` from the [releases page](https://github.com/AlexWhitehouse/local-document-extraction/releases), review it, then run it with any of these options:

| Option | What it does |
| --- | --- |
| `--version vX.Y.Z` | Install a specific release instead of the latest one. |
| `--no-start` | Check that the app starts, then leave it stopped. |
| `--install-dir`, `--config-dir`, `--state-dir` | Use different folders (see [Where files go](#where-files-go)). |
| `--non-interactive` | Skip the setup questions and use the defaults from `.env.example`. This happens automatically when there is no terminal. |
| `--interactive` | Insist on asking the setup questions; fails without a terminal. |
| `--repo OWNER/REPO` | Install from a fork's releases. The fork must publish compatible release files. |
| `--archive PATH --sha256 HASH` | Install from a release archive you have already downloaded. |
| `--ref COMMIT --sha256 HASH` | Install directly from a commit's GitHub source archive. Use the full commit ID. |

For example:

```bash
bash install.sh --version v1.0.0 --no-start

bash install.sh --install-dir "$HOME/Applications/Document Extraction" \
  --config-dir "$HOME/.config/document-extraction" \
  --state-dir "$HOME/.local/state/document-extraction"
```

A few things to know:

- **Checksums.** `--sha256` confirms the archive hasn't changed, but only if the hash comes from a source you trust. A hash downloaded from the same place as a tampered archive proves nothing.
- **Forks.** `--repo` only changes where the app is downloaded from. It never changes where your documents are sent; only each Workspace's model settings control that.
- **Unattended installs.** To use custom settings without the questions, put a `config.env` in the config folder before running the installer.
- **What the installer does.** It downloads the release, installs dependencies, builds the web app, checks your settings, prepares the data folder, then starts the app and waits until it responds. If any step fails, the installer reports failure.

## Everyday commands

The installer prints the full path to the launcher. With the default location:

```bash
~/.local/share/document-extraction/document-extraction start
```

| Command | What it does |
| --- | --- |
| `start` | Start the app. |
| `stop` | Stop the app. |
| `status` | Show whether the app is running. |
| `doctor` | Check your settings and show installation details. |
| `mail` | Show verification and password-reset links saved on this machine (only when email isn't sent through Cloudflare). Keep this output private: the links give access to accounts. |
| `update [TAG]` | Update to the latest release, or to a specific one. See [Updating](#updating). |
| `storage configure` | Choose where original documents are kept, rotate S3 credentials, or stop keeping new originals. Stop the app first. See [Keep original documents](configuration.md#keep-original-documents). |

To type just `document-extraction start`, add the launcher folder to your `PATH` in the current terminal:

```bash
export PATH="${XDG_DATA_HOME:-$HOME/.local/share}/document-extraction:$PATH"
```

Add that line to your shell profile if you want it to stick.

Settings are read from `config.env` when the app starts, so restart after editing it. Only run one copy of the app against a data folder at a time, even on different ports.

## Running from source

Install the Bun version listed in [package.json](../package.json) (see the [Bun installation guide](https://bun.com/docs/installation)), then:

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

Then open http://127.0.0.1:8787. You don't need a model or API key to start the app, create accounts, or build templates. Each Workspace sets up its own model before it can extract documents.

A source checkout stores its settings in `.env` and its data in `.local/`.

For development with live reload, see [Contributing](../CONTRIBUTING.md#run-the-app-for-development).

## Backing up and restoring

A backup contains everything sensitive: accounts, sessions, documents, extracted results, account-action links, and the keys that decrypt saved model credentials. Store it somewhere private, **outside** the app and repository folders.

### Make a backup

1. Stop the app, and make sure nothing else is using the data folder.
2. Copy the whole data folder and your settings file.

For a default installer setup:

```bash
umask 077
backup="$HOME/document-extraction-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -R "${XDG_STATE_HOME:-$HOME/.local/state}/document-extraction" "$backup/state"
cp "${XDG_CONFIG_HOME:-$HOME/.config}/document-extraction/config.env" "$backup/config.env"
```

For a source checkout, copy `.local/` (or your custom data folder) and `.env` instead.

If you keep originals in S3, they are **not** in this backup: back up the bucket separately with your storage provider's tools. Originals kept with `local` storage are inside the data folder and are included.

Always copy the **whole** data folder. In particular, `data/better-auth-secret` and `secrets/model-gateway.key` must stay with the databases they belong to. Without them, sessions and saved model credentials can't be read. Exporting a Workspace's jobs is not a backup.

### Restore a backup

1. Stop the app.
2. Move the current data folder somewhere safe, in case you need it.
3. Copy the complete backup into the data folder, and restore the matching settings file.
4. Start the same app version the backup was made with, or a newer one.

Don't mix individual database files from different backups. An older app version may not be able to read a database that a newer version has upgraded, so to downgrade, restore a backup taken before the upgrade. If you are moving to another machine, check the address settings in `config.env`.

## Updating

### Installer setup

1. Stop the app and make a backup.
2. Run `document-extraction update` for the latest release, or `document-extraction update v1.0.0` for a specific one. Alternatively, rerun the installer with `--version` and the same folder options you used originally.
3. Run `status` and open the app to check it works.

The update refuses to run while the app is running. It keeps your settings and data and makes an automatic backup under `backups/before-*` inside the app folder before upgrading the database. Copy anything important out of there before removing the app. Keeping the old app files alone is not enough to downgrade.

**If an update fails partway**, the launcher writes `upgrade-incomplete.json` and refuses to `start` or `doctor` the old version until you resolve it. Either fix the problem and run the update again, or stop the app and restore the automatic backup listed in that file. Don't delete the file to get around the check: the database may already be upgraded.

### Source checkout

1. Stop the app and back up outside the checkout.
2. Check out the tag or commit you want.
3. Run `bun install --frozen-lockfile`, `bun backend/src/checkConfiguration.ts`, `bun run migrate`, and `bun run build`.
4. Start the app.

Read the release notes before each update. Never run `git clean -xfd` in a checkout that contains `.local/` or `.env`.

### Upgrading from the early source-only versions

- Google sign-in now has to be switched on explicitly with `AUTH_GOOGLE_ENABLED=true`.
- Set your own `BETTER_AUTH_URL` and any extra trusted origins; no maintainer address is trusted by default.
- Invalid settings (bad true/false values, half-filled credential pairs, inconsistent limits) now stop the app from starting instead of being ignored.

## Uninstalling

1. Stop the app.
2. Delete the app folder (`~/.local/share/document-extraction` by default) and any shortcut you made.

Your settings and data folders are left alone, so you can reinstall later and pick up where you left off. Deleting them permanently removes all accounts and documents, so back them up first if you might need them.

For a source checkout, move `.local/` and `.env` somewhere safe before deleting the checkout.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No verification email arrives | Email verification is off by default. Without Cloudflare, emails aren't sent: read the links with the launcher's `mail` command or in the server log. |
| Email or Google sign-in links open the wrong address | Set `BETTER_AUTH_URL` to the address you open in your browser, including the port, then request a new link. |
| There is no Google sign-in button | Set `AUTH_GOOGLE_ENABLED=true`, provide both Google credentials, and restart. |
| Nobody can create an account | Check `AUTH_SIGNUP_ENABLED`. Create the accounts you need before turning signup off. |
| Port already in use | Stop the other copy of the app, or choose a different `PORT` and update any addresses that include it. |
| "Frontend build not found" | Run `bun run build`, or check `DOCUMENT_EXTRACTION_ASSETS_DIR`. |
| "Workspace model not configured" | Open that Workspace's **Model gateway** settings. Old global model environment variables no longer apply. |
| Saved model credentials can't be read | Restore the matching `secrets/model-gateway.key` from a backup, or enter the credential again in the Workspace settings. |
| Upload rejected as too large | Check `MAX_SOURCE_FILE_BYTES` and the related limits in [Configuration](configuration.md#uploads-and-extraction), plus any reverse proxy's upload limit. |
| Uploads rejected as busy, or documents fail during preparation | Check free memory and disk space, other heavy programs such as a local model server, and very large PDFs. `/v1/health` shows the app's resource use. |
| Cloudflare email isn't delivered | Check the sending domain setup, API token permissions, sender address, and Cloudflare's delivery logs. |

When asking for help, include the app version, your operating system and chip type, the command you ran, and the error code. Remove anything private first. Never share `.env`, `config.env`, your data folder, saved mail, model credentials, or real documents.
