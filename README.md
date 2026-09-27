# Document Extraction

**Turn PDFs and images into structured data for your applications and automated workflows.**

Define the fields you need with reusable templates for invoices, receipts, or your own documents. Submit documents and retrieve extracted data programmatically through the API to connect document extraction to your existing systems. Use the browser to manage templates, upload documents, and review results, with Excel export available when you need a spreadsheet.

The app runs on your computer. You connect the AI model that reads your documents, using an OpenAI-compatible service or local model server. Documents are sent to whichever service you choose.

[Install](#install) · [Your first extraction](#your-first-extraction) · [Automate with the API](#automate-with-the-api) · [Releases](https://github.com/AlexWhitehouse/local-document-extraction/releases)

## Install

For **macOS or Linux** (glibc), on Intel/AMD or ARM. You’ll need Bash, `curl`, `tar`, and `unzip`; the installer handles the app and its runtime.

Paste this into your terminal:

```bash
(
  installer=$(mktemp) &&
  trap 'rm -f "$installer"' EXIT &&
  curl -fsSL https://github.com/AlexWhitehouse/local-document-extraction/releases/latest/download/install.sh -o "$installer" &&
  bash "$installer"
)
```

First-time setup asks about a reverse proxy, Google sign-in, and Cloudflare email. Press Enter at each question for a local installation with email/password login. Secrets stay hidden while typing, and updates keep your settings.

When it finishes, open **[http://127.0.0.1:8787](http://127.0.0.1:8787)**, or your public URL if you configured a reverse proxy.

## Your first extraction

1. **Create your account.** Sign up with your name, email address, and password, or use Google if enabled. If you enabled signup verification, follow the emailed link.

2. **Connect your AI model.** Open **Workspaces → Model gateway → Set up**. Enter your service’s **Gateway URL**, **Model name**, and **Gateway API key**, then click **Save configuration**. Choose a model that supports image input; you can leave the other options at their defaults.

3. **Upload a document.** Click **Upload**, choose the **Example Invoice** template, and add an invoice PDF or image. For other documents, create a template in **Templates** with the fields you want to extract. Supported files are PDF, PNG, JPEG, and WebP, up to 10 MiB each by default.

4. **Review the results.** Follow progress in **Documents**, then open a completed document to review its extracted fields. You can retrieve results through the API or select completed documents and click **Export** to download an Excel spreadsheet.

## Automate with the API

After configuring your Workspace and creating a template, generate a Workspace API key in the app. Use it to submit documents with `POST /v1/extract`, then poll `GET /v1/jobs/{job_id}` to track progress and retrieve the extracted fields when the job completes. This lets scripts and applications send documents and use the results as part of an automated workflow.

See the [API specification](mkdocs/docs/api/overview.md), [API key authentication](mkdocs/docs/api/authentication.md), and [extraction endpoints](mkdocs/docs/api/extraction-jobs.md) for request details.

## Next time

The installer starts the app for you. After restarting your computer, start it again with:

```bash
~/.local/share/document-extraction/document-extraction start
```

To stop it:

```bash
~/.local/share/document-extraction/document-extraction stop
```

These commands use the default installation path. If you chose a different location, use the launcher path printed by the installer.

## More help

- [Setup and maintenance](docs/setup.md) — updates, backups, troubleshooting, and running from source.
- [Configuration](docs/configuration.md) — Google sign-in, email delivery, upload limits, and other settings.

---

[MIT License](LICENSE) · [Contributing](CONTRIBUTING.md) · [Report a security issue](SECURITY.md)
