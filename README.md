# Document Extraction

**Turn PDFs and images into an Excel spreadsheet.**

Choose the fields you need, upload your documents, and review the results in your browser. Create reusable templates for invoices, receipts, or your own documents.

The app runs on your computer. You connect the AI model that reads your documents, using an OpenAI-compatible service or local model server. Documents are sent to whichever service you choose.

[Install](#install) · [Your first extraction](#your-first-extraction) · [Releases](https://github.com/AlexWhitehouse/local-document-extraction/releases)

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

4. **Review and export.** Follow progress in **Documents**, then open a completed document to review its extracted fields. Select completed documents and click **Export** to download the results as an Excel spreadsheet.

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
