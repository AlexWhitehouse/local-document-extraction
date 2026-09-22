# Start Using The App

Document Extraction runs as one local Bun server with a browser UI. The repository README provides the release installer, source setup, and platform qualification details. Start the installed application using its printed `document-extraction start` launcher, or use the source commands below from the repository root.

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run migrate
bun run build
bun run start
```

Copy `.env.example` only on first setup. Open `http://127.0.0.1:8787`, or the URL printed by your installation.

By default, create an email/password account and open the verification URL printed in the server log. Local mode does not send mail to your inbox. Installer users can run the launcher's `mail` command; source users can read `.local/mail/YYYY-MM-DD.jsonl`. Keep these account links private. If the operator enabled Cloudflare delivery, use the message in your inbox instead. Google sign-in appears only when explicitly configured.

After signing in, select or create a Workspace. Each Workspace owns its Templates, Documents, Extraction jobs, memberships, API keys, and model configuration. **Configure its Model gateway before uploading a Document.**

Use [First Extraction](first-extraction.md) to create a Template and submit a Document.
