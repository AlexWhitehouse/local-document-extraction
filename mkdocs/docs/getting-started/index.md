# Start using the app

## Install and start

Run the installer command in the project README. The installer prints the launcher path. Use the launcher to start and stop the app:

```bash
~/.local/share/document-extraction/document-extraction start
```

For a source checkout, run these commands from the repository root:

```bash
bun install --frozen-lockfile
cp .env.example .env     # first time only
bun run migrate
bun run build
bun run start
```

Open `http://127.0.0.1:8787` or the address printed by your installation.

## Create your account

Sign up with your name, email address, and password. Google sign-in appears only when the operator enables it.

By default, new accounts can sign in immediately. If the operator requires email verification, open the verification link first:

- With Cloudflare email delivery, find the link in your inbox.
- With local email, use the launcher’s `mail` command or read `.local/mail/YYYY-MM-DD.jsonl` in a source installation.

Local email does not send messages. Keep verification links private because they give access to your account.

## Choose a Workspace

A **Workspace** holds its own templates, documents, members, API keys, and model settings. All work occurs within a Workspace. Each new account receives a personal Workspace with an example invoice template.

**Configure a Workspace model before you upload documents.** The next guide gives the procedure.

Continue with [your first extraction](first-extraction.md).
