# Start using the app

## Install and start

The easiest way to install is the one-line installer in the project README. It prints a launcher you use to start and stop the app:

```bash
~/.local/share/document-extraction/document-extraction start
```

To run from a source checkout instead, from the repository root:

```bash
bun install --frozen-lockfile
cp .env.example .env     # first time only
bun run migrate
bun run build
bun run start
```

Then open `http://127.0.0.1:8787`, or the address your installation printed.

## Create your account

Sign up with your name, email address, and password. A Google sign-in button appears only if the person running the app has set it up.

By default, new accounts can sign in straight away. If email verification has been switched on, you need to open a verification link first:

- If the app sends email through Cloudflare, the link is in your inbox.
- Otherwise, no email is sent. Installer users can see the link with the launcher's `mail` command, and source users can find it in `.local/mail/YYYY-MM-DD.jsonl`. Keep these links private; they give access to your account.

## Choose a Workspace

Everything you do happens inside a **Workspace**, which holds its own templates, documents, members, API keys, and model settings. A new account gets a personal Workspace with an example invoice template.

**Before you can upload documents, the Workspace needs a model.** The next page shows you how to set one up.

Next: [your first extraction](first-extraction.md).
