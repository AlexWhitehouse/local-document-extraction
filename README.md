# Document Extraction

**Turn PDFs and images into structured data for your applications and automated workflows.**

Define the fields you need with reusable templates for invoices, receipts, or your own documents. Submit documents and retrieve extracted data programmatically through the API to connect document extraction to your existing systems. Use the browser to manage templates, upload documents, and review results, with Excel export available when you need a spreadsheet.

The app runs on your computer. You connect the AI model that reads your documents, using an OpenAI-compatible service or local model server. Documents are sent to whichever service you choose.

[Install](#install) · [Your first extraction](#your-first-extraction) · [Automate with the API](#automate-with-the-api) · [Documentation](#documentation) · [Releases](https://github.com/AlexWhitehouse/local-document-extraction/releases)

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

The installer asks a few questions about a reverse proxy, Google sign-in, and Cloudflare email. **Press Enter at each one** for a normal local installation with email and password login. You can change these later, and updates keep your settings.

When it finishes, open **[http://127.0.0.1:8787](http://127.0.0.1:8787)**, or your public URL if you configured a reverse proxy.

## Your first extraction

1. **Create your account.** Sign up with your name, email address, and password, or use Google if enabled. If you enabled signup verification, follow the emailed link.

2. **Connect your AI model.** Open **Workspaces → Model gateway → Set up**. Enter your service’s **Gateway URL**, **Model name**, and **Gateway API key**, then click **Save configuration**. Choose a model that supports image input; you can leave the other options at their defaults.

3. **Upload a document.** Click **Upload**, choose the **Example Invoice** template, and add an invoice PDF or image. For other documents, create a template in **Templates** with the fields you want to extract. Supported files are PDF, PNG, JPEG, and WebP, up to 10 MiB each by default.

4. **Review the results.** Follow progress in **Documents**, then open a completed document to review its extracted fields. You can retrieve results through the API or select completed documents and click **Export** to download an Excel spreadsheet.

## Compare models and templates

Open **Evaluations** to compare up to eight candidates on one document. Compare different models against the same template, or edit template variants while keeping the model fixed. **Run all** sends every candidate for extraction, and results appear in the comparison table as each one finishes.

To measure accuracy, enter the correct answers for the document and each candidate is scored against them. If a candidate's template edits work well, save them as a new template.

Evaluations are temporary: refreshing or closing the tab discards the document, candidates, answers, and results. See the [Evaluations guide](docs/evaluations.md) for details.

## Automate with the API

Scripts and applications can send documents and collect the results without using the browser:

1. In the app, set up your Workspace's model and create a template.
2. Generate a **Workspace API key** on the Workspace page.
3. Submit a document with `POST /v1/extract`. You get back a job ID.
4. Check `GET /v1/jobs/{job_id}` until the job is `completed`, then read its `results`.

The [API specification](mkdocs/docs/api/overview.md) has a copy-and-paste quickstart and the full endpoint reference.

## Starting and stopping

The installer starts the app for you. It does not start automatically after a reboot, so use the launcher when you need it:

```bash
~/.local/share/document-extraction/document-extraction start    # start the app
~/.local/share/document-extraction/document-extraction status   # check whether it is running
~/.local/share/document-extraction/document-extraction stop     # stop the app
```

These paths assume the default install location. If you chose a different one, use the launcher path the installer printed.

## Documentation

| I want to… | Read |
| --- | --- |
| Update, back up, uninstall, or fix a problem | [Setup and maintenance](docs/setup.md) |
| Turn on Google sign-in or email, change ports or upload limits | [Configuration](docs/configuration.md) |
| Compare models or templates | [Evaluations](docs/evaluations.md) |
| Call the API from a script or application | [API specification](mkdocs/docs/api/overview.md) |
| Work on the code | [Contributing](CONTRIBUTING.md) |

---

[MIT License](LICENSE) · [Contributing](CONTRIBUTING.md) · [Report a security issue](SECURITY.md)
